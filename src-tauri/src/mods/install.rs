//! Putting mod files into an instance and keeping them current.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::error::{ErrorKind, LauncherError, Result};
use crate::net::download::{
    dedupe_by_destination, download_all, sha1_of_file, total_bytes, DownloadItem, ProgressSink,
};
use crate::paths::Paths;
use crate::tasks::Progress;

use super::index::{self, IndexEntry, ModIndex, DISABLED_SUFFIX};
use super::{ModProvider, ModVersion, ProjectKind, ProviderId, Target};

/// A file name from a provider becomes a path inside the content folder; it
/// must not be able to point anywhere else, nor be the wrong type of file.
fn safe_file_name(name: &str, kind: ProjectKind) -> Result<&str> {
    let plain = Path::new(name).components().count() == 1
        && !name.contains("..")
        && name.to_ascii_lowercase().ends_with(kind.extension());
    if plain {
        Ok(name)
    } else {
        Err(LauncherError::new(
            ErrorKind::Provider,
            format!("Провайдер вернул недопустимое имя файла: {name}"),
        ))
    }
}

fn content_dir(paths: &Paths, instance_id: &str, kind: ProjectKind) -> PathBuf {
    paths.instance_game_dir(instance_id).join(kind.folder())
}

/// Removes both the enabled and the disabled variant of a file.
async fn remove_variants(dir: &Path, key: &str) {
    let _ = tokio::fs::remove_file(dir.join(key)).await;
    let _ = tokio::fs::remove_file(dir.join(format!("{key}{DISABLED_SUFFIX}"))).await;
}

/// Downloads versions into the folder for `kind`, replacing any other file of
/// the same project, and records them in that folder's index.
pub async fn install_versions(
    client: &reqwest::Client,
    paths: &Paths,
    instance_id: &str,
    kind: ProjectKind,
    versions: &[ModVersion],
    concurrency: usize,
    progress: Arc<dyn Progress>,
) -> Result<()> {
    let dir = content_dir(paths, instance_id, kind);
    tokio::fs::create_dir_all(&dir).await?;

    let mut items = Vec::with_capacity(versions.len());
    for version in versions {
        if version.download_url.is_empty() {
            return Err(LauncherError::new(
                ErrorKind::Provider,
                format!(
                    "«{}» нельзя скачать через лаунчер — автор запретил сторонние загрузки",
                    version.name
                ),
            ));
        }
        let file_name = safe_file_name(&version.file_name, kind)?;
        items.push(
            DownloadItem::new(version.download_url.clone(), dir.join(file_name))
                .with_sha1(version.sha1.clone())
                .with_size(Some(version.size_bytes)),
        );
    }

    let items = dedupe_by_destination(items);
    progress.begin_phase(
        format!("Загрузка файлов ({})", items.len()),
        Some(total_bytes(&items)),
    );
    download_all(
        client,
        items,
        concurrency,
        progress.token(),
        Arc::clone(&progress) as Arc<dyn ProgressSink>,
    )
    .await?;

    let mut mod_index = ModIndex::load(paths, instance_id, kind).await?;
    for version in versions {
        // Installing another version of a project replaces the old file.
        if let Some(previous) = mod_index.file_of(version.provider, &version.project_id) {
            if previous != version.file_name {
                remove_variants(&dir, &previous).await;
                mod_index.remove(&previous);
            }
        }
        mod_index.insert(&version.file_name, IndexEntry::from(version));
    }
    mod_index.save(paths, instance_id, kind).await
}

/// An installed file with a newer compatible version available.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModUpdate {
    /// The file as it is on disk now, `.disabled` included.
    pub file_name: String,
    pub current_version: Option<String>,
    pub latest: ModVersion,
}

async fn installed_files(dir: &Path) -> Result<Vec<String>> {
    let mut entries = match tokio::fs::read_dir(dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let mut files = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        let name = entry.file_name().to_string_lossy().into_owned();
        let lower = name.to_ascii_lowercase();
        if lower.ends_with(".jar") || lower.ends_with(".jar.disabled") {
            files.push(name);
        }
    }
    files.sort();
    Ok(files)
}

