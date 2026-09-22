//! The user's own pictures for personalisation: a wallpaper and a collection
//! of corner mascots. They are copied into `<data>/appearance/` so they
//! survive the originals being moved, stay on this computer only, and are
//! handed to the webview as `data:` URLs.

use std::path::{Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::error::{ErrorKind, LauncherError, Result};
use crate::paths::Paths;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageSlot {
    Wallpaper,
}

/// Big enough for a 4K screenshot, small enough to pass through IPC.
const WALLPAPER_MAX_BYTES: u64 = 15 * 1024 * 1024;
const MASCOT_MAX_BYTES: u64 = 8 * 1024 * 1024;

/// Formats the webview can show, told apart by their magic bytes rather than
/// by the file name.
const FORMATS: &[(&str, &str)] = &[
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
];

fn sniff(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    let found = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "png"
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "jpg"
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "gif"
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "webp"
    } else {
        return None;
    };
    FORMATS.iter().find(|(ext, _)| *ext == found).copied()
}

fn mime_of(ext: &str) -> Option<&'static str> {
    FORMATS.iter().find(|(known, _)| *known == ext).map(|(_, mime)| *mime)
}

fn dir(paths: &Paths) -> PathBuf {
    paths.root().join("appearance")
}

fn mascots_dir(paths: &Paths) -> PathBuf {
    dir(paths).join("mascots")
}

fn data_url(mime: &str, bytes: &[u8]) -> String {
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    format!("data:{mime};base64,{encoded}")
}

fn io_error(message: &str, error: &std::io::Error) -> LauncherError {
    LauncherError::io(message.to_owned()).with_detail(error.to_string())
}

/// Reads a picked file, refusing oversized files and anything that is not a
/// picture the webview can show.
async fn read_picture(source: &Path, max_bytes: u64) -> Result<(Vec<u8>, &'static str, &'static str)> {
    let size = tokio::fs::metadata(source)
        .await
        .map_err(|error| io_error("Не удалось открыть изображение", &error))?
        .len();
    if size > max_bytes {
        return Err(LauncherError::new(
            ErrorKind::Io,
            format!(
                "Изображение слишком большое: {} МБ, можно до {} МБ",
                size / (1024 * 1024),
                max_bytes / (1024 * 1024)
            ),
        ));
    }
    let bytes = tokio::fs::read(source)
        .await
        .map_err(|error| io_error("Не удалось прочитать изображение", &error))?;
    let (ext, mime) = sniff(&bytes).ok_or_else(|| {
        LauncherError::new(ErrorKind::Parse, "Это не изображение: подойдут PNG, JPEG, GIF и WebP")
    })?;
    Ok((bytes, ext, mime))
}

/* ——— Wallpaper: one picture ——— */

fn slot_stem(slot: ImageSlot) -> &'static str {
    match slot {
        ImageSlot::Wallpaper => "wallpaper",
    }
}

/// Removes every stored variant of a slot (`wallpaper.png`, `wallpaper.jpg`…).
async fn remove_slot(paths: &Paths, slot: ImageSlot) {
    for (ext, _) in FORMATS {
        let _ = tokio::fs::remove_file(dir(paths).join(format!("{}.{ext}", slot_stem(slot)))).await;
    }
}

/// Copies a picture into the slot and returns it as a `data:` URL.
pub async fn set_image(paths: &Paths, slot: ImageSlot, source: &Path) -> Result<String> {
    let (bytes, ext, mime) = read_picture(source, WALLPAPER_MAX_BYTES).await?;
    tokio::fs::create_dir_all(dir(paths))
        .await
        .map_err(|error| io_error("Не удалось создать папку оформления", &error))?;
    remove_slot(paths, slot).await;
    tokio::fs::write(dir(paths).join(format!("{}.{ext}", slot_stem(slot))), &bytes)
        .await
        .map_err(|error| io_error("Не удалось сохранить изображение", &error))?;
    Ok(data_url(mime, &bytes))
}

/// The stored picture of a slot, if there is one.
pub async fn load_image(paths: &Paths, slot: ImageSlot) -> Result<Option<String>> {
    for (ext, mime) in FORMATS {
        let path = dir(paths).join(format!("{}.{ext}", slot_stem(slot)));
        match tokio::fs::read(&path).await {
            Ok(bytes) => return Ok(Some(data_url(mime, &bytes))),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(io_error("Не удалось прочитать изображение", &error)),
        }
    }
    Ok(None)
}

pub async fn clear_image(paths: &Paths, slot: ImageSlot) {
    remove_slot(paths, slot).await;
}

/* ——— Mascots: a collection ——— */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomMascot {
    /// Stored in settings as `mascotCustomId`.
    pub id: String,
    pub url: String,
}

/// Ids are plain slugs: they come back from the UI and name files on disk.
fn is_mascot_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 48
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Sortable by when it was added: `m<unix ms in hex>-<random>`.
fn new_mascot_id() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default();
    let random = uuid::Uuid::new_v4().simple().to_string();
    format!("m{millis:012x}-{}", &random[..6])
}

/// Before the collection existed there was a single `appearance/mascot.*`;
/// it becomes the first entry.
async fn adopt_legacy_mascot(paths: &Paths) {
    for (ext, _) in FORMATS {
        let old = dir(paths).join(format!("mascot.{ext}"));
        if tokio::fs::metadata(&old).await.is_ok() {
            let _ = tokio::fs::create_dir_all(mascots_dir(paths)).await;
            let _ = tokio::fs::rename(&old, mascots_dir(paths).join(format!("m000000000000-legacy.{ext}"))).await;
        }
    }
}

