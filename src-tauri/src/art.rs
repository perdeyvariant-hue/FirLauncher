//! Game pictures for instance covers: block textures, the title-screen
//! panorama of each game version and the player's own screenshots.
//!
//! Nothing here ships with the launcher. Block textures come from a client
//! jar the launcher downloaded to run the game, panoramas from Mojang's asset
//! store (the same files a launch downloads), screenshots from the instance.
//! Without them the interface falls back to its own drawings.

use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::error::{LauncherError, Result};
use crate::minecraft::{assets, manifest};
use crate::net::download::{self, DownloadItem, ProgressSink};
use crate::paths::Paths;

/// Cover thumbnails: the card's 16:10, at twice its usual size for sharpness.
const THUMB_WIDTH: u32 = 512;
const THUMB_HEIGHT: u32 = 320;
/// Nothing a block texture needs; a guard against reading junk into memory.
const MAX_TEXTURE_BYTES: u64 = 64 * 1024;
const MAX_SOURCE_BYTES: u64 = 32 * 1024 * 1024;
const PROBE: &str = "assets/minecraft/textures/block/stone.png";
/// The first of the six title-screen views: the one the game opens on.
const PANORAMA: &str = "minecraft/textures/gui/title/background/panorama_0.png";
const PANORAMA_IN_JAR: &str = "assets/minecraft/textures/gui/title/background/panorama_0.png";
const RESOURCES_BASE: &str = "https://resources.download.minecraft.net";

fn art_dir(paths: &Paths) -> PathBuf {
    paths.meta().join("art")
}

fn data_url(mime: &str, bytes: &[u8]) -> String {
    let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes);
    format!("data:{mime};base64,{encoded}")
}

/// "1.21.1" → [1, 21, 1]; anything unparsable sorts first.
fn version_key(id: &str) -> Vec<u32> {
    id.split(['.', '-'])
        .map_while(|part| part.parse::<u32>().ok())
        .collect()
}

fn has_flattened_blocks(jar: &Path) -> bool {
    std::fs::File::open(jar)
        .ok()
        .and_then(|file| zip::ZipArchive::new(file).ok())
        .is_some_and(|mut archive| archive.by_name(PROBE).is_ok())
}

/// Game version ids name folders; keep them to what Mojang uses.
fn valid_version(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && !id.starts_with('.')
        && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ' '))
}

/// The client jar to read a version's blocks from: its own when it is
/// downloaded and uses the flattened (1.13+) names, else the newest one.
fn client_jar_for(paths: &Paths, version: Option<&str>) -> Option<PathBuf> {
    if let Some(version) = version.filter(|id| valid_version(id)) {
        let own = paths.client_jar(version);
        if own.is_file() && has_flattened_blocks(&own) {
            return Some(own);
        }
    }
    newest_client_jar(paths)
}

/// The newest downloaded client jar that has the flattened (1.13+) block
/// textures; older ones name them differently.
fn newest_client_jar(paths: &Paths) -> Option<PathBuf> {
    let mut best: Option<(Vec<u32>, PathBuf)> = None;
    for entry in std::fs::read_dir(paths.versions()).ok()?.flatten() {
        let id = entry.file_name().to_string_lossy().into_owned();
        let jar = entry.path().join(format!("{id}.jar"));
        if !jar.is_file() {
            continue;
        }
        let key = version_key(&id);
        if key.is_empty() || best.as_ref().is_some_and(|(have, _)| *have >= key) {
            continue;
        }
        if has_flattened_blocks(&jar) {
            best = Some((key, jar));
        }
    }
    best.map(|(_, jar)| jar)
}

fn valid_texture_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 48
        && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// Block textures by name (`"tnt_side"`) as PNG data URLs, from the given
