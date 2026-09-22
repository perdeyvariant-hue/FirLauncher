//! Whole-instance import and export: Modrinth `.mrpack`, CurseForge modpack
//! zips, MultiMC/Prism instances and the launcher's own zip.

pub mod curseforge;
pub mod export;
pub mod mmc;
pub mod mrpack;
pub mod native;
pub mod update;

use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;

use crate::config::settings::Settings;
use crate::error::{ErrorKind, LauncherError, Result};
use crate::instances::{self, CreateInstanceInput, InstanceMeta, ModLoader};
use crate::paths::Paths;
use crate::tasks::Progress;

/// A file a pack wanted that could not be installed automatically.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedFile {
    pub name: String,
    /// Where to get it by hand, when known.
    pub url: Option<String>,
    pub reason: String,
}

pub struct PackContext<'a> {
    pub client: &'a reqwest::Client,
    pub paths: &'a Paths,
    pub settings: &'a Settings,
    pub progress: Arc<dyn Progress>,
}

pub fn pack_error(message: impl Into<String>) -> LauncherError {
    LauncherError::new(ErrorKind::Instance, message)
}

/// A path from a pack manifest, made safe to join under the game directory:
/// relative, no `..`, no drive letters. Anything else is rejected, as the
/// Modrinth format requires of launchers.
pub fn safe_relative(raw: &str) -> Option<PathBuf> {
    let normalised = raw.replace('\\', "/");
    let path = Path::new(&normalised);
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            // A drive letter or stream name ("C:", "a.txt:ads") is only
            // special on Windows; refuse it everywhere so a pack behaves the
            // same on every system.
            Component::Normal(part) if part.to_string_lossy().contains(':') => return None,
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    (!out.as_os_str().is_empty()).then_some(out)
}

pub fn open_zip(path: &Path) -> Result<zip::ZipArchive<std::fs::File>> {
    let file = std::fs::File::open(path).map_err(|error| {
        pack_error(format!("Не удалось открыть {}", path.display())).with_detail(error.to_string())
    })?;
    zip::ZipArchive::new(file).map_err(|error| {
        pack_error("Это не zip-архив или он повреждён").with_detail(error.to_string())
    })
}

pub fn read_zip_entry(path: &Path, name: &str) -> Result<Option<Vec<u8>>> {
    let mut archive = open_zip(path)?;
    let Ok(mut entry) = archive.by_name(name) else {
        return Ok(None);
    };
    let mut bytes = Vec::new();
    entry.read_to_end(&mut bytes)?;
    Ok(Some(bytes))
}

/// Unpacks every entry under `prefix/` into `dest`, keeping relative paths.
/// Blocking — callers run it under `spawn_blocking`.
pub fn extract_prefix(archive_path: &Path, prefix: &str, dest: &Path) -> Result<usize> {
    let mut archive = open_zip(archive_path)?;
    let prefix = format!("{}/", prefix.trim_end_matches('/'));
    let mut count = 0;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| pack_error("Не удалось прочитать архив").with_detail(error.to_string()))?;
        let name = entry.name().replace('\\', "/");
        let Some(rest) = name.strip_prefix(&prefix) else { continue };
        let Some(relative) = safe_relative(rest) else { continue };
        let target = dest.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&target)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut out = std::fs::File::create(&target)?;
        std::io::copy(&mut entry, &mut out)?;
        count += 1;
    }
    Ok(count)
}

pub async fn blocking<T, F>(work: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T> + Send + 'static,
{
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| LauncherError::internal("Сбой фоновой операции").with_detail(error.to_string()))?
}

/// Creates the instance a pack describes; loaders install on first launch.
pub async fn create_instance(
    paths: &Paths,
    name: &str,
    mc_version: &str,
    loader: ModLoader,
    loader_version: Option<String>,
) -> Result<InstanceMeta> {
    let name = if name.trim().is_empty() { "Импортированная сборка" } else { name };
    instances::create(
        paths,
        CreateInstanceInput {
            name: name.to_owned(),
            mc_version: mc_version.to_owned(),
            loader,
            loader_version,
            icon_path: None,
        },
    )
    .await
}

/// Detects the format and imports. Folders are MultiMC/Prism instances;
/// archives are told apart by the manifest they carry.
pub async fn import(ctx: &PackContext<'_>, source: &Path) -> Result<(InstanceMeta, Vec<SkippedFile>)> {
    if source.is_dir() {
        if mmc::is_instance_dir(source) {
            return mmc::import(ctx, source).await;
        }
        return Err(pack_error(
            "Эта папка не похожа на инстанс MultiMC/Prism — в ней нет mmc-pack.json",
        ));
    }

    let path = source.to_path_buf();
    let format = blocking(move || -> Result<&'static str> {
        if read_zip_entry(&path, mrpack::INDEX_FILE)?.is_some() {
            Ok("mrpack")
        } else if read_zip_entry(&path, curseforge::MANIFEST_FILE)?.is_some() {
            Ok("curseforge")
        } else if native::is_native_zip(&path) {
            Ok("native")
        } else if mmc::is_instance_zip(&path) {
            Ok("mmc")
        } else {
            Err(pack_error(
                "Не удалось распознать сборку: ожидался .mrpack, модпак CurseForge, \
                 инстанс MultiMC/Prism или архив FirLauncher",
            ))
        }
    })
    .await?;

    match format {
        "mrpack" => mrpack::import(ctx, source).await,
        "curseforge" => curseforge::import(ctx, source).await,
        "native" => native::import(ctx, source).await,
        _ => mmc::import(ctx, source).await,
    }
}

/// Downloads a modpack's newest release from a provider and imports it.
pub async fn install_from_provider(
    ctx: &PackContext<'_>,
    provider: &dyn crate::mods::ModProvider,
    project_id: &str,
) -> Result<(InstanceMeta, Vec<SkippedFile>)> {
    use crate::mods::{resolve, Target};
    use crate::net::download::{download_all, DownloadItem, ProgressSink};

    let versions = provider.versions(project_id, &Target::any()).await?;
    let version = resolve::pick_best(&versions, &Target::any())
        .ok_or_else(|| pack_error("У модпака нет опубликованных версий"))?;
    if version.download_url.is_empty() {
        return Err(pack_error(
            "Автор запретил скачивание этого модпака через сторонние лаунчеры",
        ));
    }
    let file_name = safe_relative(&version.file_name)
        .filter(|path| path.components().count() == 1)
        .ok_or_else(|| pack_error("Недопустимое имя файла модпака"))?;
    let archive = ctx.paths.meta().join("packs").join(file_name);

    ctx.progress.begin_phase(
        format!("Загрузка {}", version.file_name),
        Some(version.size_bytes),
    );
    download_all(
        ctx.client,
        vec![DownloadItem::new(version.download_url.clone(), archive.clone())
            .with_sha1(version.sha1.clone())
            .with_size(Some(version.size_bytes))],
        1,
        ctx.progress.token(),
        Arc::clone(&ctx.progress) as Arc<dyn ProgressSink>,
    )
    .await?;

    let imported = import(ctx, &archive).await?;
    // The version is known exactly here; `.mrpack` imports record it for
    // updates (CurseForge packs are not updatable yet).
    if read_zip_entry(&archive, mrpack::INDEX_FILE)?.is_some() {
        update::record(
            ctx.paths,
            &imported.0.id,
            &archive,
            Some((version.project_id.clone(), version.version_id.clone())),
        )
        .await?;
    }
    Ok(imported)
}
