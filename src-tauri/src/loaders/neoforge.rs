//! NeoForge: versions from its maven API, installation through the shared
//! Forge-style installer pipeline.

use serde::Deserialize;

use crate::error::{ErrorKind, LauncherError, Result};
use crate::net::retry::{network_error, with_retry, RetryPolicy};

use super::versions::{looks_unstable, sort_descending};
use super::{installer, LoaderContext, LoaderVersion};

const MAVEN: &str = "https://maven.neoforged.net/releases";
const API: &str = "https://maven.neoforged.net/api/maven/versions/releases";
/// For 1.20.1 only, NeoForge shipped under the old `forge` artifact.
const LEGACY_MC: &str = "1.20.1";

#[derive(Debug, Deserialize)]
struct VersionList {
    versions: Vec<String>,
}

/// The leading components a NeoForge version must have for this Minecraft
/// version. NeoForge drops the `1.` prefix (`1.21.1` -> `21.1.x`) and, since
/// Minecraft moved to year-based numbers, mirrors them padded to three parts
/// (`26.1` -> `26.1.0.x`, `26.1.2` -> `26.1.2.x`).
pub fn neoforge_prefix(mc_version: &str) -> Option<Vec<u64>> {
    let parts: Vec<u64> = mc_version
        .split('.')
        .map(str::parse)
        .collect::<std::result::Result<_, _>>()
        .ok()?;
    match parts.as_slice() {
        [1, minor] => Some(vec![*minor, 0]),
        [1, minor, patch] => Some(vec![*minor, *patch]),
        [year, drop] if *year > 1 => Some(vec![*year, *drop, 0]),
        [year, drop, hotfix] if *year > 1 => Some(vec![*year, *drop, *hotfix]),
        _ => None,
    }
}

/// Compares numerically, component by component. A string prefix would be
/// wrong: `21.1.` is a prefix of `21.10.4`, which targets Minecraft 1.21.10.
pub fn matches_prefix(version: &str, prefix: &[u64]) -> bool {
    let head = version.split(['-', '+']).next().unwrap_or_default();
    let parts: Vec<u64> = head
        .split('.')
        .map_while(|part| part.parse::<u64>().ok())
        .collect();
    // A build number must follow the prefix.
    parts.len() > prefix.len() && parts.starts_with(prefix)
}

async fn fetch_versions(client: &reqwest::Client, artifact: &str) -> Result<Vec<String>> {
    let url = format!("{API}/net/neoforged/{artifact}");
    with_retry(RetryPolicy::default(), |_| {
        let url = url.clone();
        async move {
            let response = client
                .get(&url)
                .send()
                .await
                .map_err(|error| network_error("Не удалось получить версии NeoForge", &error))?
                .error_for_status()
                .map_err(|error| network_error("Maven NeoForge вернул ошибку", &error))?;
            response
                .json::<VersionList>()
                .await
                .map(|list| list.versions)
                .map_err(|error| {
                    LauncherError::new(ErrorKind::Parse, "Список версий NeoForge не разобрался")
                        .with_detail(error.to_string())
                })
        }
    })
    .await
}

fn to_entries(versions: Vec<String>) -> Vec<LoaderVersion> {
    let mut versions = versions;
    sort_descending(&mut versions);
    versions
        .into_iter()
        .map(|version| LoaderVersion {
            stable: !looks_unstable(&version),
            version,
            recommended: false,
        })
        .collect()
}

pub async fn list_versions(client: &reqwest::Client, mc_version: &str) -> Result<Vec<LoaderVersion>> {
    if mc_version == LEGACY_MC {
        let prefix = format!("{LEGACY_MC}-");
        let versions = fetch_versions(client, "forge")
            .await?
            .into_iter()
            .filter_map(|version| version.strip_prefix(&prefix).map(str::to_owned))
            .collect();
        return Ok(to_entries(versions));
    }

    let Some(prefix) = neoforge_prefix(mc_version) else {
        return Ok(Vec::new());
    };
    let versions = fetch_versions(client, "neoforge")
        .await?
        .into_iter()
        .filter(|version| matches_prefix(version, &prefix))
        .collect();
    Ok(to_entries(versions))
}

pub async fn install(ctx: &LoaderContext<'_>, mc_version: &str, version: &str) -> Result<String> {
    let url = if mc_version == LEGACY_MC {
        let full = format!("{LEGACY_MC}-{version}");
        format!("{MAVEN}/net/neoforged/forge/{full}/forge-{full}-installer.jar")
    } else {
        format!("{MAVEN}/net/neoforged/neoforge/{version}/neoforge-{version}-installer.jar")
    };
    installer::install(ctx, mc_version, &url, "NeoForge").await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classic_versions_drop_the_leading_one() {
        assert_eq!(neoforge_prefix("1.21.1"), Some(vec![21, 1]));
        assert_eq!(neoforge_prefix("1.21"), Some(vec![21, 0]));
    }

    #[test]
    fn year_based_versions_are_padded_to_three_parts() {
        assert_eq!(neoforge_prefix("26.1"), Some(vec![26, 1, 0]));
        assert_eq!(neoforge_prefix("26.1.2"), Some(vec![26, 1, 2]));
        assert_eq!(neoforge_prefix("25w14craftmine"), None);
    }

    #[test]
    fn minor_versions_do_not_bleed_into_each_other() {
        // The trap: 21.1. is a string prefix of 21.10.x and 21.11.x.
        let prefix = vec![21, 1];
        assert!(matches_prefix("21.1.77", &prefix));
        assert!(!matches_prefix("21.10.4-beta", &prefix));
        assert!(!matches_prefix("21.11.45", &prefix));
        assert!(!matches_prefix("21.1", &prefix));
    }

    #[test]
    fn year_based_builds_match_their_release() {
        assert!(matches_prefix("26.1.0.19-beta", &[26, 1, 0]));
        assert!(matches_prefix("26.1.0.0-alpha.1+snapshot-1", &[26, 1, 0]));
        assert!(!matches_prefix("26.1.2.108", &[26, 1, 0]));
    }
}
