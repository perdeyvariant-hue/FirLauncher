//! Instance metadata and the operations behind the instance grid.

pub mod contents;
pub mod worlds;

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::config::{read_json_opt, write_json_atomic};
use crate::error::{ErrorKind, LauncherError, Result};
use crate::paths::Paths;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModLoader {
    Vanilla,
    Fabric,
    Quilt,
    Forge,
    NeoForge,
}

impl ModLoader {
    pub fn label(self) -> &'static str {
        match self {
            ModLoader::Vanilla => "Vanilla",
            ModLoader::Fabric => "Fabric",
            ModLoader::Quilt => "Quilt",
            ModLoader::Forge => "Forge",
            ModLoader::NeoForge => "NeoForge",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowSize {
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub fullscreen: bool,
}

/// Per-instance overrides; `None` means "use the global setting".
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct InstanceJava {
    pub java_path: Option<String>,
    /// Run on this Java major instead of the one the version asks for (a
    /// mod may need a newer Java than Minecraft itself). Downloaded if absent.
    pub java_major: Option<u32>,
    pub memory_mb: Option<u32>,
    pub extra_jvm_args: Option<String>,
    pub window: Option<WindowSize>,
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceMeta {
    pub id: String,
    pub name: String,
    /// File name of the icon inside the instance directory, not a full path:
    /// the webview cannot load an arbitrary disk path, so the UI receives the
    /// picture itself as a data URL in `InstanceDto::icon_path`.
    /// Deliberately *not* aliased to `iconPath`: the UI sends that field back
    /// as a data URL, and accepting it here would write the whole picture into
    /// instance.json.
    #[serde(default)]
    pub icon_file: Option<String>,
    pub mc_version: String,
    pub loader: ModLoader,
    pub loader_version: Option<String>,
    /// Version profile to launch. Set by the loader installer; vanilla
    /// instances just use `mc_version`.
    #[serde(default)]
    pub profile_id: Option<String>,
    pub created_at: String,
    pub last_played_at: Option<String>,
    #[serde(default)]
    pub total_play_seconds: u64,
    pub group: Option<String>,
    /// Pinned to the top of the instance list.
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub java: InstanceJava,
}

impl InstanceMeta {
    /// The version profile id that the launcher resolves and runs.
    pub fn version_id(&self) -> String {
        self.profile_id
            .clone()
            .unwrap_or_else(|| self.mc_version.clone())
    }
}

/// Runtime state, computed rather than stored.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum InstanceStatus {
    Idle,
    #[serde(rename_all = "camelCase")]
    Installing { task_id: String },
    Running { pid: u32 },
    #[serde(rename_all = "camelCase")]
    Crashed { exit_code: i32 },
}

/// What the UI receives: the stored metadata plus live status.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceDto {
    #[serde(flatten)]
    pub meta: InstanceMeta,
    pub status: InstanceStatus,
    /// `data:` URL of the instance icon, or `None` for the generated initials.
    pub icon_path: Option<String>,
}

/// Instance ids double as directory names, so they must stay tame.
fn slugify(name: &str) -> String {
    let base: String = name
        .trim()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else if c.is_alphanumeric() {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = base.trim_matches('-').to_owned();
    if trimmed.is_empty() {
        String::from("instance")
    } else {
        trimmed.chars().take(48).collect()
    }
}

/// Appends `-2`, `-3`, ... until the directory name is free.
async fn unique_id(paths: &Paths, base: &str) -> String {
    let mut candidate = base.to_owned();
    let mut counter = 1;
    while tokio::fs::metadata(paths.instance(&candidate)).await.is_ok() {
        counter += 1;
        candidate = format!("{base}-{counter}");
    }
    candidate
}

pub async fn read_meta(paths: &Paths, id: &str) -> Result<InstanceMeta> {
    read_json_opt::<InstanceMeta>(&paths.instance_meta_file(id))
        .await?
        .ok_or_else(|| {
            LauncherError::new(ErrorKind::Instance, format!("Сборка {id} не найдена"))
        })
}

pub async fn write_meta(paths: &Paths, meta: &InstanceMeta) -> Result<()> {
    write_json_atomic(&paths.instance_meta_file(&meta.id), meta).await
}

pub async fn list_metas(paths: &Paths) -> Result<Vec<InstanceMeta>> {
    let mut metas = Vec::new();
    let mut entries = match tokio::fs::read_dir(paths.instances()).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(metas),
        Err(error) => {
            return Err(LauncherError::io("Не удалось прочитать папку сборок")
                .with_detail(error.to_string()))
        }
    };

    while let Some(entry) = entries.next_entry().await.map_err(|error| {
        LauncherError::io("Не удалось перечислить сборки").with_detail(error.to_string())
    })? {
        if !entry.path().is_dir() {
            continue;
        }
        let Some(id) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        // A directory without readable metadata is not an instance; skipping
        // it beats failing the whole listing.
        if let Ok(meta) = read_meta(paths, &id).await {
            metas.push(meta);
        }
    }

    metas.sort_by_key(|item| item.name.to_lowercase());
    Ok(metas)
}

/// The per-instance directory skeleton. Created up front so the folder is
/// useful the moment it exists.
pub async fn ensure_layout(paths: &Paths, id: &str) -> Result<()> {
    let game = paths.instance_game_dir(id);
    for sub in [
        "mods",
        "config",
        "saves",
        "resourcepacks",
        "shaderpacks",
        "logs",
        "screenshots",
    ] {
        tokio::fs::create_dir_all(game.join(sub))
            .await
            .map_err(|error| {
                LauncherError::io(format!("Не удалось создать папку {sub}"))
                    .with_detail(error.to_string())
            })?;
    }
    Ok(())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInstanceInput {
    pub name: String,
    pub mc_version: String,
    pub loader: ModLoader,
    pub loader_version: Option<String>,
    pub icon_path: Option<String>,
}

pub async fn create(paths: &Paths, input: CreateInstanceInput) -> Result<InstanceMeta> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(LauncherError::new(
            ErrorKind::Instance,
            "Имя сборки не может быть пустым",
        ));
    }

