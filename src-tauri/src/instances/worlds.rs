//! World backups, restore and import.
//!
//! Backups are plain zips in `instances/<id>/backups/`, one world each, with
//! the world folder as the single top-level directory — so a backup can also
//! be imported into another instance, or opened by hand.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{ErrorKind, LauncherError, Result};
use crate::paths::Paths;

/// Automatic backups kept per world; older ones are removed.
const AUTO_KEEP: usize = 3;
const SEPARATOR: &str = "__";
const AUTO_TAG: &str = "auto";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldBackup {
    pub file_name: String,
    pub world: String,
    pub created_at: String,
    pub size_bytes: u64,
    /// Made by the launcher before an update, not by the user.
    pub automatic: bool,
}

fn world_error(message: impl Into<String>) -> LauncherError {
    LauncherError::new(ErrorKind::Io, message)
}

fn io(message: &str) -> impl Fn(std::io::Error) -> LauncherError + '_ {
    move |error| world_error(message).with_detail(error.to_string())
}

fn zip_error(error: zip::result::ZipError) -> LauncherError {
    world_error("Ошибка архива").with_detail(error.to_string())
}

fn saves(paths: &Paths, id: &str) -> PathBuf {
    paths.instance_game_dir(id).join("saves")
}

fn backups(paths: &Paths, id: &str) -> PathBuf {
    paths.instance(id).join("backups")
}

/// A single path component with no traversal: world folders and backup
/// names come back from the UI.
fn plain(name: &str) -> Result<&str> {
    let ok = !name.is_empty()
        && !name.contains("..")
        && Path::new(name).components().count() == 1
        && !name.contains(['/', '\\']);
    if ok {
        Ok(name)
    } else {
        Err(world_error(format!("Недопустимое имя: {name}")))
    }
}

/// `<world>__2026-09-22_20-05-11[__auto].zip`
fn backup_name(world: &str, automatic: bool) -> String {
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
    if automatic {
        format!("{world}{SEPARATOR}{stamp}{SEPARATOR}{AUTO_TAG}.zip")
    } else {
        format!("{world}{SEPARATOR}{stamp}.zip")
    }
}

fn parse_name(file_name: &str) -> Option<(String, String, bool)> {
    let stem = file_name.strip_suffix(".zip")?;
    let (stem, automatic) = match stem.strip_suffix(&format!("{SEPARATOR}{AUTO_TAG}")) {
        Some(rest) => (rest, true),
        None => (stem, false),
    };
    let (world, stamp) = stem.rsplit_once(SEPARATOR)?;
    let parsed = chrono::NaiveDateTime::parse_from_str(stamp, "%Y-%m-%d_%H-%M-%S").ok()?;
    Some((world.to_owned(), parsed.format("%Y-%m-%dT%H:%M:%S").to_string(), automatic))
}

fn zip_dir(source: &Path, prefix: &str, dest: &Path) -> Result<u64> {
    let tmp = dest.with_extension("zip.part");
    let file = std::fs::File::create(&tmp).map_err(io("Не удалось создать архив"))?;
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .large_file(true);

    let mut stack = vec![source.to_path_buf()];
    let mut buffer = Vec::new();
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).map_err(io("Не удалось прочитать мир"))?.flatten() {
            let path = entry.path();
            let relative = path.strip_prefix(source).unwrap_or(&path);
            let name = format!("{prefix}/{}", relative.to_string_lossy().replace('\\', "/"));
            if path.is_dir() {
                writer.add_directory(format!("{name}/"), options).map_err(zip_error)?;
                stack.push(path);
                continue;
            }
            // The game holds session.lock open while running; it is not world data.
            if path.file_name().is_some_and(|n| n == "session.lock") {
                continue;
            }
            buffer.clear();
            std::fs::File::open(&path)
                .and_then(|mut f| f.read_to_end(&mut buffer))
                .map_err(io("Не удалось прочитать файл мира"))?;
            writer.start_file(name, options).map_err(zip_error)?;
            writer.write_all(&buffer).map_err(io("Не удалось записать архив"))?;
        }
    }
    writer.finish().map_err(zip_error)?;
    std::fs::rename(&tmp, dest).map_err(io("Не удалось сохранить архив"))?;
    Ok(std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0))
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| LauncherError::internal("Сбой фоновой операции").with_detail(error.to_string()))?
}

