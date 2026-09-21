//! Writing an instance out as `.mrpack` or as the launcher's own zip.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use sha2::Sha512;

use crate::error::Result;
use crate::instances::{InstanceMeta, ModLoader};
use crate::mods::modrinth::Modrinth;
use crate::mods::{ModProvider, ProjectKind};

use super::mrpack::{allowed_host, Index, IndexFile, INDEX_FILE};
use super::native::{INDEX_FILES, META_FILE};
use super::{blocking, pack_error, PackContext};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Mrpack,
    Zip,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    /// Files referenced by URL (downloaded by whoever imports the pack).
    pub linked: usize,
    /// Files copied into the archive itself.
    pub embedded: usize,
    pub bytes: u64,
}

/// Game folders that are caches or per-machine noise, never worth shipping.
const SKIPPED_DIRS: &[&str] = &["logs", "crash-reports", ".fabric", ".quilt", ".cache", "debug"];
/// Settings folders a modpack normally carries as overrides.
const OVERRIDE_DIRS: &[&str] = &["config", "defaultconfigs", "kubejs", "scripts"];

fn options() -> zip::write::SimpleFileOptions {
    zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated)
}

fn zip_error(error: impl std::fmt::Display) -> crate::error::LauncherError {
    pack_error("Не удалось записать архив").with_detail(error.to_string())
}

/// Every file under `root`, as (absolute path, archive-style relative path).
fn walk(root: &Path, skip_top: &[&str]) -> Result<Vec<(PathBuf, String)>> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(relative) = path.strip_prefix(root) else { continue };
            let archive_name = relative.to_string_lossy().replace('\\', "/");
            let top = archive_name.split('/').next().unwrap_or_default();
            if skip_top.contains(&top) {
                continue;
            }
            if path.is_dir() {
                stack.push(path);
            } else {
                out.push((path, archive_name));
            }
        }
    }
    out.sort_by(|a, b| a.1.cmp(&b.1));
    Ok(out)
}

fn add_file<W: Write + std::io::Seek>(
    writer: &mut zip::ZipWriter<W>,
    source: &Path,
    name: &str,
) -> Result<u64> {
    writer.start_file(name, options()).map_err(zip_error)?;
    let mut file = std::fs::File::open(source)?;
    let copied = std::io::copy(&mut file, writer)?;
    Ok(copied)
}

/// The launcher's own format: metadata, indexes and the whole game folder.
fn write_native(instance_dir: &Path, game_dir: &Path, dest: &Path) -> Result<ExportSummary> {
    let file = std::fs::File::create(dest)?;
    let mut writer = zip::ZipWriter::new(file);
    let mut summary = ExportSummary { linked: 0, embedded: 0, bytes: 0 };

    let mut top_level: Vec<String> = vec![META_FILE.to_owned()];
    top_level.extend(INDEX_FILES.iter().map(|name| (*name).to_owned()));
    if let Ok(entries) = std::fs::read_dir(instance_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with("icon.") {
                top_level.push(name);
            }
        }
    }
    for name in top_level {
        let path = instance_dir.join(&name);
        if path.is_file() {
            summary.bytes += add_file(&mut writer, &path, &name)?;
            summary.embedded += 1;
        }
    }

    for (path, relative) in walk(game_dir, SKIPPED_DIRS)? {
        summary.bytes += add_file(&mut writer, &path, &format!(".minecraft/{relative}"))?;
        summary.embedded += 1;
    }
    writer.finish().map_err(zip_error)?;
    Ok(summary)
}

fn hashes_of(path: &Path) -> Result<(String, String, u64)> {
    let mut file = std::fs::File::open(path)?;
    let (mut sha1, mut sha512) = (Sha1::new(), Sha512::new());
    let mut buffer = vec![0_u8; 128 * 1024];
    let mut size = 0_u64;
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        sha1.update(&buffer[..read]);
        sha512.update(&buffer[..read]);
        size += read as u64;
    }
    Ok((hex::encode(sha1.finalize()), hex::encode(sha512.finalize()), size))
}

fn loader_key(loader: ModLoader) -> Option<&'static str> {
    match loader {
        ModLoader::Fabric => Some("fabric-loader"),
        ModLoader::Quilt => Some("quilt-loader"),
        ModLoader::Forge => Some("forge"),
        ModLoader::NeoForge => Some("neoforge"),
        ModLoader::Vanilla => None,
    }
}

