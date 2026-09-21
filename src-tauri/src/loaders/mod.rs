//! Mod loaders layered on top of a vanilla version.
//!
//! Every loader ends the same way: a version profile in the shared cache that
//! `inheritsFrom` the vanilla one, whose id the instance then launches. What
//! differs is how that profile is obtained:
//!
//! - Fabric and Quilt serve it ready-made from their meta APIs;
//! - Forge and NeoForge ship an installer whose processors patch the client
//!   jar before the profile is usable (see `installer`).

pub mod fabric_like;
pub mod forge;
pub mod installer;
pub mod neoforge;
pub mod versions;

use std::sync::Arc;

use serde::Serialize;

use crate::error::{ErrorKind, LauncherError, Result};
use crate::instances::{InstanceMeta, ModLoader};
use crate::minecraft::manifest;
use crate::paths::Paths;
use crate::tasks::Progress;

/// One selectable build, as the create dialog shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoaderVersion {
    pub version: String,
    pub stable: bool,
    pub recommended: bool,
}

/// Marks the first stable build as recommended when the source has no opinion.
pub fn recommend_first_stable(versions: &mut [LoaderVersion]) {
    if versions.iter().any(|version| version.recommended) {
        return;
    }
    if let Some(first) = versions.iter_mut().find(|version| version.stable) {
        first.recommended = true;
    }
}

/// Everything an installation needs from the outside world.
pub struct LoaderContext<'a> {
    pub client: &'a reqwest::Client,
    pub paths: &'a Paths,
    pub concurrency: usize,
    pub progress: Arc<dyn Progress>,
    /// The instance whose launch triggered the install; Forge processors need
    /// the vanilla version installed, and natives go into this instance.
    pub instance_id: &'a str,
}

pub async fn list_versions(
    client: &reqwest::Client,
    loader: ModLoader,
    mc_version: &str,
) -> Result<Vec<LoaderVersion>> {
    let mut versions = match loader {
        ModLoader::Vanilla => return Ok(Vec::new()),
        ModLoader::Fabric | ModLoader::Quilt => {
            fabric_like::list_versions(client, loader, mc_version).await?
        }
        ModLoader::Forge => forge::list_versions(client, mc_version).await?,
        ModLoader::NeoForge => neoforge::list_versions(client, mc_version).await?,
    };
    recommend_first_stable(&mut versions);

    if versions.is_empty() {
        return Err(LauncherError::new(
            ErrorKind::Loader,
            format!("{} пока не поддерживает Minecraft {mc_version}", loader.label()),
        ));
    }
    Ok(versions)
}

/// Makes sure the instance's loader profile is installed and returns the
/// profile id to launch. Vanilla instances launch their Minecraft version.
pub async fn ensure_profile(ctx: &LoaderContext<'_>, meta: &InstanceMeta) -> Result<String> {
    if meta.loader == ModLoader::Vanilla {
        return Ok(meta.mc_version.clone());
    }

    // The profile is written only after installation fully succeeds, so its
    // presence in the cache means there is nothing left to do.
    if let Some(profile_id) = &meta.profile_id {
        if manifest::is_cached(ctx.paths, profile_id) {
            return Ok(profile_id.clone());
        }
    }

    let loader_version = meta.loader_version.as_deref().ok_or_else(|| {
        LauncherError::new(
            ErrorKind::Loader,
            format!("У сборки не выбрана версия {}", meta.loader.label()),
        )
    })?;

    ctx.progress
        .set_stage(format!("Установка {} {loader_version}", meta.loader.label()));

    match meta.loader {
        ModLoader::Vanilla => Ok(meta.mc_version.clone()),
        ModLoader::Fabric | ModLoader::Quilt => {
            fabric_like::install(ctx, meta.loader, &meta.mc_version, loader_version).await
        }
        ModLoader::Forge => forge::install(ctx, &meta.mc_version, loader_version).await,
        ModLoader::NeoForge => neoforge::install(ctx, &meta.mc_version, loader_version).await,
    }
}
