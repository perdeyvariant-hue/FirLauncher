//! Snapshots of an instance's setup — mods, configs, packs, loader — taken
//! before anything that changes it at scale, so a bad update can be undone.
//!
//! Worlds are not part of a snapshot: they have their own backups, and
//! rolling a mod list back must never roll a world back with it. Logs,
//! screenshots and caches are left out as well.
//!
//! Jars and zips are hard-linked rather than copied, so a snapshot of a
//! 300-mod pack costs almost nothing. That is safe because nothing edits them
//! in place: downloads land in a `.part` file and are renamed over, and
//! enabling or disabling a mod renames it. Text files (configs, options) are
//! edited in place by the game, so those are copied.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::config::{read_json_opt, write_json_atomic};
use crate::error::{ErrorKind, LauncherError, Result};
use crate::paths::Paths;

use super::{read_meta, write_meta, InstanceMeta};

/// Folders of the game directory that make up the setup.
const GAME_DIRS: [&str; 6] = ["mods", "config", "defaultconfigs", "kubejs", "resourcepacks", "shaderpacks"];
/// Loose files of the game directory that do.
const GAME_FILES: [&str; 3] = ["options.txt", "optionsof.txt", "optionsshaders.txt"];
/// Launcher files next to `.minecraft`: the instance itself, the mod and pack
/// indexes that name each file's project, and the modpack state.
const INSTANCE_FILES: [&str; 5] = ["instance.json", "mods.json", "resourcepacks.json", "shaderpacks.json", "pack.json"];

/// Automatic snapshots kept per instance; manual ones stay until deleted.
const KEEP_AUTOMATIC: usize = 10;
const INFO_FILE: &str = "snapshot.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: String,
    pub created_at: String,
    /// What was about to happen, in words for the user.
    pub reason: String,
    pub automatic: bool,
    pub mc_version: String,
    pub loader: super::ModLoader,
    pub loader_version: Option<String>,
    pub mods: usize,
    /// Bytes the files would take as copies; hard links make the real cost
    /// much smaller.
    pub bytes: u64,
}

fn root(paths: &Paths, instance_id: &str) -> PathBuf {
    paths.root().join("snapshots").join(instance_id)
}

/// A snapshot id from the caller, checked so it cannot point outside the
/// instance's snapshot folder.
fn snapshot_dir(paths: &Paths, instance_id: &str, snapshot_id: &str) -> Result<PathBuf> {
    let valid = !snapshot_id.is_empty() && snapshot_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    let dir = root(paths, instance_id).join(snapshot_id);
    if !valid || !dir.join(INFO_FILE).is_file() {
        return Err(LauncherError::new(ErrorKind::Instance, "Снимок не найден"));
    }
    Ok(dir)
}

/// Files that are never edited in place, and so can be shared by link.
fn linkable(path: &Path) -> bool {
    let name = path.file_name().map(|name| name.to_string_lossy().to_lowercase()).unwrap_or_default();
    [".jar", ".zip", ".jar.disabled", ".zip.disabled"].iter().any(|suffix| name.ends_with(suffix))
}

/// Links or copies one file; a link can fail across volumes or on file
/// systems without them, and a copy is always correct.
fn put(from: &Path, to: &Path) -> std::io::Result<()> {
    if linkable(from) && std::fs::hard_link(from, to).is_ok() {
        return Ok(());
    }
    std::fs::copy(from, to).map(|_| ())
}

/// Mirrors a folder, returning the bytes it holds.
fn mirror(from: &Path, to: &Path) -> std::io::Result<u64> {
    let mut bytes = 0;
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        let kind = entry.file_type()?;
        if kind.is_dir() {
            bytes += mirror(&entry.path(), &target)?;
        } else if kind.is_file() {
            put(&entry.path(), &target)?;
            bytes += entry.metadata()?.len();
        }
    }
    Ok(bytes)
}

