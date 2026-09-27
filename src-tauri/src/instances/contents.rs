//! Reading what is inside an instance folder: mods, worlds, resource packs,
//! screenshots and the log tail.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{LauncherError, Result};
use crate::mods::index::{IndexEntry, ModIndex};
use crate::mods::ProjectKind;
use crate::paths::Paths;

const DISABLED_SUFFIX: &str = ".disabled";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModSource {
    pub provider: String,
    pub project_id: String,
    /// What is installed now, so the version picker can mark it.
    pub version_id: String,
    pub version_number: String,
}

impl ModSource {
    fn of(entry: &IndexEntry) -> Self {
        Self {
            provider: serde_json::to_value(entry.provider)
                .ok()
                .and_then(|value| value.as_str().map(str::to_owned))
                .unwrap_or_default(),
            project_id: entry.project_id.clone(),
            version_id: entry.version_id.clone(),
            version_number: entry.version_number.clone(),
        }
    }
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
    /// Set when the pack came from a known provider.
    pub source: Option<ModSource>,
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

/// The value of `key = "..."` on a TOML line, without a TOML parser: a few
/// keys of one block are all `mods.toml` is read for. Trailing comments are
/// common there (`displayName="JEI" #mandatory`) and must not come along.
fn toml_value<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let rest = line.trim().strip_prefix(key)?;
    // `versionRange` must not answer for `version`.
    if rest.starts_with(|c: char| c.is_alphanumeric() || c == '_') {
        return None;
    }
    let rest = rest.trim_start().strip_prefix('=')?.trim_start();
    match rest.strip_prefix(['"', '\'']) {
        // Quoted: the value ends at the closing quote, whatever follows it.
        Some(inner) => {
            let quote = rest.chars().next()?;
            inner.split(quote).next()
        }
        // Bare: the value ends at a comment.
        None => Some(rest.split('#').next()?.trim()),
    }
}

/// `Implementation-Version` from the jar manifest, which is what Forge mods
/// mean when they write `version="${file.jarVersion}"`.
fn manifest_version(archive: &mut zip::ZipArchive<std::fs::File>) -> Option<String> {
    let mut entry = archive.by_name("META-INF/MANIFEST.MF").ok()?;
    let mut text = String::new();
    std::io::Read::read_to_string(&mut entry, &mut text).ok()?;
    text.lines()
        .find_map(|line| line.trim().strip_prefix("Implementation-Version:"))
        .map(|value| value.trim().to_owned())
}

/// Name, version and author out of Forge's or NeoForge's `mods.toml`: the
/// first `[[mods]]` block describes the mod itself.
fn read_toml_metadata(
    archive: &mut zip::ZipArchive<std::fs::File>,
) -> Option<(String, Option<String>, Option<String>)> {
    let mut text = String::new();
    for entry_name in ["META-INF/mods.toml", "META-INF/neoforge.mods.toml"] {
        if let Ok(mut entry) = archive.by_name(entry_name) {
            text.clear();
            if std::io::Read::read_to_string(&mut entry, &mut text).is_ok() && !text.is_empty() {
                break;
            }
        }
    }
    if text.is_empty() {
        return None;
    }

    let mut name = None;
    let mut version = None;
    let mut author = None;
    let mut inside = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("[[") {
            // The first block is the mod; a second one is another mod in the
            // same jar and has nothing to add.
            if inside {
                break;
            }
            inside = trimmed.starts_with("[[mods]]");
            continue;
        }
        if !inside {
            continue;
        }
        if let Some(value) = toml_value(trimmed, "displayName") {
            name = Some(value.to_owned());
        } else if let Some(value) = toml_value(trimmed, "version") {
            version = Some(value.to_owned());
        } else if let Some(value) = toml_value(trimmed, "authors") {
            author = Some(value.to_owned());
        } else if name.is_none() {
            if let Some(value) = toml_value(trimmed, "modId") {
                name = Some(value.to_owned());
            }
        }
    }

    let name = name?;
    // Forge substitutes this at build time; the jar keeps the real number.
    let version = match version {
        Some(value) if value.contains("${") => manifest_version(archive),
        other => other,
    };
    let author = author.filter(|value| !value.is_empty());
    Some((name, version, author))
}

