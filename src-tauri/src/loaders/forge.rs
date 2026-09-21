//! Forge: versions from its maven metadata and promotions, installation
//! through the shared installer pipeline.

use std::collections::HashMap;

use serde::Deserialize;

use crate::error::{ErrorKind, LauncherError, Result};
use crate::net::retry::{network_error, with_retry, RetryPolicy};

use super::versions::{looks_unstable, sort_descending};
use super::{installer, LoaderContext, LoaderVersion};

const MAVEN: &str = "https://maven.minecraftforge.net/net/minecraftforge/forge";
const PROMOTIONS: &str =
    "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";

#[derive(Debug, Deserialize)]
struct Promotions {
    promos: HashMap<String, String>,
}

async fn fetch_text(client: &reqwest::Client, url: &str, what: &str) -> Result<String> {
    let url = url.to_owned();
    with_retry(RetryPolicy::default(), |_| {
        let url = url.clone();
        async move {
            let response = client
                .get(&url)
                .send()
                .await
                .map_err(|error| network_error(&format!("Не удалось получить {what}"), &error))?
                .error_for_status()
                .map_err(|error| network_error(&format!("Сервер Forge отклонил запрос: {what}"), &error))?;
            response.text().await.map_err(|error| {
                network_error(&format!("Обрыв при загрузке: {what}"), &error)
            })
        }
    })
    .await
}

/// Pulls every `<version>` out of maven-metadata.xml. The file is flat and
/// machine-written, so a scan is enough — no XML parser dependency.
pub fn parse_metadata(xml: &str) -> Vec<String> {
    xml.split("<version>")
        .skip(1)
        .filter_map(|chunk| chunk.split("</version>").next())
        .map(|version| version.trim().to_owned())
        .filter(|version| !version.is_empty())
        .collect()
}

/// Forge versions are `<mc>-<forge>[-<branch>]`; the prefix includes the dash
/// so `1.21.1-` does not also match `1.21.10-…`.
pub fn versions_for(all: &[String], mc_version: &str) -> Vec<String> {
    let prefix = format!("{mc_version}-");
    all.iter()
        .filter_map(|version| version.strip_prefix(&prefix).map(str::to_owned))
        .collect()
}

pub async fn list_versions(client: &reqwest::Client, mc_version: &str) -> Result<Vec<LoaderVersion>> {
    let xml = fetch_text(client, &format!("{MAVEN}/maven-metadata.xml"), "версии Forge").await?;
    let mut versions = versions_for(&parse_metadata(&xml), mc_version);
    sort_descending(&mut versions);

    // Promotions are a nicety; a failure there must not hide the list.
    let recommended = match fetch_text(client, PROMOTIONS, "рекомендации Forge").await {
        Ok(text) => serde_json::from_str::<Promotions>(&text)
            .ok()
            .and_then(|promotions| {
                promotions
                    .promos
                    .get(&format!("{mc_version}-recommended"))
                    .cloned()
            }),
        Err(_) => None,
    };

    Ok(versions
        .into_iter()
        .map(|version| LoaderVersion {
            // Forge has no pre-release channel beyond the odd "-beta" tag.
            stable: !looks_unstable(&version),
            recommended: recommended.as_deref() == Some(version.as_str()),
            version,
        })
        .collect())
}

pub async fn install(ctx: &LoaderContext<'_>, mc_version: &str, version: &str) -> Result<String> {
    // Very old Forge (before 1.5.2) shipped no installer at all.
    let full = format!("{mc_version}-{version}");
    let url = format!("{MAVEN}/{full}/forge-{full}-installer.jar");
    installer::install(ctx, mc_version, &url, "Forge")
        .await
        .map_err(|error| {
            if error.kind == ErrorKind::Http {
                LauncherError::new(
                    ErrorKind::Loader,
                    format!("Для Forge {full} нет установщика — выберите другую сборку"),
                )
                .with_detail(error.detail.unwrap_or(error.message))
            } else {
                error
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_versions_are_extracted() {
        let xml = "<metadata><versioning><versions>\
            <version>1.21-51.0.33</version>\
            <version>1.12.2-14.23.5.2859</version>\
            </versions></versioning></metadata>";
        assert_eq!(
            parse_metadata(xml),
            vec!["1.21-51.0.33", "1.12.2-14.23.5.2859"]
        );
    }

    #[test]
    fn the_dash_keeps_minor_versions_apart() {
        let all = vec![
            String::from("1.21.1-52.0.40"),
            String::from("1.21.10-60.0.1"),
            String::from("1.7.10-10.13.4.1614-1.7.10"),
        ];
        assert_eq!(versions_for(&all, "1.21.1"), vec!["52.0.40"]);
        // Legacy branch suffixes survive as part of the Forge version.
        assert_eq!(versions_for(&all, "1.7.10"), vec!["10.13.4.1614-1.7.10"]);
    }
}
