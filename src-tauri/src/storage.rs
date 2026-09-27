//! Where the disk space goes, and taking back what nothing uses any more.
//!
//! Libraries and client jars are shared between instances and stay behind
//! when an instance is deleted or moves to another version. Everything here
//! that an instance still refers to is kept; the rest can go, and anything
//! gone by mistake is simply downloaded again on the next launch — with one
//! exception that shapes the rules below.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{LauncherError, Result};
use crate::instances::{self, ModLoader};
use crate::minecraft::libraries;
use crate::minecraft::manifest;
use crate::minecraft::rules::Features;
use crate::minecraft::version::VersionJson;
use crate::paths::Paths;

/// Library groups that are never touched. Forge and NeoForge generate jars at
/// install time (patched clients, merged mappings) and find them at runtime by
/// naming convention, not through the profile's library list. They cannot be
/// downloaded again, and the loader is not reinstalled while its profile
/// exists, so deleting one would break an instance for good.
const PROTECTED: [&str; 5] = [
    "net/minecraftforge/",
    "net/neoforged/",
    "net/minecraft/",
    "de/oceanlabs/",
    "cpw/mods/",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceUsage {
    pub id: String,
    pub name: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageUsage {
    /// Largest first.
    pub instances: Vec<InstanceUsage>,
    pub libraries: u64,
    pub assets: u64,
    pub java: u64,
    pub versions: u64,
    pub total: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupPlan {
    pub files: usize,
    pub bytes: u64,
    /// Set when the plan cannot be trusted, with the reason; nothing is
    /// deleted then.
    pub blocked: Option<String>,
}

fn dir_size(root: &Path) -> u64 {
    let mut total = 0;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                stack.push(entry.path());
            } else {
                total += meta.len();
            }
        }
    }
    total
}

fn files_under(root: &Path) -> Vec<(PathBuf, u64)> {
    let mut found = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                stack.push(entry.path());
            } else {
                found.push((entry.path(), meta.len()));
            }
        }
    }
    found
}

/// A path under `root` as `a/b/c.jar`, lower-cased: profiles spell paths
/// with `/`, Windows hands them back with `\`, and its file system does not
/// care about case. Comparing raw paths would call everything unused.
fn key(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let parts: Vec<String> = relative
        .components()
        .map(|part| part.as_os_str().to_string_lossy().to_lowercase())
        .collect();
    Some(parts.join("/").replace('\\', "/"))
}

/// A version and everything it inherits, read from disk only. `None` when
/// any link of the chain is missing.
fn offline_version(paths: &Paths, id: &str) -> Option<(VersionJson, Vec<String>)> {
    let mut chain: Vec<VersionJson> = Vec::new();
    let mut ids = Vec::new();
    let mut current = id.to_owned();
    for _ in 0..8 {
        let text = std::fs::read_to_string(manifest::version_cache(paths, &current)).ok()?;
        let version: VersionJson = serde_json::from_str(&text).ok()?;
        ids.push(current.clone());
        let parent = version.inherits_from.clone();
        chain.push(version);
        match parent {
            Some(parent) if !parent.is_empty() => current = parent,
            _ => {
                let mut resolved = chain.pop()?;
                while let Some(child) = chain.pop() {
                    resolved = VersionJson::merge_onto(&child, &resolved);
                }
                return Some((resolved, ids));
            }
        }
    }
    None
}

pub async fn usage(paths: &Paths) -> Result<StorageUsage> {
    let metas = instances::list_metas(paths).await?;
    let paths = paths.clone();
    tokio::task::spawn_blocking(move || {
        let mut instances: Vec<InstanceUsage> = metas
            .iter()
            .map(|meta| InstanceUsage {
                id: meta.id.clone(),
                name: meta.name.clone(),
                bytes: dir_size(&paths.instance(&meta.id)),
            })
            .collect();
        instances.sort_by_key(|item| std::cmp::Reverse(item.bytes));

        let libraries = dir_size(&paths.libraries());
        let assets = dir_size(&paths.assets());
        let java = dir_size(&paths.java());
        let versions = dir_size(&paths.versions());
        let total = instances.iter().map(|item| item.bytes).sum::<u64>() + libraries + assets + java + versions;
        StorageUsage { instances, libraries, assets, java, versions, total }
    })
    .await
    .map_err(|error| LauncherError::internal("Не удалось посчитать место").with_detail(error.to_string()))
}