/// Copies the setup of `instance` into `game`/`top`-shaped folders under
/// `to`: the mirror image of `restore_files`.
fn capture(instance: &Path, to: &Path) -> std::io::Result<u64> {
    let game = instance.join(".minecraft");
    let mut bytes = 0;
    for dir in GAME_DIRS {
        let from = game.join(dir);
        if from.is_dir() {
            bytes += mirror(&from, &to.join("game").join(dir))?;
        }
    }
    for (base, names, into) in [(&game, &GAME_FILES[..], "game"), (&instance.to_path_buf(), &INSTANCE_FILES[..], "top")] {
        for name in names {
            let from = base.join(name);
            if from.is_file() {
                let dest = to.join(into);
                std::fs::create_dir_all(&dest)?;
                std::fs::copy(&from, dest.join(name))?;
                bytes += std::fs::metadata(&from)?.len();
            }
        }
    }
    Ok(bytes)
}

fn mod_count(instance: &Path) -> usize {
    std::fs::read_dir(instance.join(".minecraft").join("mods"))
        .map(|entries| entries.flatten().filter(|entry| linkable(&entry.path())).count())
        .unwrap_or(0)
}

pub async fn list(paths: &Paths, instance_id: &str) -> Result<Vec<Snapshot>> {
    let dir = root(paths, instance_id);
    let Ok(mut entries) = tokio::fs::read_dir(&dir).await else {
        return Ok(Vec::new());
    };
    let mut found = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        if let Some(snapshot) = read_json_opt::<Snapshot>(&entry.path().join(INFO_FILE)).await? {
            found.push(snapshot);
        }
    }
    // Ids are timestamps, so they sort by age.
    found.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(found)
}

/// Takes a snapshot of the instance as it is now.
pub async fn take(paths: &Paths, instance_id: &str, reason: &str, automatic: bool) -> Result<Snapshot> {
    let meta = read_meta(paths, instance_id).await?;
    let now = chrono::Utc::now();
    let mut id = now.format("%Y%m%d-%H%M%S-%3f").to_string();
    while root(paths, instance_id).join(&id).exists() {
        id.push('0');
    }
    let dir = root(paths, instance_id).join(&id);
    let instance = paths.instance(instance_id);

    let staging = dir.clone();
    let outcome = tokio::task::spawn_blocking(move || {
        let bytes = capture(&instance, &staging);
        (bytes, mod_count(&instance))
    })
    .await
    .map_err(|error| LauncherError::internal("Сбой снимка сборки").with_detail(error.to_string()))?;
    let (bytes, mods) = outcome;
    let bytes = match bytes {
        Ok(bytes) => bytes,
        Err(error) => {
            // A half-made snapshot would restore half a setup.
            let _ = tokio::fs::remove_dir_all(&dir).await;
            return Err(LauncherError::io("Не удалось сделать снимок сборки").with_detail(error.to_string()));
        }
    };

    let snapshot = Snapshot {
        id,
        created_at: now.to_rfc3339(),
        reason: reason.to_owned(),
        automatic,
        mc_version: meta.mc_version,
        loader: meta.loader,
        loader_version: meta.loader_version,
        mods,
        bytes,
    };
    write_json_atomic(&dir.join(INFO_FILE), &snapshot).await?;
    prune(paths, instance_id).await;
    Ok(snapshot)
}

/// Like `take`, for the step before a change: a failed snapshot is logged
/// but does not stop the update the user asked for.
pub async fn take_before(paths: &Paths, instance_id: &str, reason: &str) -> Option<Snapshot> {
    match take(paths, instance_id, reason, true).await {
        Ok(snapshot) => Some(snapshot),
        Err(error) => {
            eprintln!("snapshot of {instance_id} failed: {}", error.message);
            None
        }
    }
}

async fn prune(paths: &Paths, instance_id: &str) {
    let Ok(all) = list(paths, instance_id).await else { return };
    for old in all.iter().filter(|snapshot| snapshot.automatic).skip(KEEP_AUTOMATIC) {
        let _ = tokio::fs::remove_dir_all(root(paths, instance_id).join(&old.id)).await;
    }
}