/// game version's client when possible. Names the jar lacks — a block newer
/// than it — are left out.
pub async fn block_textures(
    paths: &Paths,
    version: Option<String>,
    names: Vec<String>,
) -> Result<HashMap<String, String>> {
    let paths = paths.clone();
    tokio::task::spawn_blocking(move || {
        let mut found = HashMap::new();
        let Some(jar) = client_jar_for(&paths, version.as_deref()) else { return found };
        let Ok(file) = std::fs::File::open(jar) else { return found };
        let Ok(mut archive) = zip::ZipArchive::new(file) else { return found };
        for name in names.into_iter().filter(|name| valid_texture_name(name)) {
            let inside = format!("assets/minecraft/textures/block/{name}.png");
            let Ok(mut entry) = archive.by_name(&inside) else { continue };
            if entry.size() > MAX_TEXTURE_BYTES {
                continue;
            }
            let mut bytes = Vec::new();
            if entry.read_to_end(&mut bytes).is_ok() {
                found.insert(name, data_url("image/png", &bytes));
            }
        }
        found
    })
    .await
    .map_err(|error| LauncherError::internal("Не удалось прочитать текстуры").with_detail(error.to_string()))
}

/// A 16:10 JPEG cut from the middle of a picture.
fn thumbnail(bytes: &[u8]) -> Option<Vec<u8>> {
    let picture = image::load_from_memory(bytes).ok()?;
    let (width, height) = (picture.width(), picture.height());
    if width == 0 || height == 0 {
        return None;
    }
    // Crop to 16:10 around the centre, then scale.
    let (crop_w, crop_h) = if width * 10 > height * 16 {
        (height * 16 / 10, height)
    } else {
        (width, width * 10 / 16)
    };
    let cropped = picture.crop_imm((width - crop_w) / 2, (height - crop_h) / 2, crop_w, crop_h);
    let small = cropped.resize_exact(THUMB_WIDTH, THUMB_HEIGHT, image::imageops::FilterType::Triangle);
    let mut out = Cursor::new(Vec::new());
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 82);
    small.to_rgb8().write_with_encoder(encoder).ok()?;
    Some(out.into_inner())
}

/// Reads a cached thumbnail, or makes it from `source` and caches it.
fn cached_thumbnail(cache: &Path, source: &Path) -> Option<String> {
    if let Ok(bytes) = std::fs::read(cache) {
        return Some(data_url("image/jpeg", &bytes));
    }
    if std::fs::metadata(source).ok()?.len() > MAX_SOURCE_BYTES {
        return None;
    }
    let thumb = thumbnail(&std::fs::read(source).ok()?)?;
    if let Some(parent) = cache.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(cache, &thumb);
    Some(data_url("image/jpeg", &thumb))
}

/// Swallows progress: one small file needs no progress bar.
struct Quiet;

impl ProgressSink for Quiet {
    fn add_bytes(&self, _bytes: u64) {}
    fn item_finished(&self, _done: usize, _total: usize) {}
}

/// Where a version's title-screen panorama lives, fetching the asset index
/// and the one picture when they are not downloaded yet.
async fn panorama_source(client: &reqwest::Client, paths: &Paths, version: &str) -> Result<Option<(String, PathBuf)>> {
    let profile = match crate::config::read_json_opt::<crate::minecraft::version::VersionJson>(
        &manifest::version_cache(paths, version),
    )
    .await?
    {
        Some(profile) => profile,
        None => {
            let listing = manifest::load_manifest(client, paths, false).await?;
            manifest::load_version_json(client, paths, &listing, version).await?
        }
    };

    if let Some(index_ref) = &profile.asset_index {
        let index = assets::load_index(client, &paths.assets(), index_ref).await?;
        if let Some(object) = index.objects.get(PANORAMA) {
            let target = assets::object_path(&paths.assets(), &object.hash);
            if !target.is_file() {
                let prefix: String = object.hash.chars().take(2).collect();
                let item = DownloadItem::new(format!("{RESOURCES_BASE}/{prefix}/{}", object.hash), target.clone())
                    .with_sha1(Some(object.hash.clone()))
                    .with_size(Some(object.size));
                download::download_all(
                    client,
                    vec![item],
                    1,
                    tokio_util::sync::CancellationToken::new(),
                    Arc::new(Quiet),
                )
                .await?;
            }
            return Ok(Some((object.hash.clone(), target)));
        }
    }
    // Before 1.13 the panorama sits inside the client jar.
    Ok(None)
}

