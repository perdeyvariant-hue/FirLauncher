//! MultiMC and PrismLauncher instances: `instance.cfg` + `mmc-pack.json`
//! next to a `.minecraft` (or `minecraft`) folder, as a directory or a zip.

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;

use serde::Deserialize;

use crate::error::Result;
use crate::instances::{self, InstanceMeta, ModLoader};

use super::{blocking, create_instance, open_zip, pack_error, PackContext, SkippedFile};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Component {
    uid: String,
    version: Option<String>,
    cached_version: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MmcPack {
    #[serde(default)]
    components: Vec<Component>,
}

/// Minecraft version and loader from the component list.
pub fn components_to_versions(json: &str) -> Result<(String, ModLoader, Option<String>)> {
    let pack: MmcPack = serde_json::from_str(json)
        .map_err(|error| pack_error("mmc-pack.json не разобрался").with_detail(error.to_string()))?;
    let mut mc = None;
    let mut loader = (ModLoader::Vanilla, None);
    for component in pack.components {
        let version = component.version.or(component.cached_version);
        match component.uid.as_str() {
            "net.minecraft" => mc = version,
            "net.fabricmc.fabric-loader" => loader = (ModLoader::Fabric, version),
            "org.quiltmc.quilt-loader" => loader = (ModLoader::Quilt, version),
            "net.minecraftforge" => loader = (ModLoader::Forge, version),
            "net.neoforged" => loader = (ModLoader::NeoForge, version),
            _ => {}
        }
    }
    let mc = mc.ok_or_else(|| pack_error("В mmc-pack.json нет версии Minecraft"))?;
    Ok((mc, loader.0, loader.1))
}

/// `key=value` lines of instance.cfg; sections are ignored.
pub fn parse_cfg(text: &str) -> HashMap<String, String> {
    text.lines()
        .filter_map(|line| line.split_once('='))
        .map(|(key, value)| (key.trim().to_owned(), value.trim().to_owned()))
        .collect()
}

/// The raw pieces, read from either a folder or a zip.
struct Source {
    pack_json: String,
    cfg: HashMap<String, String>,
}

fn read_dir_source(root: &Path) -> Result<Source> {
    let pack_json = std::fs::read_to_string(root.join("mmc-pack.json"))
        .map_err(|_| pack_error("В папке нет mmc-pack.json — это не инстанс MultiMC/Prism"))?;
    let cfg = std::fs::read_to_string(root.join("instance.cfg")).unwrap_or_default();
    Ok(Source { pack_json, cfg: parse_cfg(&cfg) })
}

/// Where inside the zip the instance starts: at the root, or one folder down.
fn zip_prefix(archive: &Path) -> Result<Option<String>> {
    let mut zip = open_zip(archive)?;
    for index in 0..zip.len() {
        let Ok(entry) = zip.by_index(index) else { continue };
        let name = entry.name().replace('\\', "/");
        if let Some(prefix) = name.strip_suffix("mmc-pack.json") {
            if prefix.matches('/').count() <= 1 {
                return Ok(Some(prefix.to_owned()));
            }
        }
    }
    Ok(None)
}

fn read_zip_source(archive: &Path, prefix: &str) -> Result<Source> {
    let mut zip = open_zip(archive)?;
    let mut read = |name: &str| -> Option<String> {
        let mut entry = zip.by_name(&format!("{prefix}{name}")).ok()?;
        let mut text = String::new();
        entry.read_to_string(&mut text).ok()?;
        Some(text)
    };
    let pack_json = read("mmc-pack.json").ok_or_else(|| pack_error("В архиве нет mmc-pack.json"))?;
    let cfg = read("instance.cfg").unwrap_or_default();
    Ok(Source { pack_json, cfg: parse_cfg(&cfg) })
}

fn copy_tree(from: &Path, to: &Path) -> Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

pub fn is_instance_dir(path: &Path) -> bool {
    path.join("mmc-pack.json").is_file()
}

pub fn is_instance_zip(archive: &Path) -> bool {
    zip_prefix(archive).ok().flatten().is_some()
}

pub async fn import(ctx: &PackContext<'_>, source: &Path) -> Result<(InstanceMeta, Vec<SkippedFile>)> {
    let path = source.to_path_buf();
    let (raw, zip_root) = blocking(move || -> Result<(Source, Option<String>)> {
        if path.is_dir() {
            Ok((read_dir_source(&path)?, None))
        } else {
            let prefix = zip_prefix(&path)?
                .ok_or_else(|| pack_error("В архиве нет инстанса MultiMC/Prism"))?;
            Ok((read_zip_source(&path, &prefix)?, Some(prefix)))
        }
    })
    .await?;

    let (mc_version, loader, loader_version) = components_to_versions(&raw.pack_json)?;
    let name = raw
        .cfg
        .get("name")
        .cloned()
        .unwrap_or_else(|| String::from("Импорт из MultiMC"));

    ctx.progress.set_stage(format!("Создание сборки «{name}»"));
    let mut meta = create_instance(ctx.paths, &name, &mc_version, loader, loader_version).await?;
    let game_dir = ctx.paths.instance_game_dir(&meta.id);

    ctx.progress.set_stage(String::from("Копирование файлов игры"));
    let from = source.to_path_buf();
    let target = game_dir.clone();
    blocking(move || -> Result<()> {
        match zip_root {
            None => {
                // Prism uses `minecraft`, MultiMC `.minecraft`.
                let dir = [".minecraft", "minecraft"]
                    .iter()
                    .map(|name| from.join(name))
                    .find(|dir| dir.is_dir());
                if let Some(dir) = dir {
                    copy_tree(&dir, &target)?;
                }
            }
            Some(prefix) => {
                for name in [".minecraft", "minecraft"] {
                    super::extract_prefix(&from, &format!("{prefix}{name}"), &target)?;
                }
            }
        }
        Ok(())
    })
    .await?;

    // Carry over the per-instance Java overrides MultiMC users set up.
    let enabled = |key: &str| raw.cfg.get(key).is_some_and(|value| value == "true");
    if enabled("OverrideMemory") {
        meta.java.memory_mb = raw.cfg.get("MaxMemAlloc").and_then(|value| value.parse().ok());
    }
    if enabled("OverrideJavaArgs") {
        meta.java.extra_jvm_args = raw.cfg.get("JvmArgs").cloned().filter(|args| !args.is_empty());
    }
    instances::write_meta(ctx.paths, &meta).await?;

    Ok((meta, Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prism_components_resolve_to_a_loader() -> Result<()> {
        let json = r#"{"components":[
            {"uid":"org.lwjgl3","version":"3.3.1"},
            {"uid":"net.minecraft","version":"1.20.1"},
            {"uid":"net.fabricmc.intermediary","cachedVersion":"1.20.1"},
            {"uid":"net.fabricmc.fabric-loader","version":"0.14.21"}],"formatVersion":1}"#;
        let (mc, loader, version) = components_to_versions(json)?;
        assert_eq!(mc, "1.20.1");
        assert_eq!(loader, ModLoader::Fabric);
        assert_eq!(version.as_deref(), Some("0.14.21"));
        Ok(())
    }

    #[test]
    fn instance_cfg_is_read_as_key_values() {
        let cfg = parse_cfg("[General]\nname=My Pack\nOverrideMemory=true\nMaxMemAlloc=6144\n");
        assert_eq!(cfg.get("name").map(String::as_str), Some("My Pack"));
        assert_eq!(cfg.get("MaxMemAlloc").map(String::as_str), Some("6144"));
    }
}
