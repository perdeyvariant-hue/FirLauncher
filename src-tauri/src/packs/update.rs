//! Updating an instance that came from a Modrinth modpack.
//!
//! At install time `pack.json` records which files the pack put where, with
//! their hashes. An update compares that record, the new pack and what is on
//! disk, so the user's own changes survive:
//!
//! * mods the user added stay (the pack never knew about them);
//! * a pack mod the user switched off is updated but stays off;
//! * a pack mod the user deleted is not brought back;
//! * a config the user edited is kept, untouched ones are replaced;
//! * files the new version dropped are removed — unless the user edited them.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};

use crate::config::{read_json_opt, write_json_atomic};
use crate::error::Result;
use crate::instances::{self, InstanceMeta};
use crate::mods::index::{IndexEntry, ModIndex, DISABLED_SUFFIX};
use crate::mods::{ModProvider, ModVersion, ProjectKind, ProviderId, ReleaseType, Target};
use crate::net::download::{download_all, sha1_of_file, total_bytes, DownloadItem, ProgressSink};
use crate::paths::Paths;

use super::mrpack::{self, Index};
use super::{blocking, open_zip, pack_error, read_zip_entry, safe_relative, PackContext};

const STATE_FILE: &str = "pack.json";

/// One file a pack installed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackFile {
    pub sha1: Option<String>,
    /// Modrinth project, for files that came from the CDN.
    #[serde(default)]
    pub project_id: Option<String>,
}

/// `instances/<id>/pack.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackState {
    pub provider: ProviderId,
    /// Known when the pack was installed from Modrinth or recognised there.
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    /// The pack's own version name, from its index.
    pub version_number: String,
    pub name: String,
    /// Paths relative to `.minecraft`, forward slashes.
    pub files: BTreeMap<String, PackFile>,
}

fn state_path(paths: &Paths, instance_id: &str) -> std::path::PathBuf {
    paths.instance(instance_id).join(STATE_FILE)
}

pub async fn load_state(paths: &Paths, instance_id: &str) -> Result<Option<PackState>> {
    read_json_opt(&state_path(paths, instance_id)).await
}

async fn save_state(paths: &Paths, instance_id: &str, state: &PackState) -> Result<()> {
    write_json_atomic(&state_path(paths, instance_id), state).await
}

/// Where a file in the new pack comes from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Source {
    Download { url: String, size: u64 },
    /// `overrides/` or `client-overrides/` inside the archive.
    Override { entry: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewFile {
    pub sha1: Option<String>,
    pub project_id: Option<String>,
    pub source: Source,
}

fn sha1_hex(bytes: &[u8]) -> String {
    hex::encode(Sha1::digest(bytes))
}

/// Everything a pack archive would put into `.minecraft`, client side only.
fn pack_files(archive: &Path, index: &Index) -> Result<BTreeMap<String, NewFile>> {
    let mut files = BTreeMap::new();
    for file in &index.files {
        if file.env.as_ref().is_some_and(|env| env.client == "unsupported") {
            continue;
        }
        let Some(relative) = safe_relative(&file.path) else { continue };
        let Some(url) = file.downloads.iter().find(|url| mrpack::allowed_host(url)) else {
            continue;
        };
        files.insert(
            relative.to_string_lossy().replace('\\', "/"),
            NewFile {
                sha1: file.hashes.get("sha1").cloned(),
                project_id: mrpack::modrinth_ids(url).map(|(project, _)| project),
                source: Source::Download { url: url.clone(), size: file.file_size },
            },
        );
    }

    // overrides first, client-overrides on top — the same order as import.
    let mut zip = open_zip(archive)?;
    for prefix in ["overrides/", "client-overrides/"] {
        for position in 0..zip.len() {
            let mut entry = zip
                .by_index(position)
                .map_err(|error| pack_error("Не удалось прочитать архив").with_detail(error.to_string()))?;
            if entry.is_dir() {
                continue;
            }
            let name = entry.name().replace('\\', "/");
            let Some(rest) = name.strip_prefix(prefix) else { continue };
            let Some(relative) = safe_relative(rest) else { continue };
            let mut bytes = Vec::new();
            std::io::Read::read_to_end(&mut entry, &mut bytes)?;
            files.insert(
                relative.to_string_lossy().replace('\\', "/"),
                NewFile {
                    sha1: Some(sha1_hex(&bytes)),
                    project_id: None,
                    source: Source::Override { entry: name },
                },
            );
        }
    }
    Ok(files)
}

fn read_index(archive: &Path) -> Result<Index> {
    let bytes = read_zip_entry(archive, mrpack::INDEX_FILE)?
        .ok_or_else(|| pack_error("В архиве нет modrinth.index.json"))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| pack_error("modrinth.index.json не разобрался").with_detail(error.to_string()))
}