    let id = unique_id(paths, &slugify(name)).await;
    ensure_layout(paths, &id).await?;
    let icon_file = match input.icon_path.as_deref() {
        Some(source) if !source.trim().is_empty() => import_icon(paths, &id, source).await?,
        _ => None,
    };

    let meta = InstanceMeta {
        id: id.clone(),
        name: name.to_owned(),
        icon_file: icon_file.clone(),
        mc_version: input.mc_version,
        loader: input.loader,
        loader_version: input.loader_version,
        profile_id: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        last_played_at: None,
        total_play_seconds: 0,
        group: None,
        favorite: false,
        java: InstanceJava::default(),
    };

    write_meta(paths, &meta).await?;
    Ok(meta)
}

pub async fn delete(paths: &Paths, id: &str) -> Result<()> {
    let dir = paths.instance(id);
    // Refuse to touch anything that is not actually an instance directory.
    if !dir.join("instance.json").is_file() {
        return Err(LauncherError::new(
            ErrorKind::Instance,
            format!("Сборка {id} не найдена"),
        ));
    }
    tokio::fs::remove_dir_all(&dir).await.map_err(|error| {
        LauncherError::io(format!("Не удалось удалить {}", dir.display()))
            .with_detail(error.to_string())
    })
}

/// Recursively copies the instance directory, blocking, for `spawn_blocking`.
fn copy_dir(from: &std::path::Path, to: &std::path::Path) -> Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

pub async fn duplicate(paths: &Paths, id: &str, new_name: &str) -> Result<InstanceMeta> {
    let source = read_meta(paths, id).await?;
    let new_id = unique_id(paths, &slugify(new_name)).await;

    let from = paths.instance(id);
    let to = paths.instance(&new_id);
    tokio::task::spawn_blocking(move || copy_dir(&from, &to))
        .await
        .map_err(|error| {
            LauncherError::internal("Сбой копирования сборки").with_detail(error.to_string())
        })??;

    let meta = InstanceMeta {
        id: new_id,
        name: new_name.trim().to_owned(),
        created_at: chrono::Utc::now().to_rfc3339(),
        last_played_at: None,
        total_play_seconds: 0,
        ..source
    };
    write_meta(paths, &meta).await?;
    Ok(meta)
}

