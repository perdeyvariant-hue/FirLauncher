//! Mojang's version manifest and the per-version JSON, with an on-disk cache.

use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};

use crate::config::{read_json_opt, write_json_atomic};
use crate::error::{ErrorKind, LauncherError, Result};
use crate::net::retry::{network_error, with_retry, RetryPolicy};
use crate::paths::Paths;

use super::version::VersionJson;

pub const MANIFEST_URL: &str =
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

/// How long a cached manifest is trusted before we look for new versions.
const MANIFEST_TTL: Duration = Duration::from_secs(60 * 60);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatestVersions {
    pub release: String,
    pub snapshot: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestVersion {
    pub id: String,
    #[serde(rename = "type")]
    pub version_type: String,
    pub url: String,
    pub time: Option<String>,
    pub release_time: Option<String>,
    pub sha1: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionManifest {
    pub latest: LatestVersions,
    pub versions: Vec<ManifestVersion>,
}

impl VersionManifest {
    pub fn find(&self, id: &str) -> Option<&ManifestVersion> {
        self.versions.iter().find(|version| version.id == id)
    }
}

/// What the version picker in the UI consumes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MinecraftVersionDto {
    pub id: String,
    #[serde(rename = "type")]
    pub version_type: String,
    pub released_at: String,
}

fn manifest_cache(paths: &Paths) -> PathBuf {
    paths.meta().join("version_manifest_v2.json")
}

fn version_cache(paths: &Paths, id: &str) -> PathBuf {
    // Version ids come from Mojang and from loader installers; keep them from
    // escaping the cache directory.
    let safe: String = id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
        .collect();
    paths.meta().join("versions").join(format!("{safe}.json"))
}

async fn cache_is_fresh(path: &PathBuf, ttl: Duration) -> bool {
    let Ok(meta) = tokio::fs::metadata(path).await else {
        return false;
    };
    let Ok(modified) = meta.modified() else {
        return false;
    };
    SystemTime::now()
        .duration_since(modified)
        .map(|age| age < ttl)
        .unwrap_or(false)
}

/// Loads the manifest, preferring a fresh cache and falling back to a stale
/// one when the network is down — an offline launcher should still list the
/// versions it already knows about.
pub async fn load_manifest(
    client: &reqwest::Client,
    paths: &Paths,
    force_refresh: bool,
) -> Result<VersionManifest> {
    let cache = manifest_cache(paths);

    if !force_refresh && cache_is_fresh(&cache, MANIFEST_TTL).await {
        if let Some(manifest) = read_json_opt::<VersionManifest>(&cache).await? {
            return Ok(manifest);
        }
    }

    let fetched = with_retry(RetryPolicy::default(), |_| async {
        let response = client
            .get(MANIFEST_URL)
            .send()
            .await
            .map_err(|error| network_error("Не удалось получить список версий", &error))?
            .error_for_status()
            .map_err(|error| network_error("Mojang вернул ошибку", &error))?;
        response
            .json::<VersionManifest>()
            .await
            .map_err(|error| network_error("Список версий не разобрался", &error))
    })
    .await;

    match fetched {
        Ok(manifest) => {
            write_json_atomic(&cache, &manifest).await?;
            Ok(manifest)
        }
        Err(error) => match read_json_opt::<VersionManifest>(&cache).await? {
            Some(manifest) => Ok(manifest),
            None => Err(error),
        },
    }
}

/// Reads one version profile: a locally installed one (written by a loader
/// installer) wins over the vanilla manifest entry.
pub async fn load_version_json(
    client: &reqwest::Client,
    paths: &Paths,
    manifest: &VersionManifest,
    id: &str,
) -> Result<VersionJson> {
    let cache = version_cache(paths, id);
    if let Some(version) = read_json_opt::<VersionJson>(&cache).await? {
        return Ok(version);
    }

    let entry = manifest.find(id).ok_or_else(|| {
        LauncherError::new(
            ErrorKind::Instance,
            format!("Версия {id} не найдена в манифесте Mojang"),
        )
    })?;
    let url = entry.url.clone();

    let version = with_retry(RetryPolicy::default(), |_| {
        let url = url.clone();
        async move {
            let response = client
                .get(&url)
                .send()
                .await
                .map_err(|error| network_error("Не удалось скачать описание версии", &error))?
                .error_for_status()
                .map_err(|error| network_error("Mojang вернул ошибку", &error))?;
            response
                .json::<VersionJson>()
                .await
                .map_err(|error| network_error("Описание версии не разобралось", &error))
        }
    })
    .await?;

    write_json_atomic(&cache, &version).await?;
    Ok(version)
}

/// Follows the `inheritsFrom` chain and folds every profile into one.
pub async fn resolve_version(
    client: &reqwest::Client,
    paths: &Paths,
    manifest: &VersionManifest,
    id: &str,
) -> Result<VersionJson> {
    let mut chain: Vec<VersionJson> = Vec::new();
    let mut current = id.to_owned();

    // Depth is bounded: loader profiles inherit once, but a hand-edited file
    // could loop forever.
    for _ in 0..8 {
        let version = load_version_json(client, paths, manifest, &current).await?;
        let parent = version.inherits_from.clone();
        chain.push(version);

        match parent {
            Some(parent) if !parent.is_empty() => current = parent,
            _ => {
                let mut resolved = chain
                    .pop()
                    .ok_or_else(|| LauncherError::internal("Пустая цепочка наследования"))?;
                // Fold back down: the deepest ancestor is the base.
                while let Some(child) = chain.pop() {
                    resolved = VersionJson::merge_onto(&child, &resolved);
                }
                return Ok(resolved);
            }
        }
    }

    Err(LauncherError::new(
        ErrorKind::Parse,
        "Слишком длинная цепочка inheritsFrom",
    ))
}

/// Whether a profile is already in the version cache — for loaders this is
/// the "installed" marker, since it is written only after installation
/// succeeds.
pub fn is_cached(paths: &Paths, id: &str) -> bool {
    version_cache(paths, id).is_file()
}

/// Writes a loader-produced profile into the shared version cache.
pub async fn store_version_json(paths: &Paths, version: &VersionJson) -> Result<()> {
    write_json_atomic(&version_cache(paths, &version.id), version).await
}

pub fn to_dto(manifest: &VersionManifest, include_snapshots: bool) -> Vec<MinecraftVersionDto> {
    manifest
        .versions
        .iter()
        .filter(|version| include_snapshots || version.version_type == "release")
        .map(|version| MinecraftVersionDto {
            id: version.id.clone(),
            version_type: version.version_type.clone(),
            released_at: version
                .release_time
                .clone()
                .or_else(|| version.time.clone())
                .unwrap_or_default(),
        })
        .collect()
}