/// Records what a freshly imported pack installed.
pub async fn record(
    paths: &Paths,
    instance_id: &str,
    archive: &Path,
    origin: Option<(String, String)>,
) -> Result<()> {
    let source = archive.to_path_buf();
    let (index, files) = blocking(move || {
        let index = read_index(&source)?;
        let files = pack_files(&source, &index)?;
        Ok((index, files))
    })
    .await?;
    let (project_id, version_id) = match origin {
        Some((project, version)) => (Some(project), Some(version)),
        None => (None, None),
    };
    let state = PackState {
        provider: ProviderId::Modrinth,
        project_id,
        version_id,
        version_number: index.version_id.clone(),
        name: index.name.clone(),
        files: files
            .into_iter()
            .map(|(path, file)| (path, PackFile { sha1: file.sha1, project_id: file.project_id }))
            .collect(),
    };
    save_state(paths, instance_id, &state).await
}

/// Asks Modrinth which project and version an `.mrpack` file is, by its hash.
pub async fn identify_archive(
    modrinth: &dyn ModProvider,
    archive: &Path,
) -> Option<(String, String)> {
    let sha1 = sha1_of_file(archive).await.ok()?;
    let found = modrinth.identify(std::slice::from_ref(&sha1)).await.ok()?;
    let version = found.get(&sha1)?;
    Some((version.project_id.clone(), version.version_id.clone()))
}

/* ——— Planning ——— */