struct Candidate {
    path: PathBuf,
    relative: String,
    sha1: String,
    sha512: String,
    size: u64,
}

/// `.mrpack`: everything Modrinth knows by hash is linked, the rest (and
/// config) rides along in `overrides/`.
async fn write_mrpack(ctx: &PackContext<'_>, meta: &InstanceMeta, dest: &Path) -> Result<ExportSummary> {
    let game_dir = ctx.paths.instance_game_dir(&meta.id);

    ctx.progress.set_stage(String::from("Подсчёт хешей"));
    let dir = game_dir.clone();
    let candidates: Vec<Candidate> = blocking(move || {
        let mut out = Vec::new();
        for kind in [ProjectKind::Mod, ProjectKind::ResourcePack, ProjectKind::Shader] {
            let folder = kind.folder();
            for (path, name) in walk(&dir.join(folder), &[])? {
                let (sha1, sha512, size) = hashes_of(&path)?;
                out.push(Candidate {
                    path,
                    relative: format!("{folder}/{name}"),
                    sha1,
                    sha512,
                    size,
                });
            }
        }
        Ok(out)
    })
    .await?;

    ctx.progress.set_stage(String::from("Поиск файлов на Modrinth"));
    let hashes: Vec<String> = candidates.iter().map(|c| c.sha1.clone()).collect();
    let known = Modrinth::new(ctx.client.clone()).identify(&hashes).await?;

    let mut files = Vec::new();
    let mut embedded: Vec<(PathBuf, String)> = Vec::new();
    for candidate in candidates {
        // Disabled mods have no representation in the format; keep them as
        // files so they stay disabled after import.
        let disabled = candidate.relative.ends_with(".disabled");
        let link = known
            .get(&candidate.sha1)
            .filter(|version| version.sha1.as_deref() == Some(candidate.sha1.as_str()))
            .filter(|version| allowed_host(&version.download_url));
        match link {
            Some(version) if !disabled => files.push(IndexFile {
                path: candidate.relative,
                hashes: HashMap::from([
                    (String::from("sha1"), candidate.sha1),
                    (String::from("sha512"), candidate.sha512),
                ]),
                env: None,
                downloads: vec![version.download_url.clone()],
                file_size: candidate.size,
            }),
            _ => embedded.push((candidate.path, format!("overrides/{}", candidate.relative))),
        }
    }

    let mut dependencies = HashMap::from([(String::from("minecraft"), meta.mc_version.clone())]);
    if let (Some(key), Some(version)) = (loader_key(meta.loader), meta.loader_version.clone()) {
        dependencies.insert(String::from(key), version);
    }
    let index = Index {
        format_version: 1,
        game: String::from("minecraft"),
        version_id: String::from("1.0.0"),
        name: meta.name.clone(),
        summary: None,
        files,
        dependencies,
    };

    ctx.progress.set_stage(String::from("Запись архива"));
    let target = dest.to_path_buf();
    blocking(move || {
        for folder in OVERRIDE_DIRS {
            for (path, name) in walk(&game_dir.join(folder), &[])? {
                embedded.push((path, format!("overrides/{folder}/{name}")));
            }
        }
        let file = std::fs::File::create(&target)?;
        let mut writer = zip::ZipWriter::new(file);
        writer.start_file(INDEX_FILE, options()).map_err(zip_error)?;
        let json = serde_json::to_vec_pretty(&index)?;
        writer.write_all(&json)?;

        let mut summary = ExportSummary {
            linked: index.files.len(),
            embedded: 0,
            bytes: json.len() as u64,
        };
        for (path, name) in &embedded {
            summary.bytes += add_file(&mut writer, path, name)?;
            summary.embedded += 1;
        }
        writer.finish().map_err(zip_error)?;
        Ok(summary)
    })
    .await
}

pub async fn export(
    ctx: &PackContext<'_>,
    meta: &InstanceMeta,
    format: ExportFormat,
    dest: &Path,
) -> Result<ExportSummary> {
    match format {
        ExportFormat::Mrpack => write_mrpack(ctx, meta, dest).await,
        ExportFormat::Zip => {
            ctx.progress.set_stage(String::from("Запись архива"));
            let instance_dir = ctx.paths.instance(&meta.id);
            let game_dir = ctx.paths.instance_game_dir(&meta.id);
            let target = dest.to_path_buf();
            blocking(move || write_native(&instance_dir, &game_dir, &target)).await
        }
    }
}
