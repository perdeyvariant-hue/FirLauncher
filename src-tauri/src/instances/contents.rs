//! Reading what is inside an instance folder: mods, worlds, resource packs,
//! screenshots and the log tail.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{LauncherError, Result};
use crate::paths::Paths;

const DISABLED_SUFFIX: &str = ".disabled";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModSource {
    pub provider: String,
    pub project_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledMod {
    pub file_name: String,
    pub name: String,
    pub version: Option<String>,
    pub author: Option<String>,
    pub enabled: bool,
    pub size_bytes: u64,
    /// Hashing every jar on every tab open is too slow for large packs; the
    /// update checker in stage 5 computes it on demand.
    pub sha1: Option<String>,
    pub source: Option<ModSource>,
    pub update_available: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldEntry {
    pub folder_name: String,
    pub name: String,
    pub last_played_at: Option<String>,
    pub size_bytes: u64,
    pub game_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourcePackEntry {
    pub file_name: String,
    pub name: String,
    pub description: Option<String>,
    pub size_bytes: u64,
    pub pack_format: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotEntry {
    pub file_name: String,
    pub taken_at: String,
    pub size_bytes: u64,
}

fn iso_of(time: std::time::SystemTime) -> String {
    chrono::DateTime::<chrono::Utc>::from(time).to_rfc3339()
}

/// `sodium-fabric-0.6.5.jar` -> ("sodium-fabric", Some("0.6.5"))
fn split_file_name(stem: &str) -> (String, Option<String>) {
    // The version is the last dash-separated chunk that starts with a digit.
    if let Some(index) = stem.rfind('-') {
        let (name, version) = stem.split_at(index);
        let version = version.trim_start_matches('-');
        if version.starts_with(|c: char| c.is_ascii_digit()) && !name.is_empty() {
            return (name.to_owned(), Some(version.to_owned()));
        }
    }
    (stem.to_owned(), None)
}

#[derive(Debug, Deserialize)]
struct FabricModJson {
    name: Option<String>,
    id: Option<String>,
    version: Option<String>,
    #[serde(default)]
    authors: Vec<serde_json::Value>,
}

fn author_of(values: &[serde_json::Value]) -> Option<String> {
    let first = values.first()?;
    match first {
        serde_json::Value::String(name) => Some(name.clone()),
        serde_json::Value::Object(map) => map
            .get("name")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned),
        _ => None,
    }
}

/// Reads `fabric.mod.json` / `quilt.mod.json` out of a jar. Forge's
/// `META-INF/mods.toml` needs a TOML parser and lands with the mod browser in
/// stage 5; until then those mods fall back to their file name.
fn read_jar_metadata(path: &Path) -> Option<(String, Option<String>, Option<String>)> {
    let file = std::fs::File::open(path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;

    for entry_name in ["fabric.mod.json", "quilt.mod.json"] {
        let Ok(entry) = archive.by_name(entry_name) else {
            continue;
        };
        let parsed: serde_json::Value = serde_json::from_reader(entry).ok()?;
        // Quilt nests everything under `quilt_loader`.
        let root = parsed
            .get("quilt_loader")
            .and_then(|value| value.get("metadata"))
            .unwrap_or(&parsed);
        let meta: FabricModJson = serde_json::from_value(root.clone()).ok()?;
        let version = parsed
            .get("quilt_loader")
            .and_then(|value| value.get("version"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned)
            .or(meta.version);
        let name = meta.name.or(meta.id)?;
        return Some((name, version, author_of(&meta.authors)));
    }
    None
}

pub async fn list_mods(paths: &Paths, id: &str) -> Result<Vec<InstalledMod>> {
    let dir = paths.instance_game_dir(id).join("mods");
    let mut entries = match tokio::fs::read_dir(&dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(LauncherError::io("Не удалось прочитать папку модов")
                .with_detail(error.to_string()))
        }
    };

    let mut files: Vec<(String, PathBuf, u64)> = Vec::new();
    while let Some(entry) = entries.next_entry().await.map_err(|error| {
        LauncherError::io("Не удалось перечислить моды").with_detail(error.to_string())
    })? {
        let Some(file_name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let lower = file_name.to_ascii_lowercase();
        if !lower.ends_with(".jar") && !lower.ends_with(".jar.disabled") {
            continue;
        }
        let size = entry.metadata().await.map(|meta| meta.len()).unwrap_or(0);
        files.push((file_name, entry.path(), size));
    }

    let index = crate::mods::index::ModIndex::load(paths, id, crate::mods::ProjectKind::Mod)
        .await
        .unwrap_or_default();

    // Jar parsing is blocking IO; do it off the async runtime in one go.
    let mods = tokio::task::spawn_blocking(move || {
        let mut mods: Vec<InstalledMod> = files
            .into_iter()
            .map(|(file_name, path, size_bytes)| {
                let enabled = !file_name.ends_with(DISABLED_SUFFIX);
                let stem = file_name
                    .trim_end_matches(DISABLED_SUFFIX)
                    .trim_end_matches(".jar")
                    .to_owned();
                let (fallback_name, fallback_version) = split_file_name(&stem);
                let (name, version, author) = read_jar_metadata(&path)
                    .unwrap_or((fallback_name, fallback_version, None));

                let source = index.get(&file_name).map(|entry| ModSource {
                    provider: serde_json::to_value(entry.provider)
                        .ok()
                        .and_then(|value| value.as_str().map(str::to_owned))
                        .unwrap_or_default(),
                    project_id: entry.project_id.clone(),
                });
                InstalledMod {
                    file_name,
                    name,
                    version,
                    author,
                    enabled,
                    size_bytes,
                    sha1: None,
                    source,
                    update_available: None,
                }
            })
            .collect();
        mods.sort_by_key(|item| item.name.to_lowercase());
        mods
    })
    .await
    .map_err(|error| {
        LauncherError::internal("Сбой чтения модов").with_detail(error.to_string())
    })?;

    Ok(mods)
}

/// Flips `mod.jar` <-> `mod.jar.disabled`, which is how every launcher in this
/// family turns a mod off without deleting it.
pub async fn set_mod_enabled(
    paths: &Paths,
    id: &str,
    file_name: &str,
    enabled: bool,
) -> Result<()> {
    let dir = paths.instance_game_dir(id).join("mods");
    let current = dir.join(file_name);
    let target = if enabled {
        dir.join(file_name.trim_end_matches(DISABLED_SUFFIX))
    } else if file_name.ends_with(DISABLED_SUFFIX) {
        current.clone()
    } else {
        dir.join(format!("{file_name}{DISABLED_SUFFIX}"))
    };

    if current == target {
        return Ok(());
    }
    tokio::fs::rename(&current, &target).await.map_err(|error| {
        LauncherError::io(format!("Не удалось переименовать {file_name}"))
            .with_detail(error.to_string())
    })
}

pub async fn remove_mod(paths: &Paths, id: &str, file_name: &str) -> Result<()> {
    // Keep the operation inside the mods directory: a plain file name has
    // exactly one path component and no parent reference.
    let plain = std::path::Path::new(file_name).components().count() == 1
        && !file_name.contains("..");
    if !plain {
        return Err(LauncherError::io("Недопустимое имя файла"));
    }
    let path = paths.instance_game_dir(id).join("mods").join(file_name);
    tokio::fs::remove_file(&path).await.map_err(|error| {
        LauncherError::io(format!("Не удалось удалить {file_name}"))
            .with_detail(error.to_string())
    })?;

    // Otherwise the browser would keep showing the project as installed.
    let mut index =
        crate::mods::index::ModIndex::load(paths, id, crate::mods::ProjectKind::Mod).await?;
    if index.get(file_name).is_some() {
        index.remove(file_name);
        index.save(paths, id, crate::mods::ProjectKind::Mod).await?;
    }
    Ok(())
}

fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| match entry.file_type() {
            Ok(kind) if kind.is_dir() => dir_size(&entry.path()),
            Ok(_) => entry.metadata().map(|meta| meta.len()).unwrap_or(0),
            Err(_) => 0,
        })
        .sum()
}

pub async fn list_worlds(paths: &Paths, id: &str) -> Result<Vec<WorldEntry>> {
    let dir = paths.instance_game_dir(id).join("saves");
    let worlds = tokio::task::spawn_blocking(move || {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            return Vec::new();
        };
        let mut worlds: Vec<WorldEntry> = entries
            .flatten()
            .filter(|entry| entry.path().is_dir())
            .map(|entry| {
                let path = entry.path();
                let folder_name = entry.file_name().to_string_lossy().into_owned();
                let last_played_at = std::fs::metadata(path.join("level.dat"))
                    .or_else(|_| std::fs::metadata(&path))
                    .ok()
                    .and_then(|meta| meta.modified().ok())
                    .map(iso_of);
                WorldEntry {
                    // level.dat is gzipped NBT; parsing it for the display
                    // name needs an NBT reader we do not carry yet.
                    name: folder_name.clone(),
                    folder_name,
                    last_played_at,
                    size_bytes: dir_size(&path),
                    game_mode: None,
                }
            })
            .collect();
        worlds.sort_by(|a, b| b.last_played_at.cmp(&a.last_played_at));
        worlds
    })
    .await
    .map_err(|error| {
        LauncherError::internal("Сбой чтения миров").with_detail(error.to_string())
    })?;

    Ok(worlds)
}

fn read_pack_mcmeta(path: &Path) -> (Option<String>, Option<i64>) {
    let Ok(file) = std::fs::File::open(path) else {
        return (None, None);
    };
    let Ok(mut archive) = zip::ZipArchive::new(file) else {
        return (None, None);
    };
    let Ok(entry) = archive.by_name("pack.mcmeta") else {
        return (None, None);
    };
    let Ok(parsed) = serde_json::from_reader::<_, serde_json::Value>(entry) else {
        return (None, None);
    };

    let pack = parsed.get("pack");
    let description = pack
        .and_then(|pack| pack.get("description"))
        .map(|value| match value {
            serde_json::Value::String(text) => text.clone(),
            // 1.20+ allows a rich-text component here.
            other => other.to_string(),
        });
    let format = pack
        .and_then(|pack| pack.get("pack_format"))
        .and_then(serde_json::Value::as_i64);
    (description, format)
}

pub async fn list_resource_packs(paths: &Paths, id: &str) -> Result<Vec<ResourcePackEntry>> {
    list_packs(paths, id, "resourcepacks").await
}

/// Shader packs share the resource-pack shape: zips or unpacked folders.
pub async fn list_shader_packs(paths: &Paths, id: &str) -> Result<Vec<ResourcePackEntry>> {
    list_packs(paths, id, "shaderpacks").await
}

async fn list_packs(paths: &Paths, id: &str, folder: &str) -> Result<Vec<ResourcePackEntry>> {
    let dir = paths.instance_game_dir(id).join(folder);
    let packs = tokio::task::spawn_blocking(move || {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            return Vec::new();
        };
        let mut packs: Vec<ResourcePackEntry> = entries
            .flatten()
            .filter_map(|entry| {
                let path = entry.path();
                let file_name = entry.file_name().to_string_lossy().into_owned();
                let size_bytes = entry.metadata().ok().map(|meta| meta.len()).unwrap_or(0);

                if path.is_dir() {
                    return Some(ResourcePackEntry {
                        name: file_name.clone(),
                        file_name,
                        description: None,
                        size_bytes: dir_size(&path),
                        pack_format: None,
                    });
                }
                if !file_name.to_ascii_lowercase().ends_with(".zip") {
                    return None;
                }
                let (description, pack_format) = read_pack_mcmeta(&path);
                Some(ResourcePackEntry {
                    name: file_name.trim_end_matches(".zip").to_owned(),
                    file_name,
                    description,
                    size_bytes,
                    pack_format,
                })
            })
            .collect();
        packs.sort_by_key(|item| item.name.to_lowercase());
        packs
    })
    .await
    .map_err(|error| {
        LauncherError::internal("Сбой чтения ресурспаков").with_detail(error.to_string())
    })?;

    Ok(packs)
}

pub async fn list_screenshots(paths: &Paths, id: &str) -> Result<Vec<ScreenshotEntry>> {
    let dir = paths.instance_game_dir(id).join("screenshots");
    let mut entries = match tokio::fs::read_dir(&dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(LauncherError::io("Не удалось прочитать папку скриншотов")
                .with_detail(error.to_string()))
        }
    };

    let mut shots = Vec::new();
    while let Some(entry) = entries.next_entry().await.map_err(|error| {
        LauncherError::io("Не удалось перечислить скриншоты").with_detail(error.to_string())
    })? {
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if !file_name.to_ascii_lowercase().ends_with(".png") {
            continue;
        }
        let meta = entry.metadata().await.ok();
        shots.push(ScreenshotEntry {
            file_name,
            taken_at: meta
                .as_ref()
                .and_then(|meta| meta.modified().ok())
                .map(iso_of)
                .unwrap_or_default(),
            size_bytes: meta.map(|meta| meta.len()).unwrap_or(0),
        });
    }

    shots.sort_by(|a, b| b.taken_at.cmp(&a.taken_at));
    Ok(shots)
}

