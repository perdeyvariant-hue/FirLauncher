//! Fabric and Quilt: both publish a ready-to-use version profile, so
//! installing one is a single request.

use serde::Deserialize;

use crate::error::{ErrorKind, LauncherError, Result};
use crate::instances::ModLoader;
use crate::minecraft::manifest;
use crate::minecraft::version::VersionJson;
use crate::net::retry::{network_error, with_retry, RetryPolicy};

use super::versions::{compare, looks_unstable};
use super::{LoaderContext, LoaderVersion};

const FABRIC_META: &str = "https://meta.fabricmc.net/v2";
const QUILT_META: &str = "https://meta.quiltmc.org/v3";

#[derive(Debug, Deserialize)]
struct LoaderInfo {
    version: String,
    /// Fabric flags stability explicitly; Quilt does not.
    stable: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct LoaderEntry {
    loader: LoaderInfo,
}

fn meta_base(loader: ModLoader) -> &'static str {
    if loader == ModLoader::Quilt {
        QUILT_META
    } else {
        FABRIC_META
    }
}

async fn get_json<T: serde::de::DeserializeOwned>(
    client: &reqwest::Client,
    url: String,
    what: &str,
) -> Result<Option<T>> {
    with_retry(RetryPolicy::default(), |_| {
        let url = url.clone();
        async move {
            let response = client
                .get(&url)
                .send()
                .await
                .map_err(|error| network_error(&format!("Не удалось получить {what}"), &error))?;
            // The meta APIs answer 400/404 for Minecraft versions they do not
            // support; that is an empty result, not a failure.
            if matches!(
                response.status(),
                reqwest::StatusCode::NOT_FOUND | reqwest::StatusCode::BAD_REQUEST
            ) {
                return Ok(None);
            }
            let response = response
                .error_for_status()
                .map_err(|error| network_error(&format!("Сервер отклонил запрос: {what}"), &error))?;
            response.json::<T>().await.map(Some).map_err(|error| {
                LauncherError::new(ErrorKind::Parse, format!("Не разобрался ответ: {what}"))
                    .with_detail(error.to_string())
            })
        }
    })
    .await
}

pub async fn list_versions(
    client: &reqwest::Client,
    loader: ModLoader,
    mc_version: &str,
) -> Result<Vec<LoaderVersion>> {
    let url = format!("{}/versions/loader/{mc_version}", meta_base(loader));
    let entries: Vec<LoaderEntry> = get_json(client, url, "список версий лоадера")
        .await?
        .unwrap_or_default();

    let mut versions: Vec<LoaderVersion> = entries
        .into_iter()
        .map(|entry| LoaderVersion {
            stable: entry
                .loader
                .stable
                .unwrap_or_else(|| !looks_unstable(&entry.loader.version)),
            version: entry.loader.version,
            recommended: false,
        })
        .collect();
    // Quilt's list is not sorted; Fabric's is, and re-sorting it is harmless.
    versions.sort_by(|a, b| compare(&b.version, &a.version));
    Ok(versions)
}

/// Downloads the loader's version profile into the shared cache. The loader's
/// own libraries are fetched later by the regular install, like any other.
pub async fn install(
    ctx: &LoaderContext<'_>,
    loader: ModLoader,
    mc_version: &str,
    loader_version: &str,
) -> Result<String> {
    let url = format!(
        "{}/versions/loader/{mc_version}/{loader_version}/profile/json",
        meta_base(loader)
    );
    let profile: VersionJson = get_json(ctx.client, url, "профиль лоадера")
        .await?
        .ok_or_else(|| {
            LauncherError::new(
                ErrorKind::Loader,
                format!(
                    "{} {loader_version} не найден для Minecraft {mc_version}",
                    loader.label()
                ),
            )
        })?;

    if profile.inherits_from.as_deref() != Some(mc_version) {
        return Err(LauncherError::new(
            ErrorKind::Loader,
            format!("Профиль {} собран не для Minecraft {mc_version}", profile.id),
        ));
    }

    manifest::store_version_json(ctx.paths, &profile).await?;
    Ok(profile.id)
}
