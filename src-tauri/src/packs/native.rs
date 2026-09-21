//! The launcher's own archive: `instance.json`, the source indexes and the
//! whole `.minecraft` folder. Exported by "Экспорт → zip", imported as a new
//! instance with the same settings.

use std::path::Path;

use crate::error::Result;
use crate::instances::{self, InstanceMeta};

use super::{blocking, create_instance, pack_error, read_zip_entry, PackContext, SkippedFile};

pub const META_FILE: &str = "instance.json";
/// Per-folder source indexes kept next to instance.json.
pub const INDEX_FILES: &[&str] = &["mods.json", "resourcepacks.json", "shaderpacks.json"];

pub fn is_native_zip(archive: &Path) -> bool {
    read_zip_entry(archive, META_FILE).ok().flatten().is_some()
}

pub async fn import(ctx: &PackContext<'_>, archive: &Path) -> Result<(InstanceMeta, Vec<SkippedFile>)> {
    let source = archive.to_path_buf();
    let bytes = blocking(move || read_zip_entry(&source, META_FILE))
        .await?
        .ok_or_else(|| pack_error("В архиве нет instance.json"))?;
    let original: InstanceMeta = serde_json::from_slice(&bytes)
        .map_err(|error| pack_error("instance.json не разобрался").with_detail(error.to_string()))?;

    ctx.progress.set_stage(format!("Создание сборки «{}»", original.name));
    let mut meta = create_instance(
        ctx.paths,
        &original.name,
        &original.mc_version,
        original.loader,
        original.loader_version.clone(),
    )
    .await?;

    ctx.progress.set_stage(String::from("Распаковка файлов"));
    let instance_dir = ctx.paths.instance(&meta.id);
    let game_dir = ctx.paths.instance_game_dir(&meta.id);
    let icon = original.icon_file.clone();
    let (from, icon_target) = (archive.to_path_buf(), instance_dir.clone());
    let icon_restored = blocking(move || -> Result<bool> {
        super::extract_prefix(&from, ".minecraft", &game_dir)?;
        for name in INDEX_FILES {
            if let Some(bytes) = read_zip_entry(&from, name)? {
                std::fs::write(icon_target.join(name), bytes)?;
            }
        }
        match icon.as_deref().and_then(super::safe_relative) {
            Some(name) => match read_zip_entry(&from, &name.to_string_lossy())? {
                Some(bytes) => {
                    std::fs::write(icon_target.join(&name), bytes)?;
                    Ok(true)
                }
                None => Ok(false),
            },
            None => Ok(false),
        }
    })
    .await?;

    // Settings carry over; history (playtime, last played) does not.
    meta.java = original.java;
    meta.group = original.group;
    if icon_restored {
        meta.icon_file = original.icon_file;
    }
    instances::write_meta(ctx.paths, &meta).await?;
    Ok((meta, Vec::new()))
}