pub async fn delete(paths: &Paths, instance_id: &str, snapshot_id: &str) -> Result<()> {
    let dir = snapshot_dir(paths, instance_id, snapshot_id)?;
    tokio::fs::remove_dir_all(&dir)
        .await
        .map_err(|error| LauncherError::io("Не удалось удалить снимок").with_detail(error.to_string()))
}

/// Every snapshot of an instance, when the instance itself goes.
pub async fn delete_all(paths: &Paths, instance_id: &str) {
    let _ = tokio::fs::remove_dir_all(root(paths, instance_id)).await;
}

/// Puts the snapshot's files back, replacing the current setup. Folders the
/// snapshot did not have (say, shaderpacks added since) are emptied, so the
/// result is the setup exactly as it was.
fn restore_files(snapshot: &Path, instance: &Path) -> std::io::Result<()> {
    let game = instance.join(".minecraft");
    for dir in GAME_DIRS {
        let current = game.join(dir);
        if current.is_dir() {
            std::fs::remove_dir_all(&current)?;
        }
        let saved = snapshot.join("game").join(dir);
        if saved.is_dir() {
            mirror(&saved, &current)?;
        }
    }
    for name in GAME_FILES {
        let saved = snapshot.join("game").join(name);
        if saved.is_file() {
            std::fs::copy(&saved, game.join(name))?;
        }
    }
    // instance.json is merged by the caller; the indexes follow the files.
    for name in INSTANCE_FILES.iter().filter(|name| **name != "instance.json") {
        let saved = snapshot.join("top").join(name);
        let current = instance.join(name);
        if saved.is_file() {
            std::fs::copy(&saved, &current)?;
        } else if current.is_file() {
            std::fs::remove_file(&current)?;
        }
    }
    Ok(())
}

/// What a restore keeps from the instance as it is now: identity, looks and
/// history belong to the instance, not to its setup.
fn merge_meta(current: &InstanceMeta, saved: InstanceMeta) -> InstanceMeta {
    let same_loader = saved.loader == current.loader
        && saved.loader_version == current.loader_version
        && saved.mc_version == current.mc_version;
    InstanceMeta {
        id: current.id.clone(),
        name: current.name.clone(),
        icon_file: current.icon_file.clone(),
        created_at: current.created_at.clone(),
        last_played_at: current.last_played_at.clone(),
        total_play_seconds: current.total_play_seconds,
        group: current.group.clone(),
        favorite: current.favorite,
        color: current.color,
        glyph: current.glyph.clone(),
        // A profile id from the snapshot may name a profile cleaned up since;
        // with none, the next launch installs the loader again.
        profile_id: if same_loader { current.profile_id.clone() } else { None },
        ..saved
    }
}