/// Files nothing refers to, or the reason the answer cannot be trusted.
fn unused_files(paths: &Paths, metas: &[instances::InstanceMeta]) -> std::result::Result<Vec<(PathBuf, u64)>, String> {
    let libraries_root = paths.libraries();
    let versions_root = paths.versions();

    let mut keep_libraries: HashSet<String> = HashSet::new();
    let mut keep_versions: HashSet<String> = HashSet::new();

    for meta in metas {
        keep_versions.insert(meta.mc_version.to_lowercase());

        let mut ids = vec![meta.mc_version.clone()];
        if meta.loader != ModLoader::Vanilla {
            if let Some(profile) = &meta.profile_id {
                ids.push(profile.clone());
            }
        }
        for id in ids {
            let Some((version, chain)) = offline_version(paths, &id) else {
                // A profile that should be installed but cannot be read: its
                // libraries are unknown, so none of them may be judged.
                if id != meta.mc_version {
                    return Err(format!("Не удалось прочитать профиль сборки «{}»", meta.name));
                }
                // A vanilla version never launched has nothing on disk yet.
                continue;
            };
            keep_versions.extend(chain.into_iter().map(|id| id.to_lowercase()));
            let Ok(resolved) = libraries::resolve(&version, &libraries_root, Features::default()) else {
                return Err(format!("Не удалось разобрать библиотеки сборки «{}»", meta.name));
            };
            let wanted = resolved
                .classpath
                .iter()
                .chain(resolved.natives.iter().map(|(jar, _)| jar))
                .chain(resolved.downloads.iter().map(|item| &item.dest));
            keep_libraries.extend(wanted.filter_map(|path| key(&libraries_root, path)));
        }
    }

    let mut unused = Vec::new();
    for (path, size) in files_under(&libraries_root) {
        let Some(relative) = key(&libraries_root, &path) else { continue };
        if keep_libraries.contains(&relative) || PROTECTED.iter().any(|group| relative.starts_with(group)) {
            continue;
        }
        unused.push((path, size));
    }

    if let Ok(entries) = std::fs::read_dir(&versions_root) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if !keep_versions.contains(&name) && entry.path().is_dir() {
                unused.extend(files_under(&entry.path()));
            }
        }
    }
    Ok(unused)
}

/// The files a cleanup would remove, relative to the data folder — for
/// reviewing the plan before trusting it.
pub async fn unused_for_review(paths: &Paths) -> Result<Vec<String>> {
    let metas = instances::list_metas(paths).await?;
    let paths = paths.clone();
    tokio::task::spawn_blocking(move || {
        let root = paths.root().to_path_buf();
        let mut names: Vec<String> = unused_files(&paths, &metas)
            .unwrap_or_default()
            .into_iter()
            .filter_map(|(path, _)| key(&root, &path))
            .collect();
        names.sort();
        names
    })
    .await
    .map_err(|error| LauncherError::internal("Не удалось проверить файлы").with_detail(error.to_string()))
}

pub async fn plan_cleanup(paths: &Paths) -> Result<CleanupPlan> {
    let metas = instances::list_metas(paths).await?;
    let paths = paths.clone();
    tokio::task::spawn_blocking(move || match unused_files(&paths, &metas) {
        Ok(files) => CleanupPlan {
            files: files.len(),
            bytes: files.iter().map(|(_, size)| size).sum(),
            blocked: None,
        },
        Err(reason) => CleanupPlan { files: 0, bytes: 0, blocked: Some(reason) },
    })
    .await
    .map_err(|error| LauncherError::internal("Не удалось проверить файлы").with_detail(error.to_string()))
}

/// Deletes what `plan_cleanup` counted, working the list out again so the
/// deletion never acts on a stale answer. Returns files and bytes removed.
pub async fn clean(paths: &Paths) -> Result<(usize, u64)> {
    let metas = instances::list_metas(paths).await?;
    let paths = paths.clone();
    tokio::task::spawn_blocking(move || {
        let files = unused_files(&paths, &metas).map_err(LauncherError::io)?;
        let mut removed = 0;
        let mut bytes = 0;
        for (path, size) in files {
            if std::fs::remove_file(&path).is_ok() {
                removed += 1;
                bytes += size;
            }
        }
        // Folders emptied by the above go too, deepest first.
        for root in [paths.libraries(), paths.versions()] {
            remove_empty_dirs(&root, &root);
        }
        Ok((removed, bytes))
    })
    .await
    .map_err(|error| LauncherError::internal("Сбой очистки").with_detail(error.to_string()))?
}

fn remove_empty_dirs(dir: &Path, root: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else { return false };
    let mut empty = true;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if !remove_empty_dirs(&path, root) {
                empty = false;
            }
        } else {
            empty = false;
        }
    }
    if empty && dir != root {
        return std::fs::remove_dir(dir).is_ok();
    }
    empty
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_compare_the_same_whatever_the_separator() {
        let root = Path::new("C:/data/libraries");
        let from_profile = root.join("org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3.jar");
        let from_disk = root.join("org").join("lwjgl").join("lwjgl").join("3.3.3").join("LWJGL-3.3.3.jar");
        assert_eq!(key(root, &from_profile), key(root, &from_disk));
        assert_eq!(key(root, &from_profile).as_deref(), Some("org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3.jar"));
    }

    #[test]
    fn loader_generated_groups_are_never_candidates() {
        for group in PROTECTED {
            assert!(group.ends_with('/'), "{group} must match whole path segments");
        }
        assert!(PROTECTED.iter().any(|group| "net/minecraftforge/forge/47.3.0/forge-47.3.0-client.jar".starts_with(group)));
        assert!(!PROTECTED.iter().any(|group| "net/fabricmc/fabric-loader/0.16.9/x.jar".starts_with(group)));
    }
}