/// Zips one world into the instance's backups.
pub async fn backup(paths: &Paths, id: &str, world: &str, automatic: bool) -> Result<WorldBackup> {
    let world = plain(world)?.to_owned();
    let source = saves(paths, id).join(&world);
    if !source.is_dir() {
        return Err(world_error(format!("Мир «{world}» не найден")));
    }
    let dir = backups(paths, id);
    tokio::fs::create_dir_all(&dir).await.map_err(io("Не удалось создать папку копий"))?;
    let file_name = backup_name(&world, automatic);
    let dest = dir.join(&file_name);
    let prefix = world.clone();
    let size_bytes = blocking(move || zip_dir(&source, &prefix, &dest)).await?;
    if automatic {
        prune_automatic(paths, id, &world).await?;
    }
    let (_, created_at, _) = parse_name(&file_name).unwrap_or_default();
    Ok(WorldBackup { file_name, world, created_at, size_bytes, automatic })
}

/// Backs up every world; used before updates. Worlds that fail are skipped
/// (and reported by count) rather than blocking the update.
pub async fn backup_all(paths: &Paths, id: &str) -> Result<usize> {
    let mut count = 0;
    let Ok(mut entries) = tokio::fs::read_dir(saves(paths, id)).await else { return Ok(0) };
    while let Ok(Some(entry)) = entries.next_entry().await {
        if !entry.path().join("level.dat").is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if backup(paths, id, &name, true).await.is_ok() {
            count += 1;
        }
    }
    Ok(count)
}

pub async fn list(paths: &Paths, id: &str) -> Result<Vec<WorldBackup>> {
    let Ok(mut entries) = tokio::fs::read_dir(backups(paths, id)).await else { return Ok(Vec::new()) };
    let mut out = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let file_name = entry.file_name().to_string_lossy().into_owned();
        let Some((world, created_at, automatic)) = parse_name(&file_name) else { continue };
        let size_bytes = entry.metadata().await.map(|m| m.len()).unwrap_or(0);
        out.push(WorldBackup { file_name, world, created_at, size_bytes, automatic });
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

async fn prune_automatic(paths: &Paths, id: &str, world: &str) -> Result<()> {
    let autos: Vec<WorldBackup> = list(paths, id)
        .await?
        .into_iter()
        .filter(|backup| backup.automatic && backup.world == world)
        .collect();
    for old in autos.iter().skip(AUTO_KEEP) {
        let _ = tokio::fs::remove_file(backups(paths, id).join(&old.file_name)).await;
    }
    Ok(())
}

pub async fn delete_backup(paths: &Paths, id: &str, file_name: &str) -> Result<()> {
    let file_name = plain(file_name)?;
    tokio::fs::remove_file(backups(paths, id).join(file_name))
        .await
        .map_err(io("Не удалось удалить копию"))
}

/// The folder in an archive that holds `level.dat`: the shallowest one.
fn world_root(archive: &mut zip::ZipArchive<std::fs::File>) -> Option<String> {
    (0..archive.len())
        .filter_map(|index| archive.by_index(index).ok().map(|entry| entry.name().replace('\\', "/")))
        .filter(|name| name == "level.dat" || name.ends_with("/level.dat"))
        .min_by_key(|name| name.matches('/').count())
        .map(|name| name.trim_end_matches("level.dat").trim_end_matches('/').to_owned())
}

/// Unpacks the world under `root` of the archive into `dest`.
fn extract_world(archive_path: &Path, dest: &Path) -> Result<()> {
    let file = std::fs::File::open(archive_path).map_err(io("Не удалось открыть архив"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(zip_error)?;
    let root = world_root(&mut archive).ok_or_else(|| world_error("В архиве нет мира — не найден level.dat"))?;
    let prefix = if root.is_empty() { String::new() } else { format!("{root}/") };
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(zip_error)?;
        let name = entry.name().replace('\\', "/");
        let Some(rest) = name.strip_prefix(&prefix) else { continue };
        // Same guard as pack imports: nothing may land outside the world.
        let Some(relative) = crate::packs::safe_relative(rest) else { continue };
        let target = dest.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&target).map_err(io("Не удалось распаковать мир"))?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(io("Не удалось распаковать мир"))?;
        }
        let mut out = std::fs::File::create(&target).map_err(io("Не удалось распаковать мир"))?;
        std::io::copy(&mut entry, &mut out).map_err(io("Не удалось распаковать мир"))?;
    }
    Ok(())
}

