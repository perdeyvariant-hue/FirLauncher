//! Game pictures for instance covers: block textures, the title-screen
//! panoramas and the player's own screenshots.
//!
//! Nothing here ships with the launcher. Block textures come from a client
//! jar the launcher already downloaded to run the game, panoramas from the
//! downloaded asset objects, screenshots from the instance. Without them the
//! interface falls back to its own drawings.

use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

use crate::error::{LauncherError, Result};
use crate::paths::Paths;

/// Cover thumbnails: the card's 16:10, at twice its usual size for sharpness.
const THUMB_WIDTH: u32 = 512;
const THUMB_HEIGHT: u32 = 320;
/// Nothing a block texture needs; a guard against reading junk into memory.
const MAX_TEXTURE_BYTES: u64 = 64 * 1024;
const MAX_SOURCE_BYTES: u64 = 32 * 1024 * 1024;
const PROBE: &str = "assets/minecraft/textures/block/stone.png";

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
        let has_blocks = std::fs::File::open(&jar)
            .ok()
            .and_then(|file| zip::ZipArchive::new(file).ok())
            .is_some_and(|mut archive| archive.by_name(PROBE).is_ok());
        if has_blocks {
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

/// Block textures by name (`"tnt_side"`), as PNG data URLs. Names the jar
/// lacks — a block newer than the downloaded version — are left out.
pub async fn block_textures(paths: &Paths, names: Vec<String>) -> Result<HashMap<String, String>> {
    let paths = paths.clone();
    tokio::task::spawn_blocking(move || {
        let mut found = HashMap::new();
        let Some(jar) = newest_client_jar(&paths) else { return found };
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

/// The four side views of every title-screen panorama the launcher has
/// downloaded (one set per game version), as cover thumbnails.
pub async fn panoramas(paths: &Paths) -> Result<Vec<String>> {
    let paths = paths.clone();
    tokio::task::spawn_blocking(move || {
        let mut hashes: Vec<String> = Vec::new();
        let Ok(entries) = std::fs::read_dir(paths.assets().join("indexes")) else { return Vec::new() };
        let mut indexes: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).collect();
        indexes.sort();
        for index in indexes.iter().rev() {
            let Ok(text) = std::fs::read_to_string(index) else { continue };
            let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
            for side in 0..4 {
                let key = format!("minecraft/textures/gui/title/background/panorama_{side}.png");
                let Some(hash) = json["objects"][&key]["hash"].as_str() else { continue };
                if hash.len() == 40 && hash.chars().all(|c| c.is_ascii_hexdigit()) && !hashes.iter().any(|h| h == hash) {
                    hashes.push(hash.to_owned());
                }
            }
        }
        hashes
            .iter()
            .filter_map(|hash| {
                let source = paths.assets().join("objects").join(&hash[..2]).join(hash);
                let cache = art_dir(&paths).join(format!("panorama-{hash}.jpg"));
                source.is_file().then(|| cached_thumbnail(&cache, &source)).flatten()
            })
            .collect()
    })
    .await
    .map_err(|error| LauncherError::internal("Не удалось прочитать панорамы").with_detail(error.to_string()))
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