/// The title-screen panorama of a game version as a cover thumbnail, or
/// none when it cannot be had (an old version never launched, no network).
pub async fn version_panorama(client: &reqwest::Client, paths: &Paths, version: &str) -> Result<Option<String>> {
    if !valid_version(version) {
        return Ok(None);
    }
    let from_assets = panorama_source(client, paths, version).await.unwrap_or(None);
    let paths = paths.clone();
    let version = version.to_owned();
    tokio::task::spawn_blocking(move || {
        let dir = art_dir(&paths);
        if let Some((hash, source)) = from_assets {
            return cached_thumbnail(&dir.join(format!("panorama-{hash}.jpg")), &source);
        }
        let cache = dir.join(format!("panorama-jar-{version}.jpg"));
        if let Ok(bytes) = std::fs::read(&cache) {
            return Some(data_url("image/jpeg", &bytes));
        }
        let jar = paths.client_jar(&version);
        let mut archive = zip::ZipArchive::new(std::fs::File::open(jar).ok()?).ok()?;
        let mut entry = archive.by_name(PANORAMA_IN_JAR).ok()?;
        if entry.size() > MAX_SOURCE_BYTES {
            return None;
        }
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).ok()?;
        let thumb = thumbnail(&bytes)?;
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(&cache, &thumb);
        Some(data_url("image/jpeg", &thumb))
    })
    .await
    .map_err(|error| LauncherError::internal("Не удалось прочитать панораму").with_detail(error.to_string()))
}

/// The newest screenshot of an instance as a cover thumbnail, if it has any.
pub async fn instance_cover(paths: &Paths, instance_id: &str) -> Result<Option<String>> {
    // Refuses ids that are not instances before touching any path.
    crate::instances::read_meta(paths, instance_id).await?;
    let paths = paths.clone();
    let id = instance_id.to_owned();
    tokio::task::spawn_blocking(move || {
        let folder = paths.instance_game_dir(&id).join("screenshots");
        let newest = std::fs::read_dir(&folder)
            .ok()?
            .flatten()
            .filter(|entry| {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                name.ends_with(".png") || name.ends_with(".jpg") || name.ends_with(".jpeg")
            })
            .filter_map(|entry| {
                let meta = entry.metadata().ok()?;
                let stamp = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
                Some((stamp, meta.len(), entry.path()))
            })
            .max_by_key(|(stamp, _, _)| *stamp)?;
        let (stamp, size, source) = newest;
        let dir = art_dir(&paths);
        let prefix = format!("shot-{id}-");
        let cache = dir.join(format!("{prefix}{stamp}-{size}.jpg"));
        // Older covers of this instance are stale now.
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with(&prefix) && entry.path() != cache {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
        cached_thumbnail(&cache, &source)
    })
    .await
    .map_err(|error| LauncherError::internal("Не удалось прочитать скриншот").with_detail(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_order_numerically() {
        assert!(version_key("1.21.1") > version_key("1.9.4"));
        assert!(version_key("1.21.1") > version_key("1.21"));
        assert!(version_key("fabric-loader-0.16").is_empty());
    }

    #[test]
    fn version_ids_stay_inside_their_folders() {
        assert!(valid_version("1.21.1"));
        assert!(valid_version("25w03a"));
        assert!(valid_version("1.16.5-forge-36.2.42"));
        assert!(!valid_version("../secret"));
        assert!(!valid_version("a/b"));
        assert!(!valid_version(""));
    }

    #[test]
    fn texture_names_stay_inside_the_block_folder() {
        assert!(valid_texture_name("tnt_side"));
        assert!(!valid_texture_name("../../../secret"));
        assert!(!valid_texture_name("Stone"));
        assert!(!valid_texture_name(""));
    }

    #[test]
    fn thumbnails_are_cut_to_the_cover_shape() {
        let square = image::RgbImage::from_pixel(64, 64, image::Rgb([30, 120, 60]));
        let mut png = Cursor::new(Vec::new());
        assert!(image::DynamicImage::ImageRgb8(square).write_to(&mut png, image::ImageFormat::Png).is_ok());
        let thumb = thumbnail(png.get_ref()).unwrap_or_default();
        let decoded = image::load_from_memory(&thumb).map(|picture| (picture.width(), picture.height()));
        assert_eq!(decoded.ok(), Some((THUMB_WIDTH, THUMB_HEIGHT)));
    }
}
