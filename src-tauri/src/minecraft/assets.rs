//! The asset index and the thousands of small files behind it.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::config::{read_json_opt, write_json_atomic};
use crate::error::{ErrorKind, LauncherError, Result};
use crate::net::download::DownloadItem;
use crate::net::retry::{network_error, with_retry, RetryPolicy};

use super::version::AssetIndexRef;

const RESOURCES_BASE: &str = "https://resources.download.minecraft.net";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetObject {
    pub hash: String,
    pub size: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AssetIndex {
    #[serde(default)]
    pub objects: HashMap<String, AssetObject>,
    /// Pre-1.7 layouts expose assets as a real directory tree.
    #[serde(default)]
    pub virtual_assets: bool,
    #[serde(default)]
    pub map_to_resources: bool,
}

/// Serde cannot rename `virtual` (a Rust keyword) via attribute alone on a
/// bool default, so the raw form is parsed first.
#[derive(Debug, Deserialize)]
struct RawAssetIndex {
    #[serde(default)]
    objects: HashMap<String, AssetObject>,
    #[serde(default, rename = "virtual")]
    is_virtual: bool,
    #[serde(default)]
    map_to_resources: bool,
}

impl From<RawAssetIndex> for AssetIndex {
    fn from(raw: RawAssetIndex) -> Self {
        Self {
            objects: raw.objects,
            virtual_assets: raw.is_virtual,
            map_to_resources: raw.map_to_resources,
        }
    }
}

pub fn object_path(assets_root: &Path, hash: &str) -> PathBuf {
    let prefix: String = hash.chars().take(2).collect();
    assets_root.join("objects").join(prefix).join(hash)
}

fn index_path(assets_root: &Path, id: &str) -> PathBuf {
    assets_root.join("indexes").join(format!("{id}.json"))
}

/// Fetches (and caches) the asset index named by the version profile.
pub async fn load_index(
    client: &reqwest::Client,
    assets_root: &Path,
    index_ref: &AssetIndexRef,
) -> Result<AssetIndex> {
    let path = index_path(assets_root, &index_ref.id);
    if let Some(index) = read_json_opt::<AssetIndex>(&path).await? {
        if !index.objects.is_empty() {
            return Ok(index);
        }
    }

    let url = index_ref.url.clone();
    let raw = with_retry(RetryPolicy::default(), |_| {
        let url = url.clone();
        async move {
            let response = client
                .get(&url)
                .send()
                .await
                .map_err(|error| network_error("Не удалось скачать список ассетов", &error))?
                .error_for_status()
                .map_err(|error| network_error("Mojang вернул ошибку", &error))?;
            response
                .json::<RawAssetIndex>()
                .await
                .map_err(|error| network_error("Список ассетов не разобрался", &error))
        }
    })
    .await?;

    let index = AssetIndex::from(raw);
    write_json_atomic(&path, &index).await?;
    Ok(index)
}

/// One download per object, deduplicated by hash — many names share content.
pub fn download_items(index: &AssetIndex, assets_root: &Path) -> Vec<DownloadItem> {
    let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
    let mut items = Vec::new();

    for object in index.objects.values() {
        if !seen.insert(object.hash.as_str()) {
            continue;
        }
        let prefix: String = object.hash.chars().take(2).collect();
        items.push(
            DownloadItem::new(
                format!("{RESOURCES_BASE}/{prefix}/{}", object.hash),
                object_path(assets_root, &object.hash),
            )
            .with_sha1(Some(object.hash.clone()))
            .with_size(Some(object.size)),
        );
    }

    items
}

/// Materialises the legacy layouts.
///
/// Before 1.7.3 the game reads a real directory tree instead of the hashed
/// object store, so the objects are copied into place: `assets/virtual/<id>`
/// for `virtual` indexes, and `<game>/resources` for `map_to_resources` ones.
pub async fn materialise_legacy(
    index: &AssetIndex,
    assets_root: &Path,
    index_id: &str,
    game_dir: &Path,
) -> Result<Option<PathBuf>> {
    if !index.virtual_assets && !index.map_to_resources {
        return Ok(None);
    }

    let target = if index.map_to_resources {
        game_dir.join("resources")
    } else {
        assets_root.join("virtual").join(index_id)
    };

    for (name, object) in &index.objects {
        let source = object_path(assets_root, &object.hash);
        let dest = target.join(name);

        // Skip files already materialised at the right size.
        if let Ok(meta) = tokio::fs::metadata(&dest).await {
            if meta.len() == object.size {
                continue;
            }
        }

        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|error| {
                LauncherError::io(format!("Не удалось создать {}", parent.display()))
                    .with_detail(error.to_string())
            })?;
        }

        tokio::fs::copy(&source, &dest).await.map_err(|error| {
            LauncherError::new(
                ErrorKind::Io,
                format!("Не удалось разложить ассет {name}"),
            )
            .with_detail(error.to_string())
        })?;
    }

    // `map_to_resources` writes into the game directory, which is not what
    // `--assetsDir` should point at.
    Ok(if index.map_to_resources {
        None
    } else {
        Some(target)
    })
}