/// Reads what a jar says about itself: `fabric.mod.json`, `quilt.mod.json`
/// or Forge's and NeoForge's `mods.toml`. Only a jar that declares nothing
/// falls back to its file name.
fn read_jar_metadata(path: &Path) -> Option<(String, Option<String>, Option<String>)> {
    let file = std::fs::File::open(path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;

    for entry_name in ["fabric.mod.json", "quilt.mod.json"] {
        let Ok(entry) = archive.by_name(entry_name) else {
            continue;
        };
        let Ok(parsed) = serde_json::from_reader::<_, serde_json::Value>(entry) else {
            continue;
        };
        // Quilt nests everything under `quilt_loader`.
        let root = parsed
            .get("quilt_loader")
            .and_then(|value| value.get("metadata"))
            .unwrap_or(&parsed);
        let Ok(meta) = serde_json::from_value::<FabricModJson>(root.clone()) else {
            continue;
        };
        let version = parsed
            .get("quilt_loader")
            .and_then(|value| value.get("version"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned)
            .or(meta.version);
        if let Some(name) = meta.name.or(meta.id) {
            return Some((name, version, author_of(&meta.authors)));
        }
    }

    read_toml_metadata(&mut archive)
}

/// The path inside the jar of the picture the mod ships as its logo.
fn icon_path(archive: &mut zip::ZipArchive<std::fs::File>) -> Option<String> {
    for entry_name in ["fabric.mod.json", "quilt.mod.json"] {
        let Ok(entry) = archive.by_name(entry_name) else { continue };
        let Ok(parsed) = serde_json::from_reader::<_, serde_json::Value>(entry) else { continue };
        let root = parsed
            .get("quilt_loader")
            .and_then(|value| value.get("metadata"))
            .unwrap_or(&parsed);
        let icon = root.get("icon")?;
        // Either a path, or a map of sizes to paths — take the largest.
        if let Some(path) = icon.as_str() {
            return Some(path.to_owned());
        }
        if let Some(sizes) = icon.as_object() {
            let mut best: Option<(u32, &str)> = None;
            for (size, path) in sizes {
                let size = size.parse::<u32>().unwrap_or(0);
                let Some(path) = path.as_str() else { continue };
                if best.is_none_or(|(known, _)| size > known) {
                    best = Some((size, path));
                }
            }
            return best.map(|(_, path)| path.to_owned());
        }
    }

    let mut text = String::new();
    for entry_name in ["META-INF/mods.toml", "META-INF/neoforge.mods.toml"] {
        if let Ok(mut entry) = archive.by_name(entry_name) {
            text.clear();
            let _ = std::io::Read::read_to_string(&mut entry, &mut text);
        }
        if let Some(path) = text.lines().find_map(|line| toml_value(line, "logoFile")) {
            if !path.is_empty() {
                return Some(path.to_owned());
            }
        }
    }

    // Plenty of Forge and NeoForge mods ship an icon without declaring it.
    for guess in ["icon.png", "logo.png", "pack.png"] {
        if archive.by_name(guess).is_ok() {
            return Some(String::from(guess));
        }
    }
    None
}

/// Big enough for the 256x256 logos mods and packs ship, small enough that a
/// broken file cannot hand the interface a megabyte of nonsense.
const MAX_ICON_BYTES: u64 = 512 * 1024;

/// A picture as a data URL, or `None` if the bytes are not a picture at all,
/// whatever the metadata claimed.
fn image_data_url(bytes: &[u8]) -> Option<String> {
    let mime = match bytes {
        [0x89, b'P', b'N', b'G', ..] => "image/png",
        [0xFF, 0xD8, 0xFF, ..] => "image/jpeg",
        [b'G', b'I', b'F', ..] => "image/gif",
        _ => return None,
    };
    let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes);
    Some(format!("data:{mime};base64,{encoded}"))
}

/// Reads one entry of a zip, refusing anything too big to be an icon.
fn zip_image(archive: &mut zip::ZipArchive<std::fs::File>, inside: &str) -> Option<String> {
    let mut entry = archive.by_name(inside.trim_start_matches('/')).ok()?;
    if entry.size() > MAX_ICON_BYTES {
        return None;
    }
    let mut bytes = Vec::with_capacity(usize::try_from(entry.size()).unwrap_or(0));
    std::io::Read::read_to_end(&mut entry, &mut bytes).ok()?;
    image_data_url(&bytes)
}

/// A file in one of the content folders, rejecting anything that is not a
/// plain name inside it.
fn content_file(paths: &Paths, id: &str, folder: &str, file_name: &str) -> Result<PathBuf> {
    let looks_like_a_path = file_name.is_empty()
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name.contains(':')
        || file_name == ".."
        || file_name == ".";
    if looks_like_a_path {
        return Err(LauncherError::io(format!("Недопустимое имя файла: {file_name}")));
    }
    Ok(paths.instance_game_dir(id).join(folder).join(file_name))
}

/// A mod file, rejecting anything that is not a plain name in `mods/`.
fn mods_file(paths: &Paths, id: &str, file_name: &str) -> Result<PathBuf> {
    content_file(paths, id, "mods", file_name)
}

/// The mod's own icon, as a data URL. Jars carry it next to their metadata,
/// so this works offline and for mods the launcher did not install.
pub async fn mod_icon(paths: &Paths, id: &str, file_name: &str) -> Result<Option<String>> {
    let path = mods_file(paths, id, file_name)?;
    tokio::task::spawn_blocking(move || {
        let Ok(file) = std::fs::File::open(&path) else { return None };
        let mut archive = zip::ZipArchive::new(file).ok()?;
        let inside = icon_path(&mut archive)?;
        zip_image(&mut archive, &inside)
    })
    .await
    .map_err(|error| LauncherError::internal("Не удалось прочитать иконку мода").with_detail(error.to_string()))
}

/// Mod ids a jar declares: `fabric.mod.json` / `quilt.mod.json` ids and
/// `modId` entries of Forge's and NeoForge's `mods.toml`.
fn read_mod_ids(path: &Path) -> Vec<String> {
    let Ok(file) = std::fs::File::open(path) else { return Vec::new() };
    let Ok(mut archive) = zip::ZipArchive::new(file) else { return Vec::new() };
    let mut ids = Vec::new();

    for entry_name in ["fabric.mod.json", "quilt.mod.json"] {
        let Ok(entry) = archive.by_name(entry_name) else { continue };
        let Ok(parsed) = serde_json::from_reader::<_, serde_json::Value>(entry) else { continue };
        let id = parsed
            .get("quilt_loader")
            .and_then(|loader| loader.get("id"))
            .or_else(|| parsed.get("id"))
            .and_then(serde_json::Value::as_str);
        if let Some(id) = id {
            ids.push(id.to_owned());
        }
    }
    for entry_name in ["META-INF/mods.toml", "META-INF/neoforge.mods.toml"] {
        let Ok(mut entry) = archive.by_name(entry_name) else { continue };
        let mut text = String::new();
        if std::io::Read::read_to_string(&mut entry, &mut text).is_err() {
            continue;
        }
        // Only `modId = "x"` lines matter; a full TOML parser is not needed.
        for line in text.lines() {
            let line = line.trim();
            if let Some(rest) = line.strip_prefix("modId") {
                let value = rest.trim_start().trim_start_matches('=').trim();
                let value = value.trim_matches(|c| c == '"' || c == '\'');
                if !value.is_empty() && !ids.iter().any(|known| known == value) {
                    ids.push(value.to_owned());
                }
            }
        }
    }
    ids
}

/// Which file in `mods/` provides each mod id (enabled or not).
pub async fn mod_files_by_id(
    paths: &Paths,
    id: &str,
) -> Result<std::collections::HashMap<String, String>> {
    let dir = paths.instance_game_dir(id).join("mods");
    tokio::task::spawn_blocking(move || {
        let mut map = std::collections::HashMap::new();
        let Ok(entries) = std::fs::read_dir(&dir) else { return map };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let lower = name.to_ascii_lowercase();
            if !lower.ends_with(".jar") && !lower.ends_with(".jar.disabled") {
                continue;
            }
            for mod_id in read_mod_ids(&entry.path()) {
                map.insert(mod_id, name.clone());
            }
        }
        map
    })
    .await
    .map_err(|error| LauncherError::internal("Сбой чтения модов").with_detail(error.to_string()))
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

    let index = ModIndex::load(paths, id, ProjectKind::Mod)
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

                let source = index.get(&file_name).map(ModSource::of);
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
    let current = mods_file(paths, id, file_name)?;
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
        ModIndex::load(paths, id, ProjectKind::Mod).await?;
    if index.get(file_name).is_some() {
        index.remove(file_name);
        index.save(paths, id, ProjectKind::Mod).await?;
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

/// The picture a resource or shader pack carries: `pack.png` at its root,
/// in a zip or in an unpacked folder. Shader packs rarely have one; they get
/// the initials, same as a mod without an icon.
pub async fn pack_icon(
    paths: &Paths,
    id: &str,
    kind: ProjectKind,
    file_name: &str,
) -> Result<Option<String>> {
    const NAMES: [&str; 3] = ["pack.png", "icon.png", "logo.png"];

    let path = content_file(paths, id, kind.folder(), file_name)?;
    tokio::task::spawn_blocking(move || {
        if path.is_dir() {
            for name in NAMES {
                let candidate = path.join(name);
                let Ok(meta) = std::fs::metadata(&candidate) else { continue };
                if meta.len() > MAX_ICON_BYTES {
                    continue;
                }
                if let Some(url) = std::fs::read(&candidate).ok().and_then(|bytes| image_data_url(&bytes)) {
                    return Some(url);
                }
            }
            return None;
        }
        let file = std::fs::File::open(&path).ok()?;
        let mut archive = zip::ZipArchive::new(file).ok()?;
        NAMES.iter().find_map(|name| zip_image(&mut archive, name))
    })
    .await
    .map_err(|error| {
        LauncherError::internal("Не удалось прочитать картинку пака").with_detail(error.to_string())
    })
}

pub async fn list_resource_packs(paths: &Paths, id: &str) -> Result<Vec<ResourcePackEntry>> {
    list_packs(paths, id, ProjectKind::ResourcePack).await
}

/// Shader packs share the resource-pack shape: zips or unpacked folders.
pub async fn list_shader_packs(paths: &Paths, id: &str) -> Result<Vec<ResourcePackEntry>> {
    list_packs(paths, id, ProjectKind::Shader).await
}

async fn list_packs(paths: &Paths, id: &str, kind: ProjectKind) -> Result<Vec<ResourcePackEntry>> {
    let dir = paths.instance_game_dir(id).join(kind.folder());
    let index = ModIndex::load(paths, id, kind).await.unwrap_or_default();
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
                        source: None,
                    });
                }
                if !file_name.to_ascii_lowercase().ends_with(".zip") {
                    return None;
                }
                let (description, pack_format) = read_pack_mcmeta(&path);
                let source = index.get(&file_name).map(ModSource::of);
                Some(ResourcePackEntry {
                    name: file_name.trim_end_matches(".zip").to_owned(),
                    file_name,
                    description,
                    size_bytes,
                    pack_format,
                    source,
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
    kind: ProjectKind,
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

    let mut index = ModIndex::load(paths, id, kind).await?;
    if index.get(file_name).is_some() {
        index.remove(file_name);
        index.save(paths, id, kind).await?;
    }
    Ok(())
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_quoted_value_stops_at_its_closing_quote() {
        // JEI writes its metadata exactly like this.
        assert_eq!(
            toml_value("displayName=\"Just Enough Items\" #mandatory", "displayName"),
            Some("Just Enough Items")
        );
        assert_eq!(
            toml_value("  version = \"15.62.0.216\"  # the version", "version"),
            Some("15.62.0.216")
        );
        assert_eq!(toml_value("authors = 'mezz'", "authors"), Some("mezz"));
    }

    #[test]
    fn a_longer_key_does_not_answer_for_a_shorter_one() {
        // Forge files are full of versionRange lines; none of them is a version.
        assert_eq!(toml_value("versionRange=\"[47.0,)\" #mandatory", "version"), None);
        assert_eq!(toml_value("displayNameSuffix=\"beta\"", "displayName"), None);
    }

    #[test]
    fn an_unquoted_value_stops_at_the_comment() {
        assert_eq!(toml_value("modId=jei # the id", "modId"), Some("jei"));
        assert_eq!(toml_value("nothing here", "modId"), None);
    }

    #[test]
    fn only_real_pictures_become_data_urls() {
        let png = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        assert!(image_data_url(&png).is_some_and(|url| url.starts_with("data:image/png;base64,")));
        assert!(image_data_url(b"<html>not a picture</html>").is_none());
        assert!(image_data_url(&[]).is_none());
    }

    #[tokio::test]
    async fn a_resource_pack_shows_its_pack_png() {
        use std::io::Write;

        let dir = std::env::temp_dir().join(format!("fir-pack-icon-{}", uuid::Uuid::new_v4()));
        let paths = match Paths::resolve(Some(&dir.to_string_lossy())) {
            Ok(paths) => paths,
            Err(error) => panic!("paths: {error:?}"),
        };
        let packs = paths.instance_game_dir("t").join("resourcepacks");
        if let Err(error) = std::fs::create_dir_all(&packs) {
            panic!("mkdir: {error:?}");
        }

        // A zip with a pack.png at its root, the way every resource pack ships.
        let png = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4];
        let file = match std::fs::File::create(packs.join("Faithful.zip")) {
            Ok(file) => file,
            Err(error) => panic!("create: {error:?}"),
        };
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        if let Err(error) = zip.start_file("pack.png", options) {
            panic!("zip: {error:?}");
        }
        if let Err(error) = zip.write_all(&png) {
            panic!("zip write: {error:?}");
        }
        if let Err(error) = zip.finish() {
            panic!("zip finish: {error:?}");
        }

        let icon = pack_icon(&paths, "t", ProjectKind::ResourcePack, "Faithful.zip").await;
        let _ = std::fs::remove_dir_all(&dir);
        assert!(matches!(icon, Ok(Some(ref url)) if url.starts_with("data:image/png;base64,")), "{icon:?}");
    }

    #[test]
    fn a_file_name_that_is_a_path_is_refused() {
        let paths = match Paths::resolve(Some("./test-data")) {
            Ok(paths) => paths,
            Err(error) => panic!("paths: {error:?}"),
        };
        assert!(mods_file(&paths, "i", "../../evil.jar").is_err());
        assert!(mods_file(&paths, "i", "sub/dir.jar").is_err());
        assert!(mods_file(&paths, "i", "C:evil.jar").is_err());
        assert!(mods_file(&paths, "i", "sodium.jar").is_ok());
        assert!(mods_file(&paths, "i", "sodium.jar.disabled").is_ok());
    }
}
