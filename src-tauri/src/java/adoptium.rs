//! Downloading a JRE from the Adoptium API when the machine lacks one.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Deserialize;

use crate::error::{ErrorKind, LauncherError, Result};
use crate::net::download::{download_all, DownloadItem};
use crate::net::retry::{network_error, with_retry, RetryPolicy};
use crate::paths::Paths;
use crate::tasks::Progress;

use super::detect;
use super::{JavaRuntime, JavaSource};

const API_BASE: &str = "https://api.adoptium.net/v3/assets/latest";

#[derive(Debug, Deserialize)]
struct PackageInfo {
    name: String,
    link: String,
    size: Option<u64>,
    checksum: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BinaryInfo {
    package: PackageInfo,
}

#[derive(Debug, Deserialize)]
struct VersionInfo {
    semver: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AssetEntry {
    binary: BinaryInfo,
    version: Option<VersionInfo>,
}

fn adoptium_os() -> &'static str {
    match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "mac",
        _ => "linux",
    }
}

fn adoptium_arch() -> &'static str {
    match std::env::consts::ARCH {
        "x86" => "x86",
        "aarch64" => "aarch64",
        _ => "x64",
    }
}

async fn query_asset(client: &reqwest::Client, major: u32) -> Result<AssetEntry> {
    let url = format!(
        "{API_BASE}/{major}/hotspot?os={}&architecture={}&image_type=jre&vendor=eclipse",
        adoptium_os(),
        adoptium_arch()
    );

    let assets = with_retry(RetryPolicy::default(), |_| {
        let url = url.clone();
        async move {
            let response = client
                .get(&url)
                .send()
                .await
                .map_err(|error| network_error("Adoptium недоступен", &error))?
                .error_for_status()
                .map_err(|error| network_error("Adoptium вернул ошибку", &error))?;
            response
                .json::<Vec<AssetEntry>>()
                .await
                .map_err(|error| network_error("Ответ Adoptium не разобрался", &error))
        }
    })
    .await?;

    assets.into_iter().next().ok_or_else(|| {
        LauncherError::new(
            ErrorKind::Java,
            format!("Adoptium не предлагает Java {major} для этой платформы"),
        )
    })
}

/// Strips the archive's single top-level directory so the JDK home is
/// predictable regardless of how the vendor packages it.
fn strip_root(path: &Path) -> Option<PathBuf> {
    let mut parts = path.components();
    parts.next()?;
    let rest: PathBuf = parts.collect();
    if rest.as_os_str().is_empty() {
        None
    } else {
        Some(rest)
    }
}

fn unpack_zip(archive: &Path, target: &Path) -> Result<()> {
    let file = std::fs::File::open(archive)?;
    let mut zip = zip::ZipArchive::new(file).map_err(|error| {
        LauncherError::new(ErrorKind::Parse, "Повреждён архив Java")
            .with_detail(error.to_string())
    })?;

    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|error| {
            LauncherError::new(ErrorKind::Parse, "Не удалось прочитать архив Java")
                .with_detail(error.to_string())
        })?;
        let Some(name) = entry.enclosed_name() else {
            continue;
        };
        let Some(relative) = strip_root(&name) else {
            continue;
        };
        let dest = target.join(relative);

        if entry.is_dir() {
            std::fs::create_dir_all(&dest)?;
            continue;
        }
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut out = std::fs::File::create(&dest)?;
        std::io::copy(&mut entry, &mut out)?;
    }
    Ok(())
}

fn unpack_tar_gz(archive: &Path, target: &Path) -> Result<()> {
    let file = std::fs::File::open(archive)?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut tar = tar::Archive::new(decoder);

    for entry in tar.entries()? {
        let mut entry = entry?;
        let path = entry.path()?.into_owned();
        let Some(relative) = strip_root(&path) else {
            continue;
        };
        let dest = target.join(relative);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        entry.unpack(&dest)?;
    }
    Ok(())
}

fn unpack(archive: &Path, target: &Path) -> Result<()> {
    let name = archive.to_string_lossy().to_ascii_lowercase();
    std::fs::create_dir_all(target)?;
    if name.ends_with(".zip") {
        unpack_zip(archive, target)
    } else if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        unpack_tar_gz(archive, target)
    } else {
        Err(LauncherError::unsupported(format!(
            "Неизвестный формат архива Java: {}",
            archive.display()
        )))
    }
}

/// Ensures the JRE binaries are executable on Unix; the tar crate preserves
/// modes, but zip archives from Adoptium do not carry them on every platform.
#[cfg(unix)]
fn fix_permissions(home: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let bin = home.join("bin");
    let Ok(entries) = std::fs::read_dir(&bin) else {
        return Ok(());
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            let mut perms = std::fs::metadata(&path)?.permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&path, perms)?;
        }
    }
    Ok(())
}

#[cfg(not(unix))]
fn fix_permissions(_home: &Path) -> Result<()> {
    Ok(())
}

/// Downloads and unpacks a JRE, reporting through the given task.
pub async fn install(
    client: &reqwest::Client,
    paths: &Paths,
    major: u32,
    task: Arc<dyn Progress>,
) -> Result<JavaRuntime> {
    task.set_stage(format!("Поиск Java {major}"));
    let asset = query_asset(client, major).await?;

    let version = asset
        .version
        .as_ref()
        .and_then(|version| version.semver.clone())
        .unwrap_or_else(|| major.to_string());

    let home = paths.java().join(format!("temurin-{major}-{version}"));
    if let Some(runtime) = detect::inspect_manual(&home.join("bin").join("java")) {
        // Already installed by a previous run.
        return Ok(runtime);
    }

    let archive = paths
        .java()
        .join("_downloads")
        .join(&asset.binary.package.name);

    task.begin_phase(
        format!("Загрузка Java {major}"),
        asset.binary.package.size,
    );

    // Adoptium publishes SHA-256, not SHA1.
    let item = DownloadItem::new(asset.binary.package.link.clone(), archive.clone())
        .with_sha256(asset.binary.package.checksum.clone())
        .with_size(asset.binary.package.size);

    download_all(
        client,
        vec![item],
        1,
        task.token(),
        Arc::clone(&task) as Arc<dyn crate::net::download::ProgressSink>,
    )
    .await?;

    task.set_stage(format!("Распаковка Java {major}"));
    let unpack_home = home.clone();
    let unpack_archive = archive.clone();
    tokio::task::spawn_blocking(move || -> Result<()> {
        unpack(&unpack_archive, &unpack_home)?;
        fix_permissions(&unpack_home)
    })
    .await
    .map_err(|error| {
        LauncherError::internal("Сбой распаковки Java").with_detail(error.to_string())
    })??;

    // The archive is a few hundred megabytes and is never needed again.
    let _ = tokio::fs::remove_file(&archive).await;

    let binary_name = if cfg!(windows) { "javaw.exe" } else { "java" };
    detect::inspect_manual(&home.join("bin").join(binary_name))
        .map(|mut runtime| {
            runtime.source = JavaSource::Managed;
            runtime
        })
        .ok_or_else(|| {
            LauncherError::new(
                ErrorKind::Java,
                format!("Java {major} распаковалась, но исполняемый файл не найден"),
            )
            .with_detail(home.display().to_string())
        })
}