/// Copies a picture into the collection.
pub async fn add_mascot(paths: &Paths, source: &Path) -> Result<CustomMascot> {
    let (bytes, ext, mime) = read_picture(source, MASCOT_MAX_BYTES).await?;
    tokio::fs::create_dir_all(mascots_dir(paths))
        .await
        .map_err(|error| io_error("Не удалось создать папку талисманов", &error))?;
    let id = new_mascot_id();
    tokio::fs::write(mascots_dir(paths).join(format!("{id}.{ext}")), &bytes)
        .await
        .map_err(|error| io_error("Не удалось сохранить изображение", &error))?;
    Ok(CustomMascot { id, url: data_url(mime, &bytes) })
}

/// Every picture in the collection, oldest first. Files that are not ours
/// (wrong name or format) are left alone and not shown.
pub async fn list_mascots(paths: &Paths) -> Result<Vec<CustomMascot>> {
    adopt_legacy_mascot(paths).await;
    let mut entries = match tokio::fs::read_dir(mascots_dir(paths)).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(io_error("Не удалось прочитать папку талисманов", &error)),
    };
    let mut found: Vec<(String, PathBuf, &'static str)> = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|error| io_error("Не удалось прочитать папку талисманов", &error))?
    {
        let path = entry.path();
        let (Some(stem), Some(ext)) = (
            path.file_stem().and_then(|s| s.to_str()),
            path.extension().and_then(|s| s.to_str()),
        ) else {
            continue;
        };
        if let (true, Some(mime)) = (is_mascot_id(stem), mime_of(ext)) {
            found.push((stem.to_owned(), path.clone(), mime));
        }
    }
    found.sort_by(|a, b| a.0.cmp(&b.0));

    let mut out = Vec::with_capacity(found.len());
    for (id, path, mime) in found {
        if let Ok(bytes) = tokio::fs::read(&path).await {
            out.push(CustomMascot { id, url: data_url(mime, &bytes) });
        }
    }
    Ok(out)
}

pub async fn remove_mascot(paths: &Paths, id: &str) -> Result<()> {
    if !is_mascot_id(id) {
        return Err(LauncherError::new(ErrorKind::Io, "Недопустимый идентификатор талисмана"));
    }
    for (ext, _) in FORMATS {
        let _ = tokio::fs::remove_file(mascots_dir(paths).join(format!("{id}.{ext}"))).await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_are_recognised_by_content() {
        assert_eq!(sniff(b"\x89PNG\r\n\x1a\nrest").map(|f| f.0), Some("png"));
        assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0xE0]).map(|f| f.0), Some("jpg"));
        assert_eq!(sniff(b"GIF89a....").map(|f| f.0), Some("gif"));
        assert_eq!(sniff(b"RIFF\0\0\0\0WEBPVP8 ").map(|f| f.1), Some("image/webp"));
        assert_eq!(sniff(b"<svg onload=alert(1)>"), None, "SVG can carry script");
        assert_eq!(sniff(b""), None);
    }

    async fn scratch(name: &str) -> Result<(PathBuf, Paths)> {
        let root = std::env::temp_dir().join(format!("fir-{name}-{}", std::process::id()));
        let _ = tokio::fs::remove_dir_all(&root).await;
        tokio::fs::create_dir_all(&root).await?;
        let paths = Paths::resolve(Some(&root.to_string_lossy()))?;
        Ok((root, paths))
    }

    #[tokio::test]
    async fn a_wallpaper_round_trips_and_replaces_the_old_one() -> Result<()> {
        let (root, paths) = scratch("wallpaper").await?;
        let png = root.join("in.png");
        let jpg = root.join("in.jpg");
        tokio::fs::write(&png, b"\x89PNG\r\n\x1a\nfake").await?;
        tokio::fs::write(&jpg, [0xFF, 0xD8, 0xFF, 0xE0, 1, 2]).await?;

        let url = set_image(&paths, ImageSlot::Wallpaper, &png).await?;
        assert!(url.starts_with("data:image/png;base64,"));
        set_image(&paths, ImageSlot::Wallpaper, &jpg).await?;
        let loaded = load_image(&paths, ImageSlot::Wallpaper).await?;
        assert!(loaded.is_some_and(|url| url.starts_with("data:image/jpeg")));
        assert!(!dir(&paths).join("wallpaper.png").exists(), "the old format is gone");

        clear_image(&paths, ImageSlot::Wallpaper).await;
        assert_eq!(load_image(&paths, ImageSlot::Wallpaper).await?, None);
        let _ = tokio::fs::remove_dir_all(&root).await;
        Ok(())
    }

    #[tokio::test]
    async fn mascots_form_a_collection() -> Result<()> {
        let (root, paths) = scratch("mascots").await?;
        let png = root.join("a.png");
        tokio::fs::write(&png, b"\x89PNG\r\n\x1a\nfake").await?;

        // The single picture from before the collection is kept.
        tokio::fs::create_dir_all(dir(&paths)).await?;
        tokio::fs::write(dir(&paths).join("mascot.png"), b"\x89PNG\r\n\x1a\nold").await?;

        let first = add_mascot(&paths, &png).await?;
        tokio::time::sleep(std::time::Duration::from_millis(3)).await;
        let second = add_mascot(&paths, &png).await?;
        let listed: Vec<String> = list_mascots(&paths).await?.into_iter().map(|m| m.id).collect();
        assert_eq!(listed, vec![String::from("m000000000000-legacy"), first.id.clone(), second.id]);

        remove_mascot(&paths, &first.id).await?;
        assert_eq!(list_mascots(&paths).await?.len(), 2);
        assert!(remove_mascot(&paths, "../../evil").await.is_err());
        let _ = tokio::fs::remove_dir_all(&root).await;
        Ok(())
    }
}