/// Tail of the most recent log, for the Logs tab before a session starts.
pub async fn read_recent_log(paths: &Paths, id: &str, max_lines: usize) -> Result<Vec<String>> {
    let logs = paths.instance_game_dir(id).join("logs");
    let latest = logs.join("latest.log");

    let path = if latest.is_file() {
        latest
    } else {
        // Fall back to the newest rolled log.
        let mut newest: Option<(std::time::SystemTime, PathBuf)> = None;
        if let Ok(mut entries) = tokio::fs::read_dir(&logs).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
                if !name.ends_with(".log") {
                    continue;
                }
                if let Ok(modified) = entry.metadata().await.and_then(|meta| meta.modified()) {
                    if newest.as_ref().is_none_or(|(time, _)| modified > *time) {
                        newest = Some((modified, entry.path()));
                    }
                }
            }
        }
        match newest {
            Some((_, path)) => path,
            None => return Ok(Vec::new()),
        }
    };

    let bytes = match tokio::fs::read(&path).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(LauncherError::io("Не удалось прочитать журнал")
                .with_detail(error.to_string()))
        }
    };

    // Game logs are not guaranteed to be valid UTF-8 on Windows locales.
    let text = String::from_utf8_lossy(&bytes);
    let lines: Vec<String> = text.lines().map(str::to_owned).collect();
    let start = lines.len().saturating_sub(max_lines);
    Ok(lines[start..].to_vec())
}

/// Deletes a resource pack or shader pack (file or unpacked folder) and drops
/// it from that folder's index.
pub async fn remove_pack(
    paths: &Paths,
    id: &str,
    kind: crate::mods::ProjectKind,
    file_name: &str,
) -> Result<()> {
    let plain = std::path::Path::new(file_name).components().count() == 1
        && !file_name.contains("..");
    if !plain {
        return Err(LauncherError::io("Недопустимое имя файла"));
    }
    let path = paths.instance_game_dir(id).join(kind.folder()).join(file_name);
    let removed = if path.is_dir() {
        tokio::fs::remove_dir_all(&path).await
    } else {
        tokio::fs::remove_file(&path).await
    };
    removed.map_err(|error| {
        LauncherError::io(format!("Не удалось удалить {file_name}")).with_detail(error.to_string())
    })?;

    let mut index = crate::mods::index::ModIndex::load(paths, id, kind).await?;
    if index.get(file_name).is_some() {
        index.remove(file_name);
        index.save(paths, id, kind).await?;
    }
    Ok(())
}
