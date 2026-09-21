//! CurseForge modpack zips: `manifest.json` names project/file ids, which are
//! resolved through the CurseForge API; `overrides/` is copied as-is.

use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;

use serde::Deserialize;

use crate::error::Result;
use crate::instances::{InstanceMeta, ModLoader};
use crate::mods::curseforge::CurseForge;
use crate::mods::index::{IndexEntry, ModIndex};
use crate::mods::ProjectKind;
use crate::net::download::{download_all, total_bytes, DownloadItem, ProgressSink};

use super::{blocking, create_instance, pack_error, read_zip_entry, PackContext, SkippedFile};

pub const MANIFEST_FILE: &str = "manifest.json";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoaderRef {
    id: String,
    #[serde(default)]
    primary: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MinecraftRef {
    version: String,
    #[serde(default)]
    mod_loaders: Vec<LoaderRef>,
}

#[derive(Debug, Deserialize)]
struct FileRef {
    #[serde(rename = "projectID")]
    project_id: u64,
    #[serde(rename = "fileID")]
    file_id: u64,
    #[serde(default = "default_required")]
    required: bool,
}

fn default_required() -> bool {
    true
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    minecraft: MinecraftRef,
    manifest_type: Option<String>,
    #[serde(default)]
    name: String,
    #[serde(default)]
    files: Vec<FileRef>,
    overrides: Option<String>,
}

/// `forge-47.2.0` -> (Forge, 47.2.0). NeoForge for 1.20.1 is sometimes
/// written with the Minecraft prefix, which the installer adds itself.
pub fn parse_loader(id: &str, mc_version: &str) -> (ModLoader, Option<String>) {
    let Some((name, version)) = id.split_once('-') else {
        return (ModLoader::Vanilla, None);
    };
    let loader = match name {
        "forge" => ModLoader::Forge,
        "neoforge" => ModLoader::NeoForge,
        "fabric" => ModLoader::Fabric,
        "quilt" => ModLoader::Quilt,
        _ => return (ModLoader::Vanilla, None),
    };
    let version = version
        .strip_prefix(&format!("{mc_version}-"))
        .unwrap_or(version)
        .to_owned();
    (loader, Some(version))
}

fn folder_for(kind: ProjectKind, file_name: &str) -> ProjectKind {
    match kind {
        ProjectKind::ResourcePack | ProjectKind::Shader => kind,
        // Unknown classes fall back on the file type.
        _ if file_name.to_ascii_lowercase().ends_with(".zip") => ProjectKind::ResourcePack,
        _ => ProjectKind::Mod,
    }
}

pub async fn import(ctx: &PackContext<'_>, archive: &Path) -> Result<(InstanceMeta, Vec<SkippedFile>)> {
    let source = archive.to_path_buf();
    let bytes = blocking(move || read_zip_entry(&source, MANIFEST_FILE))
        .await?
        .ok_or_else(|| pack_error("В архиве нет manifest.json"))?;
    let manifest: Manifest = serde_json::from_slice(&bytes)
        .map_err(|error| pack_error("manifest.json не разобрался").with_detail(error.to_string()))?;
    if manifest.manifest_type.as_deref().is_some_and(|kind| kind != "minecraftModpack") {
        return Err(pack_error("Это не модпак CurseForge"));
    }

    let wanted: Vec<&FileRef> = manifest.files.iter().filter(|file| file.required).collect();
    let key = crate::mods::curseforge_key(ctx.settings).unwrap_or_default();
    if key.is_empty() && !wanted.is_empty() {
        return Err(pack_error(
            "Для импорта модпака CurseForge нужен ключ API — укажите его в «Настройки → Сеть и источники»",
        ));
    }

    let mc_version = manifest.minecraft.version.clone();
    let loader_ref = manifest
        .minecraft
        .mod_loaders
        .iter()
        .find(|loader| loader.primary)
        .or_else(|| manifest.minecraft.mod_loaders.first());
    let (loader, loader_version) = loader_ref
        .map(|loader| parse_loader(&loader.id, &mc_version))
        .unwrap_or((ModLoader::Vanilla, None));

    ctx.progress.set_stage(format!("Создание сборки «{}»", manifest.name));
    let meta = create_instance(ctx.paths, &manifest.name, &mc_version, loader, loader_version).await?;
    let game_dir = ctx.paths.instance_game_dir(&meta.id);
    let mut skipped = Vec::new();

    if !wanted.is_empty() {
        let api = CurseForge::new(ctx.client.clone(), &key);
        ctx.progress
            .set_stage(format!("Список файлов CurseForge ({})", wanted.len()));
        let file_ids: Vec<u64> = wanted.iter().map(|file| file.file_id).collect();
        let project_ids: Vec<u64> = wanted
            .iter()
            .map(|file| file.project_id)
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        let versions = api.files_by_ids(&file_ids).await?;
        let projects = api.project_info(&project_ids).await?;

        let mut items = Vec::new();
        let mut indexed: Vec<(ProjectKind, crate::mods::ModVersion)> = Vec::new();
        for version in versions {
            let info = projects.get(&version.project_id);
            // Authors can opt out of third-party downloads; that choice is
            // respected, and the user gets a link instead.
            if version.download_url.is_empty() {
                skipped.push(SkippedFile {
                    name: info.map_or_else(|| version.file_name.clone(), |p| p.name.clone()),
                    url: info.and_then(|p| p.page_url.clone()),
                    reason: String::from("Автор запретил скачивание через сторонние лаунчеры"),
                });
                continue;
            }
            let kind = folder_for(info.map_or(ProjectKind::Mod, |p| p.kind), &version.file_name);
            let Some(name) = super::safe_relative(&version.file_name) else {
                continue;
            };
            items.push(
                DownloadItem::new(version.download_url.clone(), game_dir.join(kind.folder()).join(name))
                    .with_sha1(version.sha1.clone())
                    .with_size(Some(version.size_bytes)),
            );
            indexed.push((kind, version));
        }

        ctx.progress.begin_phase(
            format!("Файлы модпака ({})", items.len()),
            Some(total_bytes(&items)),
        );
        download_all(
            ctx.client,
            items,
            ctx.settings.download_concurrency(),
            ctx.progress.token(),
            Arc::clone(&ctx.progress) as Arc<dyn ProgressSink>,
        )
        .await?;

        for kind in [ProjectKind::Mod, ProjectKind::ResourcePack, ProjectKind::Shader] {
            let mut content = ModIndex::load(ctx.paths, &meta.id, kind).await?;
            for (_, version) in indexed.iter().filter(|(k, _)| *k == kind) {
                content.insert(&version.file_name, IndexEntry::from(version));
            }
            content.save(ctx.paths, &meta.id, kind).await?;
        }
    }

    ctx.progress.set_stage(String::from("Копирование настроек модпака"));
    let overrides = manifest.overrides.unwrap_or_else(|| String::from("overrides"));
    let (source, target) = (archive.to_path_buf(), game_dir);
    blocking(move || super::extract_prefix(&source, &overrides, &target)).await?;

    Ok((meta, skipped))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loader_ids_are_split() {
        assert_eq!(
            parse_loader("forge-47.2.0", "1.20.1"),
            (ModLoader::Forge, Some(String::from("47.2.0")))
        );
        assert_eq!(
            parse_loader("neoforge-1.20.1-47.1.106", "1.20.1"),
            (ModLoader::NeoForge, Some(String::from("47.1.106")))
        );
        assert_eq!(
            parse_loader("fabric-0.15.11", "1.20.4"),
            (ModLoader::Fabric, Some(String::from("0.15.11")))
        );
        assert_eq!(parse_loader("liteloader-1", "1.12.2").0, ModLoader::Vanilla);
    }

    #[test]
    fn a_manifest_parses() -> std::result::Result<(), serde_json::Error> {
        let manifest: Manifest = serde_json::from_str(
            r#"{"minecraft":{"version":"1.20.1","modLoaders":[{"id":"forge-47.2.0","primary":true}]},
                "manifestType":"minecraftModpack","manifestVersion":1,"name":"Test Pack","version":"1.0",
                "author":"me","files":[{"projectID":238222,"fileID":5101366,"required":true},
                {"projectID":1,"fileID":2,"required":false}],"overrides":"overrides"}"#,
        )?;
        assert_eq!(manifest.files.len(), 2);
        assert!(!manifest.files[1].required);
        assert_eq!(manifest.minecraft.mod_loaders[0].id, "forge-47.2.0");
        Ok(())
    }

    #[test]
    fn packs_land_in_the_right_folder() {
        assert_eq!(folder_for(ProjectKind::Shader, "x.zip"), ProjectKind::Shader);
        assert_eq!(folder_for(ProjectKind::Mod, "pack.zip"), ProjectKind::ResourcePack);
        assert_eq!(folder_for(ProjectKind::Mod, "mod.jar"), ProjectKind::Mod);
    }
}