/// Replaces a world with a backup. The current state is backed up first, so
/// a restore can itself be undone.
pub async fn restore(paths: &Paths, id: &str, file_name: &str) -> Result<String> {
    let file_name = plain(file_name)?;
    let (world, _, _) = parse_name(file_name).ok_or_else(|| world_error("Это не копия мира"))?;
    let target = saves(paths, id).join(&world);
    if target.is_dir() {
        backup(paths, id, &world, true).await?;
        tokio::fs::remove_dir_all(&target).await.map_err(io("Не удалось заменить мир"))?;
    }
    let archive = backups(paths, id).join(file_name);
    let dest = target.clone();
    blocking(move || extract_world(&archive, &dest)).await?;
    Ok(world)
}

/// Adds a world from a zip (a download, another launcher's backup…).
pub async fn import(paths: &Paths, id: &str, archive: &Path) -> Result<String> {
    let stem = archive
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| String::from("Мир"));
    let file = std::fs::File::open(archive).map_err(io("Не удалось открыть архив"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(zip_error)?;
    let root = world_root(&mut zip).ok_or_else(|| world_error("В архиве нет мира — не найден level.dat"))?;
    let base = root.rsplit('/').next().filter(|name| !name.is_empty()).unwrap_or(&stem).to_owned();
    let base: String = base.chars().filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')).collect();

    let saves = saves(paths, id);
    tokio::fs::create_dir_all(&saves).await.map_err(io("Не удалось создать папку миров"))?;
    let mut name = base.clone();
    let mut n = 2;
    while saves.join(&name).exists() {
        name = format!("{base} ({n})");
        n += 1;
    }
    let (source, dest) = (archive.to_path_buf(), saves.join(&name));
    blocking(move || extract_world(&source, &dest)).await?;
    Ok(name)
}

pub async fn delete_world(paths: &Paths, id: &str, world: &str) -> Result<()> {
    let world = plain(world)?;
    tokio::fs::remove_dir_all(saves(paths, id).join(world))
        .await
        .map_err(io("Не удалось удалить мир"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_names_round_trip() {
        let manual = backup_name("New World", false);
        let (world, created, automatic) = parse_name(&manual).unwrap_or_default();
        assert_eq!(world, "New World");
        assert!(created.contains('T'));
        assert!(!automatic);
        let auto = backup_name("my__world", true);
        assert_eq!(parse_name(&auto).map(|p| (p.0, p.2)), Some((String::from("my__world"), true)));
        assert_eq!(parse_name("random.zip"), None);
    }

    #[test]
    fn names_from_the_ui_cannot_escape() {
        assert!(plain("New World").is_ok());
        assert!(plain("../evil").is_err());
        assert!(plain("a/b").is_err());
        assert!(plain("").is_err());
    }

    #[tokio::test]
    async fn backup_restore_and_import_round_trip() -> Result<()> {
        let root = std::env::temp_dir().join(format!("fir-worlds-{}", std::process::id()));
        let _ = tokio::fs::remove_dir_all(&root).await;
        let paths = Paths::resolve(Some(&root.to_string_lossy()))?;
        let world = saves(&paths, "i").join("New World");
        tokio::fs::create_dir_all(world.join("region")).await?;
        tokio::fs::write(world.join("level.dat"), b"level").await?;
        tokio::fs::write(world.join("region").join("r.0.0.mca"), b"chunks").await?;

        let made = backup(&paths, "i", "New World", false).await?;
        assert_eq!(list(&paths, "i").await?.len(), 1);

        // Break the world, then restore it.
        tokio::fs::write(world.join("level.dat"), b"broken").await?;
        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
        restore(&paths, "i", &made.file_name).await?;
        assert_eq!(tokio::fs::read(world.join("level.dat")).await?, b"level");
        assert_eq!(tokio::fs::read(world.join("region").join("r.0.0.mca")).await?, b"chunks");
        let all = list(&paths, "i").await?;
        assert!(all.iter().any(|b| b.automatic), "the broken state was kept as an automatic copy");

        // A backup doubles as an importable world; the name does not clash.
        let imported = import(&paths, "i", &backups(&paths, "i").join(&made.file_name)).await?;
        assert_eq!(imported, "New World (2)");
        assert!(saves(&paths, "i").join("New World (2)").join("level.dat").is_file());
        let _ = tokio::fs::remove_dir_all(&root).await;
        Ok(())
    }
}