/// Rolls the instance back to a snapshot, first taking one of the current
/// state so the rollback itself can be undone.
pub async fn restore(paths: &Paths, instance_id: &str, snapshot_id: &str) -> Result<()> {
    let dir = snapshot_dir(paths, instance_id, snapshot_id)?;
    take(paths, instance_id, "Перед откатом", true).await?;

    let current = read_meta(paths, instance_id).await?;
    let saved: Option<InstanceMeta> = read_json_opt(&dir.join("top").join("instance.json")).await?;

    let instance = paths.instance(instance_id);
    tokio::task::spawn_blocking(move || restore_files(&dir, &instance))
        .await
        .map_err(|error| LauncherError::internal("Сбой отката сборки").with_detail(error.to_string()))?
        .map_err(|error| LauncherError::io("Не удалось вернуть файлы из снимка").with_detail(error.to_string()))?;

    if let Some(saved) = saved {
        write_meta(paths, &merge_meta(&current, saved)).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fir-snap-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap_or(Path::new("."))).ok();
        std::fs::write(path, text).ok();
    }

    #[test]
    fn restore_brings_back_exactly_the_saved_setup() {
        let base = scratch("roundtrip");
        let instance = base.join("inst");
        let snap = base.join("snap");
        write(&instance.join(".minecraft/mods/sodium.jar"), "v1");
        write(&instance.join(".minecraft/config/sodium.json"), "{\"a\":1}");
        write(&instance.join(".minecraft/saves/world/level.dat"), "world");
        write(&instance.join("mods.json"), "{}");

        assert!(capture(&instance, &snap).is_ok());

        // An update replaces the jar, edits a config, adds a mod and a pack
        // index, and the player keeps playing the world.
        std::fs::remove_file(instance.join(".minecraft/mods/sodium.jar")).ok();
        write(&instance.join(".minecraft/mods/sodium-2.jar"), "v2");
        write(&instance.join(".minecraft/mods/iris.jar"), "iris");
        write(&instance.join(".minecraft/config/sodium.json"), "{\"a\":2}");
        write(&instance.join(".minecraft/saves/world/level.dat"), "world, later");
        write(&instance.join("shaderpacks.json"), "{}");

        assert!(restore_files(&snap, &instance).is_ok());

        let mut mods: Vec<String> = std::fs::read_dir(instance.join(".minecraft/mods"))
            .map(|entries| entries.flatten().map(|entry| entry.file_name().to_string_lossy().into_owned()).collect())
            .unwrap_or_default();
        mods.sort();
        assert_eq!(mods, ["sodium.jar"]);
        assert_eq!(std::fs::read_to_string(instance.join(".minecraft/mods/sodium.jar")).ok().as_deref(), Some("v1"));
        assert_eq!(std::fs::read_to_string(instance.join(".minecraft/config/sodium.json")).ok().as_deref(), Some("{\"a\":1}"));
        // Worlds are never rolled back.
        assert_eq!(std::fs::read_to_string(instance.join(".minecraft/saves/world/level.dat")).ok().as_deref(), Some("world, later"));
        assert!(!instance.join("shaderpacks.json").exists());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn configs_are_copied_so_later_edits_do_not_reach_the_snapshot() {
        let base = scratch("copies");
        let instance = base.join("inst");
        let snap = base.join("snap");
        write(&instance.join(".minecraft/config/a.toml"), "before");
        assert!(capture(&instance, &snap).is_ok());
        write(&instance.join(".minecraft/config/a.toml"), "after");
        assert_eq!(std::fs::read_to_string(snap.join("game/config/a.toml")).ok().as_deref(), Some("before"));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn only_archives_are_linked() {
        assert!(linkable(Path::new("mods/Sodium.JAR")));
        assert!(linkable(Path::new("mods/iris.jar.disabled")));
        assert!(linkable(Path::new("resourcepacks/faithful.zip")));
        assert!(!linkable(Path::new("config/sodium.json")));
        assert!(!linkable(Path::new("options.txt")));
    }

    #[test]
    fn restore_keeps_the_instance_identity_and_drops_a_stale_profile() {
        let current: InstanceMeta = serde_json::from_value(serde_json::json!({
            "id": "pack", "name": "Renamed", "mcVersion": "1.21.1", "loader": "neoforge",
            "loaderVersion": "21.1.90", "profileId": "neoforge-21.1.90", "createdAt": "2026-01-01",
            "lastPlayedAt": null, "totalPlaySeconds": 7200, "group": null
        }))
        .unwrap_or_else(|error| panic!("{error}"));
        let saved: InstanceMeta = serde_json::from_value(serde_json::json!({
            "id": "pack", "name": "Old name", "mcVersion": "1.21.1", "loader": "fabric",
            "loaderVersion": "0.16.9", "profileId": "fabric-loader-0.16.9-1.21.1", "createdAt": "2026-01-01",
            "lastPlayedAt": null, "totalPlaySeconds": 60, "group": null
        }))
        .unwrap_or_else(|error| panic!("{error}"));
        let merged = merge_meta(&current, saved);
        assert_eq!(merged.name, "Renamed");
        assert_eq!(merged.total_play_seconds, 7200);
        assert_eq!(merged.loader, super::super::ModLoader::Fabric);
        assert_eq!(merged.profile_id, None);
    }
}
