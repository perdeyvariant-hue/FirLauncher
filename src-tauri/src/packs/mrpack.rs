//! Modrinth `.mrpack`: `modrinth.index.json` lists files to download, and
//! `overrides/` (plus `client-overrides/`) are copied into the game folder.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::instances::{InstanceMeta, ModLoader};
use crate::mods::index::{IndexEntry, ModIndex};
use crate::mods::{ProjectKind, ProviderId};
use crate::net::download::{download_all, total_bytes, DownloadItem, ProgressSink};

use super::{blocking, create_instance, pack_error, read_zip_entry, safe_relative, PackContext, SkippedFile};

pub const INDEX_FILE: &str = "modrinth.index.json";

/// Hosts the `.mrpack` format allows downloads from. Anything else in an
/// index is skipped rather than fetched from wherever a pack author pointed.
const ALLOWED_HOSTS: &[&str] = &[
    "cdn.modrinth.com",
    "github.com",
    "raw.githubusercontent.com",
    "gitlab.com",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Env {
    pub client: String,
    #[serde(default)]
    pub server: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexFile {
    pub path: String,
    pub hashes: HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<Env>,
    pub downloads: Vec<String>,
    pub file_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Index {
    pub format_version: u32,
    pub game: String,
    pub version_id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub files: Vec<IndexFile>,
    pub dependencies: HashMap<String, String>,
}

pub fn allowed_host(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let host = rest.split('/').next().unwrap_or_default();
    ALLOWED_HOSTS.contains(&host)
}

/// The loader a pack's `dependencies` block asks for.
pub fn loader_of(dependencies: &HashMap<String, String>) -> (ModLoader, Option<String>) {
    for (key, loader) in [
        ("neoforge", ModLoader::NeoForge),
        ("forge", ModLoader::Forge),
        ("quilt-loader", ModLoader::Quilt),
        ("fabric-loader", ModLoader::Fabric),
    ] {
        if let Some(version) = dependencies.get(key) {
            return (loader, Some(version.clone()));
        }
    }
    (ModLoader::Vanilla, None)
}

/// `https://cdn.modrinth.com/data/<project>/versions/<version>/<file>` names
/// its project and version, which lets imported files join the source index
/// and get update checks like anything installed from the browser.
pub fn modrinth_ids(url: &str) -> Option<(String, String)> {
    let rest = url.strip_prefix("https://cdn.modrinth.com/data/")?;
    let mut parts = rest.split('/');
    let project = parts.next()?;
    (parts.next()? == "versions").then_some(())?;
    let version = parts.next()?;
    Some((project.to_owned(), version.to_owned()))
}

fn kind_of_path(path: &Path) -> Option<ProjectKind> {
    match path.components().next()?.as_os_str().to_str()? {
        "mods" => Some(ProjectKind::Mod),
        "resourcepacks" => Some(ProjectKind::ResourcePack),
        "shaderpacks" => Some(ProjectKind::Shader),
        _ => None,
    }
}

pub async fn import(ctx: &PackContext<'_>, archive: &Path) -> Result<(InstanceMeta, Vec<SkippedFile>)> {
    let source = archive.to_path_buf();
    let bytes = blocking(move || read_zip_entry(&source, INDEX_FILE))
        .await?
        .ok_or_else(|| pack_error("В архиве нет modrinth.index.json"))?;
    let index: Index = serde_json::from_slice(&bytes)
        .map_err(|error| pack_error("modrinth.index.json не разобрался").with_detail(error.to_string()))?;

    if index.game != "minecraft" {
        return Err(pack_error(format!("Модпак для другой игры: {}", index.game)));
    }
    let mc_version = index
        .dependencies
        .get("minecraft")
        .cloned()
        .ok_or_else(|| pack_error("Модпак не указывает версию Minecraft"))?;
    let (loader, loader_version) = loader_of(&index.dependencies);

    ctx.progress.set_stage(format!("Создание сборки «{}»", index.name));
    let meta = create_instance(ctx.paths, &index.name, &mc_version, loader, loader_version).await?;
    let game_dir = ctx.paths.instance_game_dir(&meta.id);

    let mut skipped = Vec::new();
    let mut items = Vec::new();
    let mut indexed: Vec<(ProjectKind, String, IndexEntry)> = Vec::new();

    for file in &index.files {
        // Server-only files have no business in a client instance.
        if file.env.as_ref().is_some_and(|env| env.client == "unsupported") {
            continue;
        }
        let Some(relative) = safe_relative(&file.path) else {
            skipped.push(SkippedFile {
                name: file.path.clone(),
                url: None,
                reason: String::from("Недопустимый путь в модпаке"),
            });
            continue;
        };
        let Some(url) = file.downloads.iter().find(|url| allowed_host(url)) else {
            skipped.push(SkippedFile {
                name: file.path.clone(),
                url: file.downloads.first().cloned(),
                reason: String::from("Источник файла не входит в разрешённые для .mrpack"),
            });
            continue;
        };

        let sha1 = file.hashes.get("sha1").cloned();
        if let (Some(kind), Some((project, version))) = (kind_of_path(&relative), modrinth_ids(url)) {
            let file_name = relative
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default();
            indexed.push((
                kind,
                file_name.clone(),
                IndexEntry {
                    provider: ProviderId::Modrinth,
                    project_id: project,
                    version_id: version,
                    version_number: file_name,
                    sha1: sha1.clone(),
                },
            ));
        }
        items.push(
            DownloadItem::new(url.clone(), game_dir.join(&relative))
                .with_sha1(sha1)
                .with_size(Some(file.file_size)),
        );
    }

    ctx.progress.begin_phase(
        format!("Файлы модпака ({})", items.len()),
        Some(total_bytes(&items)),
    );
    download_all(
        ctx.client,
        items,
        ctx.settings.download_concurrency(),
        ctx.progress.token(),
        Arc::clone(&ctx.progress) as Arc<dyn ProgressSink>,
    )
    .await?;

    // overrides first, client-overrides on top, exactly as the format says.
    ctx.progress.set_stage(String::from("Копирование настроек модпака"));
    let (source, target) = (archive.to_path_buf(), game_dir.clone());
    blocking(move || {
        super::extract_prefix(&source, "overrides", &target)?;
        super::extract_prefix(&source, "client-overrides", &target)
    })
    .await?;

    for kind in [ProjectKind::Mod, ProjectKind::ResourcePack, ProjectKind::Shader] {
        let mut content = ModIndex::load(ctx.paths, &meta.id, kind).await?;
        let mut changed = false;
        for (entry_kind, file, entry) in &indexed {
            if *entry_kind == kind {
                content.insert(file, entry.clone());
                changed = true;
            }
        }
        if changed {
            content.save(ctx.paths, &meta.id, kind).await?;
        }
    }

    // Remember what the pack installed, so it can be updated later. Modrinth
    // recognises its own packs by hash, which links a local file to its
    // project too.
    let origin = match crate::mods::provider(ctx.settings, ctx.client, ProviderId::Modrinth) {
        Ok(modrinth) => super::update::identify_archive(modrinth.as_ref(), archive).await,
        Err(_) => None,
    };
    super::update::record(ctx.paths, &meta.id, archive, origin).await?;

    Ok((meta, skipped))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_formats_hosts_are_trusted() {
        assert!(allowed_host("https://cdn.modrinth.com/data/x/versions/y/a.jar"));
        assert!(allowed_host("https://github.com/owner/repo/releases/download/v1/a.jar"));
        assert!(!allowed_host("http://cdn.modrinth.com/data/x/a.jar"));
        assert!(!allowed_host("https://evil.example/a.jar"));
        assert!(!allowed_host("https://cdn.modrinth.com.evil.example/a.jar"));
    }

    #[test]
    fn project_and_version_come_from_the_cdn_url() {
        assert_eq!(
            modrinth_ids("https://cdn.modrinth.com/data/AANobbMI/versions/4GyXKCLd/sodium.jar"),
            Some((String::from("AANobbMI"), String::from("4GyXKCLd")))
        );
        assert_eq!(modrinth_ids("https://github.com/a/b.jar"), None);
    }

    #[test]
    fn the_loader_comes_from_dependencies() {
        let deps = HashMap::from([
            (String::from("minecraft"), String::from("1.20.4")),
            (String::from("fabric-loader"), String::from("0.15.11")),
        ]);
        assert_eq!(loader_of(&deps), (ModLoader::Fabric, Some(String::from("0.15.11"))));
        let vanilla = HashMap::from([(String::from("minecraft"), String::from("1.20.4"))]);
        assert_eq!(loader_of(&vanilla).0, ModLoader::Vanilla);
    }

    #[test]
    fn traversal_and_absolute_paths_are_rejected() {
        use super::super::safe_relative;
        assert!(safe_relative("mods/a.jar").is_some());
        assert!(safe_relative("./config/x.toml").is_some());
        assert!(safe_relative("../outside.jar").is_none());
        assert!(safe_relative("mods/../../outside.jar").is_none());
        assert!(safe_relative("/etc/passwd").is_none());
        assert!(safe_relative("C:/Windows/evil.dll").is_none());
        assert!(safe_relative("").is_none());
    }
}