/// Icons are embedded in the listing as data URLs, so a huge source file would
/// bloat every response; 2 MiB is far above any sane instance icon.
const MAX_ICON_BYTES: u64 = 2 * 1024 * 1024;

fn icon_mime(extension: &str) -> Option<&'static str> {
    match extension {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        _ => None,
    }
}

/// Copies a user-picked image into the instance directory.
///
/// The webview cannot load an arbitrary disk path, and keeping the icon inside
/// the instance folder also means duplicating or exporting a pack carries it
/// along.
pub async fn import_icon(paths: &Paths, id: &str, source: &str) -> Result<Option<String>> {
    let source_path = std::path::Path::new(source);
    let extension = source_path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();

    if icon_mime(&extension).is_none() {
        return Err(LauncherError::new(
            ErrorKind::Instance,
            "Иконка должна быть PNG, JPEG, WebP или GIF",
        ));
    }

    let size = tokio::fs::metadata(source_path)
        .await
        .map_err(|error| {
            LauncherError::io("Не удалось прочитать файл иконки").with_detail(error.to_string())
        })?
        .len();
    if size > MAX_ICON_BYTES {
        return Err(LauncherError::new(
            ErrorKind::Instance,
            "Иконка больше 2 МБ — возьмите файл поменьше",
        ));
    }

    let file_name = format!("icon.{extension}");
    tokio::fs::copy(source_path, paths.instance(id).join(&file_name))
        .await
        .map_err(|error| {
            LauncherError::io("Не удалось скопировать иконку").with_detail(error.to_string())
        })?;
    Ok(Some(file_name))
}

/// Reads the stored icon as a `data:` URL the webview can render directly.
pub async fn icon_data_url(paths: &Paths, meta: &InstanceMeta) -> Option<String> {
    use base64::Engine;

    let file_name = meta.icon_file.as_ref()?;
    let extension = std::path::Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let mime = icon_mime(&extension)?;

    let bytes = tokio::fs::read(paths.instance(&meta.id).join(file_name))
        .await
        .ok()?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{mime};base64,{encoded}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> Paths {
        let dir = std::env::temp_dir().join(format!("firlauncher-test-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        match Paths::resolve(Some(&dir.to_string_lossy())) {
            Ok(paths) => paths,
            Err(error) => panic!("paths: {error}"),
        }
    }

    #[tokio::test]
    async fn listing_an_empty_data_dir_is_not_an_error() {
        // This runs on every cold start, before any instance exists.
        let paths = scratch("empty");
        let metas = list_metas(&paths).await;
        assert!(matches!(metas, Ok(list) if list.is_empty()));
    }

    #[tokio::test]
    async fn create_then_read_roundtrips() {
        let paths = scratch("create");
        if let Err(error) = paths.ensure() {
            panic!("ensure: {error}");
        }

        let meta = create(
            &paths,
            CreateInstanceInput {
                name: String::from("My Pack!"),
                mc_version: String::from("1.20.4"),
                loader: ModLoader::Vanilla,
                loader_version: None,
                icon_path: None,
            },
        )
        .await
        .unwrap_or_else(|error| panic!("create: {error}"));

        // Punctuation must not leak into the directory name.
        assert_eq!(meta.id, "my-pack");
        assert_eq!(meta.version_id(), "1.20.4");
        assert!(paths.instance_game_dir(&meta.id).join("mods").is_dir());

        let read = read_meta(&paths, &meta.id)
            .await
            .unwrap_or_else(|error| panic!("read: {error}"));
        assert_eq!(read.name, "My Pack!");

        let listed = list_metas(&paths)
            .await
            .unwrap_or_else(|error| panic!("list: {error}"));
        assert_eq!(listed.len(), 1);

        // A second instance with the same name gets its own directory.
        let second = create(
            &paths,
            CreateInstanceInput {
                name: String::from("My Pack!"),
                mc_version: String::from("1.20.4"),
                loader: ModLoader::Vanilla,
                loader_version: None,
                icon_path: None,
            },
        )
        .await
        .unwrap_or_else(|error| panic!("create second: {error}"));
        assert_eq!(second.id, "my-pack-2");

        let _ = std::fs::remove_dir_all(paths.root());
    }
}