/// What is on disk now, for the paths the old or new pack mentions.
#[derive(Debug, Default)]
pub struct Disk {
    /// SHA1 of present files by path.
    pub present: HashMap<String, String>,
    /// Paths whose `.disabled` twin exists.
    pub disabled: HashSet<String>,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Plan {
    /// Path, whether to install it switched off.
    pub fetch: Vec<(String, bool)>,
    pub delete: Vec<String>,
    /// Changed by the user; left as they are.
    pub kept: Vec<String>,
    /// Pack mods the user removed; not brought back.
    pub skipped: Vec<String>,
}

pub fn plan(old: &PackState, new: &BTreeMap<String, NewFile>, disk: &Disk) -> Plan {
    let mut out = Plan::default();
    let old_by_project: HashMap<&str, &str> = old
        .files
        .iter()
        .filter_map(|(path, file)| file.project_id.as_deref().map(|project| (project, path.as_str())))
        .collect();
    let on_disk = |path: &str| disk.present.contains_key(path) || disk.disabled.contains(path);

    for (path, file) in new {
        match &file.source {
            Source::Download { .. } => {
                // The same project may sit under an older file name.
                let previous = file
                    .project_id
                    .as_deref()
                    .and_then(|project| old_by_project.get(project).copied())
                    .or_else(|| old.files.contains_key(path).then_some(path.as_str()));
                if let Some(previous) = previous {
                    if !on_disk(previous) {
                        out.skipped.push(path.clone());
                        continue;
                    }
                }
                let disabled = previous.is_some_and(|previous| disk.disabled.contains(previous))
                    || disk.disabled.contains(path);
                let current_matches = file.sha1.as_ref().is_some_and(|sha1| {
                    disk.present.get(path) == Some(sha1) && !disabled
                });
                if !current_matches {
                    out.fetch.push((path.clone(), disabled));
                }
            }
            Source::Override { .. } => match disk.present.get(path) {
                Some(current) => {
                    if file.sha1.as_ref() == Some(current) {
                        continue;
                    }
                    let recorded = old.files.get(path).and_then(|file| file.sha1.as_ref());
                    if recorded == Some(current) {
                        out.fetch.push((path.clone(), false));
                    } else {
                        out.kept.push(path.clone());
                    }
                }
                // Deleted by the user after the last install: leave it deleted.
                None if old.files.contains_key(path) => out.skipped.push(path.clone()),
                None => out.fetch.push((path.clone(), false)),
            },
        }
    }

    for (path, recorded) in &old.files {
        // Still in the pack: either unchanged or replaced in place above.
        if new.contains_key(path) {
            continue;
        }
        match disk.present.get(path) {
            Some(current) if recorded.sha1.as_ref() == Some(current) => out.delete.push(path.clone()),
            Some(_) => out.kept.push(path.clone()),
            None if disk.disabled.contains(path) => out.delete.push(format!("{path}{DISABLED_SUFFIX}")),
            None => {}
        }
    }
    out
}

/* ——— Checking and applying ——— */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModpackInfo {
    pub name: String,
    pub version_number: String,
    /// False for packs imported from a file Modrinth does not know.
    pub updatable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModpackUpdate {
    pub current: String,
    pub latest: String,
    pub version_id: String,
    pub published_at: String,
}

pub async fn info(paths: &Paths, instance_id: &str) -> Result<Option<ModpackInfo>> {
    Ok(load_state(paths, instance_id).await?.map(|state| ModpackInfo {
        updatable: state.project_id.is_some(),
        name: state.name,
        version_number: state.version_number,
    }))
}

fn published(version: &ModVersion) -> Option<chrono::DateTime<chrono::FixedOffset>> {
    chrono::DateTime::parse_from_rfc3339(&version.published_at).ok()
}

/// The version to update to, if any. Someone on an alpha or beta follows the
/// newest build of any kind; someone on a release gets the newest release.
/// Either way only something published after what is installed — an
/// "update" must never be a downgrade.
pub fn choose_update(versions: &[ModVersion], current_version_id: Option<&str>) -> Option<ModVersion> {
    let current = current_version_id.and_then(|id| versions.iter().find(|v| v.version_id == id));
    let on_prerelease = current.is_some_and(|v| v.release_type != ReleaseType::Release);
    let candidate = if on_prerelease {
        versions.first()
    } else {
        versions
            .iter()
            .find(|v| v.release_type == ReleaseType::Release)
            .or_else(|| versions.first())
    }?;
    if Some(candidate.version_id.as_str()) == current_version_id {
        return None;
    }
    if let (Some(current), Some(when)) = (current.and_then(published), published(candidate)) {
        if when <= current {
            return None;
        }
    }
    Some(candidate.clone())
}

async fn versions_of(modrinth: &dyn ModProvider, project_id: &str) -> Result<Vec<ModVersion>> {
    let versions = modrinth.versions(project_id, &Target::any()).await?;
    if versions.is_empty() {
        return Err(pack_error("У модпака нет опубликованных версий"));
    }
    Ok(versions)
}

pub async fn check(
    paths: &Paths,
    modrinth: &dyn ModProvider,
    instance_id: &str,
) -> Result<Option<ModpackUpdate>> {
    let Some(state) = load_state(paths, instance_id).await? else {
        return Err(pack_error("Эта сборка создана не из модпака"));
    };
    let Some(project_id) = state.project_id.as_deref() else {
        return Err(pack_error(
            "Модпак импортирован из файла, которого нет на Modrinth, — обновить его автоматически нельзя",
        ));
    };
    let versions = versions_of(modrinth, project_id).await?;
    let Some(latest) = choose_update(&versions, state.version_id.as_deref()) else {
        return Ok(None);
    };
    Ok(Some(ModpackUpdate {
        current: state.version_number,
        latest: latest.version_number,
        version_id: latest.version_id,
        published_at: latest.published_at,
    }))
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSummary {
    pub version: String,
    pub updated: usize,
    pub removed: usize,
    /// Files the user changed, left as they were.
    pub kept: Vec<String>,
}

async fn disk_state(game_dir: &Path, paths: impl Iterator<Item = String>) -> Disk {
    let mut disk = Disk::default();
    for path in paths {
        let file = game_dir.join(&path);
        if let Ok(sha1) = sha1_of_file(&file).await {
            disk.present.insert(path.clone(), sha1);
        }
        if tokio::fs::metadata(format!("{}{DISABLED_SUFFIX}", file.display())).await.is_ok() {
            disk.disabled.insert(path);
        }
    }
    disk
}

/// Downloads the newest version of the pack and brings the instance up to it.
pub async fn apply(ctx: &PackContext<'_>, modrinth: &dyn ModProvider, meta: &InstanceMeta) -> Result<UpdateSummary> {
    let Some(old) = load_state(ctx.paths, &meta.id).await? else {
        return Err(pack_error("Эта сборка создана не из модпака"));
    };
    let project_id = old
        .project_id
        .clone()
        .ok_or_else(|| pack_error("Модпак не связан с Modrinth — обновить его нельзя"))?;
    let versions = versions_of(modrinth, &project_id).await?;
    let latest = choose_update(&versions, old.version_id.as_deref())
        .ok_or_else(|| pack_error("Модпак уже последней версии"))?;

    let file_name = safe_relative(&latest.file_name)
        .filter(|path| path.components().count() == 1)
        .ok_or_else(|| pack_error("Недопустимое имя файла модпака"))?;
    let archive = ctx.paths.meta().join("packs").join(file_name);
    ctx.progress.begin_phase(format!("Загрузка {}", latest.file_name), Some(latest.size_bytes));
    download_all(
        ctx.client,
        vec![DownloadItem::new(latest.download_url.clone(), archive.clone())
            .with_sha1(latest.sha1.clone())
            .with_size(Some(latest.size_bytes))],
        1,
        ctx.progress.token(),
        Arc::clone(&ctx.progress) as Arc<dyn ProgressSink>,
    )
    .await?;

    let source = archive.clone();
    let (index, new_files) = blocking(move || {
        let index = read_index(&source)?;
        let files = pack_files(&source, &index)?;
        Ok((index, files))
    })
    .await?;

    let game_dir = ctx.paths.instance_game_dir(&meta.id);
    let mentioned: HashSet<String> = old.files.keys().chain(new_files.keys()).cloned().collect();
    let disk = disk_state(&game_dir, mentioned.into_iter()).await;
    let plan = plan(&old, &new_files, &disk);

    // Downloads first; nothing on disk changes until they all succeeded.
    let mut items = Vec::new();
    let mut overrides = Vec::new();
    for (path, _) in &plan.fetch {
        let Some(file) = new_files.get(path) else { continue };
        match &file.source {
            Source::Download { url, size } => items.push(
                DownloadItem::new(url.clone(), game_dir.join(path))
                    .with_sha1(file.sha1.clone())
                    .with_size(Some(*size)),
            ),
            Source::Override { entry } => overrides.push((path.clone(), entry.clone())),
        }
    }
    ctx.progress.begin_phase(format!("Файлы модпака ({})", items.len()), Some(total_bytes(&items)));
    download_all(
        ctx.client,
        items,
        ctx.settings.download_concurrency(),
        ctx.progress.token(),
        Arc::clone(&ctx.progress) as Arc<dyn ProgressSink>,
    )
    .await?;

    ctx.progress.set_stage(String::from("Обновление файлов сборки"));
    let (source, target) = (archive.clone(), game_dir.clone());
    blocking(move || {
        let mut zip = open_zip(&source)?;
        for (path, entry) in overrides {
            let mut file = zip
                .by_name(&entry)
                .map_err(|error| pack_error("Не удалось прочитать архив").with_detail(error.to_string()))?;
            let dest = target.join(&path);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut out = std::fs::File::create(&dest)?;
            std::io::copy(&mut file, &mut out)?;
        }
        Ok(())
    })
    .await?;

    // Switched-off mods stay switched off.
    for (path, disabled) in &plan.fetch {
        if *disabled {
            let enabled = game_dir.join(path);
            let off = std::path::PathBuf::from(format!("{}{DISABLED_SUFFIX}", enabled.display()));
            let _ = tokio::fs::remove_file(&off).await;
            tokio::fs::rename(&enabled, &off).await?;
        }
    }
    for path in &plan.delete {
        let _ = tokio::fs::remove_file(game_dir.join(path)).await;
    }

    // Source index: forget replaced files, learn the new ones.
    for kind in [ProjectKind::Mod, ProjectKind::ResourcePack, ProjectKind::Shader] {
        let mut content = ModIndex::load(ctx.paths, &meta.id, kind).await?;
        for path in old.files.keys().filter(|path| !new_files.contains_key(*path)) {
            if let Some(name) = Path::new(path).file_name() {
                content.remove(&name.to_string_lossy());
            }
        }
        for (path, file) in &new_files {
            let Source::Download { url, .. } = &file.source else { continue };
            let relative = Path::new(path);
            let in_folder = relative.components().next().and_then(|c| c.as_os_str().to_str());
            if in_folder != Some(kind.folder()) {
                continue;
            }
            if let (Some((project, version)), Some(name)) = (mrpack::modrinth_ids(url), relative.file_name()) {
                let name = name.to_string_lossy().into_owned();
                content.insert(
                    &name,
                    IndexEntry {
                        provider: ProviderId::Modrinth,
                        project_id: project,
                        version_id: version,
                        version_number: name.clone(),
                        sha1: file.sha1.clone(),
                    },
                );
            }
        }
        content.save(ctx.paths, &meta.id, kind).await?;
    }

    // A new Minecraft or loader version means the loader profile is rebuilt
    // on the next launch.
    let mut updated_meta = instances::read_meta(ctx.paths, &meta.id).await?;
    if let Some(mc) = index.dependencies.get("minecraft") {
        let (loader, loader_version) = mrpack::loader_of(&index.dependencies);
        if *mc != updated_meta.mc_version
            || loader != updated_meta.loader
            || loader_version != updated_meta.loader_version
        {
            updated_meta.mc_version = mc.clone();
            updated_meta.loader = loader;
            updated_meta.loader_version = loader_version;
            updated_meta.profile_id = None;
            instances::write_meta(ctx.paths, &updated_meta).await?;
        }
    }

    let summary = UpdateSummary {
        version: index.version_id.clone(),
        updated: plan.fetch.len(),
        removed: plan.delete.len(),
        kept: plan.kept.clone(),
    };
    save_state(
        ctx.paths,
        &meta.id,
        &PackState {
            provider: ProviderId::Modrinth,
            project_id: Some(project_id),
            version_id: Some(latest.version_id),
            version_number: index.version_id,
            name: index.name,
            files: new_files
                .into_iter()
                .map(|(path, file)| (path, PackFile { sha1: file.sha1, project_id: file.project_id }))
                .collect(),
        },
    )
    .await?;
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn download(sha1: &str, project: &str) -> NewFile {
        NewFile {
            sha1: Some(sha1.to_owned()),
            project_id: Some(project.to_owned()),
            source: Source::Download { url: String::from("https://cdn.modrinth.com/x"), size: 1 },
        }
    }

    fn config(sha1: &str) -> NewFile {
        NewFile {
            sha1: Some(sha1.to_owned()),
            project_id: None,
            source: Source::Override { entry: String::from("overrides/x") },
        }
    }

    fn old(files: &[(&str, &str, Option<&str>)]) -> PackState {
        PackState {
            provider: ProviderId::Modrinth,
            project_id: Some(String::from("pack")),
            version_id: Some(String::from("v1")),
            version_number: String::from("1.0"),
            name: String::from("Pack"),
            files: files
                .iter()
                .map(|(path, sha1, project)| {
                    ((*path).to_owned(), PackFile { sha1: Some((*sha1).to_owned()), project_id: project.map(str::to_owned) })
                })
                .collect(),
        }
    }

    fn disk(present: &[(&str, &str)], disabled: &[&str]) -> Disk {
        Disk {
            present: present.iter().map(|(p, s)| ((*p).to_owned(), (*s).to_owned())).collect(),
            disabled: disabled.iter().map(|p| (*p).to_owned()).collect(),
        }
    }

    #[test]
    fn a_mod_update_replaces_the_old_file() {
        let old = old(&[("mods/sodium-1.jar", "a", Some("sodium"))]);
        let new = BTreeMap::from([(String::from("mods/sodium-2.jar"), download("b", "sodium"))]);
        let plan = plan(&old, &new, &disk(&[("mods/sodium-1.jar", "a")], &[]));
        assert_eq!(plan.fetch, vec![(String::from("mods/sodium-2.jar"), false)]);
        assert_eq!(plan.delete, vec![String::from("mods/sodium-1.jar")]);
    }

    #[test]
    fn a_switched_off_mod_stays_off_and_a_deleted_one_stays_gone() {
        let old = old(&[
            ("mods/a-1.jar", "a1", Some("a")),
            ("mods/b-1.jar", "b1", Some("b")),
        ]);
        let new = BTreeMap::from([
            (String::from("mods/a-2.jar"), download("a2", "a")),
            (String::from("mods/b-2.jar"), download("b2", "b")),
        ]);
        // a is switched off, b was deleted by the user.
        let plan = plan(&old, &new, &disk(&[], &["mods/a-1.jar"]));
        assert_eq!(plan.fetch, vec![(String::from("mods/a-2.jar"), true)]);
        assert_eq!(plan.skipped, vec![String::from("mods/b-2.jar")]);
        assert_eq!(plan.delete, vec![String::from("mods/a-1.jar.disabled")]);
    }

    #[test]
    fn edited_configs_are_kept_and_untouched_ones_replaced() {
        let old = old(&[("config/a.toml", "old", None), ("config/b.toml", "old", None)]);
        let new = BTreeMap::from([
            (String::from("config/a.toml"), config("new")),
            (String::from("config/b.toml"), config("new")),
            (String::from("config/c.toml"), config("new")),
        ]);
        let plan = plan(&old, &new, &disk(&[("config/a.toml", "old"), ("config/b.toml", "mine")], &[]));
        assert_eq!(
            plan.fetch,
            vec![(String::from("config/a.toml"), false), (String::from("config/c.toml"), false)]
        );
        assert_eq!(plan.kept, vec![String::from("config/b.toml")]);
    }

    #[test]
    fn dropped_files_go_unless_edited_and_user_files_are_never_touched() {
        let old = old(&[("mods/gone.jar", "g", Some("gone")), ("config/gone.toml", "old", None)]);
        let new = BTreeMap::new();
        let plan = plan(
            &old,
            &new,
            &disk(&[("mods/gone.jar", "g"), ("config/gone.toml", "edited"), ("mods/mine.jar", "m")], &[]),
        );
        assert_eq!(plan.delete, vec![String::from("mods/gone.jar")]);
        assert_eq!(plan.kept, vec![String::from("config/gone.toml")]);
        assert!(!plan.delete.iter().any(|path| path.contains("mine")));
    }

    fn version(id: &str, kind: ReleaseType, published: &str) -> ModVersion {
        ModVersion {
            provider: ProviderId::Modrinth,
            project_id: String::from("pack"),
            version_id: id.to_owned(),
            name: id.to_owned(),
            version_number: id.to_owned(),
            file_name: format!("{id}.mrpack"),
            size_bytes: 1,
            sha1: None,
            download_url: String::from("https://cdn.modrinth.com/x"),
            game_versions: Vec::new(),
            loaders: Vec::new(),
            release_type: kind,
            published_at: published.to_owned(),
            dependencies: Vec::new(),
        }
    }

    #[test]
    fn updates_follow_the_channel_and_never_go_back() {
        // Newest first, as Modrinth lists them.
        let versions = vec![
            version("alpha3", ReleaseType::Alpha, "2026-09-20T00:00:00Z"),
            version("alpha2", ReleaseType::Alpha, "2026-09-10T00:00:00Z"),
            version("r14", ReleaseType::Release, "2026-09-13T00:00:00Z"),
            version("r13", ReleaseType::Release, "2026-08-01T00:00:00Z"),
        ];
        let id = |v: Option<ModVersion>| v.map(|v| v.version_id);
        assert_eq!(id(choose_update(&versions, Some("alpha2"))), Some(String::from("alpha3")));
        assert_eq!(id(choose_update(&versions, Some("r13"))), Some(String::from("r14")));
        assert_eq!(id(choose_update(&versions, Some("r14"))), None);
        assert_eq!(id(choose_update(&versions, Some("alpha3"))), None);
        // On an alpha published after the newest release: no "update" to it.
        let later = vec![
            version("r14", ReleaseType::Release, "2026-09-13T00:00:00Z"),
            version("alpha9", ReleaseType::Alpha, "2026-09-15T00:00:00Z"),
        ];
        assert_eq!(id(choose_update(&later, Some("alpha9"))), None);
    }

    #[test]
    fn nothing_to_do_when_up_to_date() {
        let old = old(&[("mods/a.jar", "a", Some("a")), ("config/x", "c", None)]);
        let new = BTreeMap::from([
            (String::from("mods/a.jar"), download("a", "a")),
            (String::from("config/x"), config("c")),
        ]);
        let plan = plan(&old, &new, &disk(&[("mods/a.jar", "a"), ("config/x", "c")], &[]));
        assert_eq!(plan, Plan::default());
    }
}