/// Finds updates for everything in `mods/`.
///
/// Modrinth identifies any file by SHA1 — including ones dropped in by hand,
/// which get recorded in the index along the way. CurseForge files are
/// checked when the index knows their project.
pub async fn check_updates(
    providers: &[Arc<dyn ModProvider>],
    paths: &Paths,
    instance_id: &str,
    target: &Target,
) -> Result<Vec<ModUpdate>> {
    let dir = content_dir(paths, instance_id, ProjectKind::Mod);
    let files = installed_files(&dir).await?;
    let mut mod_index = ModIndex::load(paths, instance_id, ProjectKind::Mod).await?;

    let mut hashed: Vec<(String, String)> = Vec::with_capacity(files.len());
    for file in &files {
        if let Ok(sha1) = sha1_of_file(&dir.join(file)).await {
            hashed.push((file.clone(), sha1));
        }
    }

    let mut updates = Vec::new();

    if let Some(modrinth) = providers.iter().find(|p| p.id() == ProviderId::Modrinth) {
        let candidates: Vec<&(String, String)> = hashed
            .iter()
            .filter(|(file, _)| {
                mod_index
                    .get(file)
                    .is_none_or(|entry| entry.provider == ProviderId::Modrinth)
            })
            .collect();
        let hashes: Vec<String> = candidates.iter().map(|(_, sha1)| sha1.clone()).collect();

        let current = modrinth.identify(&hashes).await?;
        let latest = modrinth.latest_for(&hashes, target).await?;

        for (file, sha1) in candidates {
            if let Some(version) = current.get(sha1) {
                if mod_index.get(file).is_none() {
                    mod_index.insert(file, IndexEntry::from(version));
                }
            }
            let Some(newest) = latest.get(sha1) else { continue };
            if newest.sha1.as_deref() == Some(sha1.as_str()) {
                continue;
            }
            updates.push(ModUpdate {
                file_name: file.clone(),
                current_version: current.get(sha1).map(|v| v.version_number.clone()),
                latest: newest.clone(),
            });
        }
    }

    if let Some(curseforge) = providers.iter().find(|p| p.id() == ProviderId::CurseForge) {
        for (file, _) in &hashed {
            let Some(entry) = mod_index.get(file).filter(|e| e.provider == ProviderId::CurseForge)
            else {
                continue;
            };
            let versions = curseforge.versions(&entry.project_id, target).await?;
            let Some(newest) = super::resolve::pick_best(&versions, target) else {
                continue;
            };
            if newest.version_id != entry.version_id && !newest.download_url.is_empty() {
                updates.push(ModUpdate {
                    file_name: file.clone(),
                    current_version: Some(entry.version_number.clone()),
                    latest: newest,
                });
            }
        }
    }

    mod_index.save(paths, instance_id, ProjectKind::Mod).await?;
    Ok(updates)
}

/// Replaces each file with its update, keeping disabled mods disabled.
pub async fn apply_updates(
    client: &reqwest::Client,
    paths: &Paths,
    instance_id: &str,
    updates: &[ModUpdate],
    concurrency: usize,
    progress: Arc<dyn Progress>,
) -> Result<()> {
    let dir = content_dir(paths, instance_id, ProjectKind::Mod);
    let mut items = Vec::with_capacity(updates.len());
    let mut renames: Vec<(PathBuf, PathBuf)> = Vec::new();

    for update in updates {
        let file_name = safe_file_name(&update.latest.file_name, ProjectKind::Mod)?;
        let disabled = update.file_name.ends_with(DISABLED_SUFFIX);
        let fresh = dir.join(file_name);
        items.push(
            DownloadItem::new(update.latest.download_url.clone(), fresh.clone())
                .with_sha1(update.latest.sha1.clone())
                .with_size(Some(update.latest.size_bytes)),
        );
        if disabled {
            renames.push((fresh, dir.join(format!("{file_name}{DISABLED_SUFFIX}"))));
        }
    }

    progress.begin_phase(
        format!("Обновление модов ({})", items.len()),
        Some(total_bytes(&items)),
    );
    download_all(
        client,
        items,
        concurrency,
        progress.token(),
        Arc::clone(&progress) as Arc<dyn ProgressSink>,
    )
    .await?;

    // Only after every download succeeded: remove the old files.
    let mut mod_index = ModIndex::load(paths, instance_id, ProjectKind::Mod).await?;
    for update in updates {
        let old_key = index::key(&update.file_name);
        if old_key != update.latest.file_name {
            remove_variants(&dir, old_key).await;
        }
        mod_index.remove(&update.file_name);
        mod_index.insert(&update.latest.file_name, IndexEntry::from(&update.latest));
    }
    for (from, to) in renames {
        tokio::fs::rename(&from, &to).await?;
    }
    mod_index.save(paths, instance_id, ProjectKind::Mod).await
}
