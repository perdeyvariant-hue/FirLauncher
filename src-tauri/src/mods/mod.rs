//! Mods from Modrinth and CurseForge: search, dependency resolution,
//! installation into an instance and update checks.
//!
//! Both sources sit behind one `ModProvider` trait, so adding a third is a
//! matter of implementing it and listing it in `providers()`.

pub mod curseforge;
pub mod index;
pub mod install;
pub mod modrinth;
pub mod optimize;
pub mod provider;
pub mod resolve;

use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::config::settings::Settings;
use crate::error::{ErrorKind, LauncherError, Result};
use crate::instances::ModLoader;

pub use provider::ModProvider;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderId {
    Modrinth,
    CurseForge,
}

impl ProviderId {
    pub fn label(self) -> &'static str {
        match self {
            ProviderId::Modrinth => "Modrinth",
            ProviderId::CurseForge => "CurseForge",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectKind {
    Mod,
    Modpack,
    ResourcePack,
    Shader,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DependencyKind {
    Required,
    Optional,
    Incompatible,
    Embedded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReleaseType {
    Release,
    Beta,
    Alpha,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortOrder {
    Relevance,
    Downloads,
    Follows,
    Updated,
    Newest,
}

/// Mirrors `ModProject` in `src/types/mod.ts`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModProject {
    pub provider: ProviderId,
    pub project_id: String,
    pub slug: String,
    pub name: String,
    pub summary: String,
    pub author: String,
    pub icon_url: Option<String>,
    pub downloads: u64,
    pub followers: Option<u64>,
    pub categories: Vec<String>,
    pub kind: ProjectKind,
    pub updated_at: Option<String>,
    pub license: Option<String>,
    /// Where to send people when a file cannot be fetched automatically.
    pub page_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModDependency {
    pub provider: ProviderId,
    pub project_id: String,
    pub version_id: Option<String>,
    pub kind: DependencyKind,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModVersion {
    pub provider: ProviderId,
    pub project_id: String,
    pub version_id: String,
    pub name: String,
    pub version_number: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub sha1: Option<String>,
    /// Empty when the author disallows third-party downloads (CurseForge).
    pub download_url: String,
    pub game_versions: Vec<String>,
    pub loaders: Vec<ModLoader>,
    pub release_type: ReleaseType,
    pub published_at: String,
    pub dependencies: Vec<ModDependency>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    pub provider: ProviderId,
    pub text: String,
    pub kind: ProjectKind,
    pub game_version: Option<String>,
    pub loader: Option<ModLoader>,
    #[serde(default)]
    pub categories: Vec<String>,
    pub sort: SortOrder,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub hits: Vec<ModProject>,
    pub total_hits: u64,
    pub offset: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    /// What the provider's search filter expects.
    pub id: String,
    pub name: String,
}

/// How a project's long description is written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BodyFormat {
    /// Modrinth: Markdown with inline HTML.
    Markdown,
    /// CurseForge: HTML.
    Html,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LinkKind {
    Page,
    Source,
    Issues,
    Wiki,
    Discord,
    Donation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLink {
    pub kind: LinkKind,
    /// Shown on the button: the donation platform, or empty for the
    /// standard kinds (the UI names those itself).
    pub label: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryImage {
    /// A thumbnail when the provider has one.
    pub url: String,
    pub full_url: String,
    pub title: Option<String>,
    pub description: Option<String>,
}

/// Everything the description view shows for one project.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetails {
    pub project: ModProject,
    pub body: String,
    pub body_format: BodyFormat,
    pub gallery: Vec<GalleryImage>,
    pub links: Vec<ProjectLink>,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub published_at: Option<String>,
}

/// What the confirmation dialog shows before a multi-file install.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedInstallPlan {
    pub primary: ModVersion,
    pub dependencies: Vec<ModVersion>,
    pub unresolved: Vec<ModDependency>,
    pub total_bytes: u64,
}

/// The Minecraft version and loaders a file must support to be installable
/// into a given instance.
#[derive(Debug, Clone)]
pub struct Target {
    pub mc_version: String,
    pub loaders: Vec<ModLoader>,
}

impl ProjectKind {
    /// The folder inside `.minecraft` this kind of content lives in.
    pub fn folder(self) -> &'static str {
        match self {
            ProjectKind::Mod => "mods",
            ProjectKind::ResourcePack => "resourcepacks",
            ProjectKind::Shader => "shaderpacks",
            ProjectKind::Modpack => "modpacks",
        }
    }

    /// Mods are jars; resource packs and shader packs are zips.
    pub fn extension(self) -> &'static str {
        match self {
            ProjectKind::Mod => ".jar",
            ProjectKind::ResourcePack | ProjectKind::Shader | ProjectKind::Modpack => ".zip",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            ProjectKind::Mod => "мод",
            ProjectKind::ResourcePack => "ресурспак",
            ProjectKind::Shader => "шейдер",
            ProjectKind::Modpack => "модпак",
        }
    }
}

impl Target {
    /// What content of `kind` must support to go into an instance. Only mods
    /// care about the loader; a resource pack or shader pack does not.
    pub fn for_content(mc_version: &str, loader: ModLoader, kind: ProjectKind) -> Self {
        match kind {
            ProjectKind::Mod => Self::for_instance(mc_version, loader),
            _ => Self {
                mc_version: mc_version.to_owned(),
                loaders: Vec::new(),
            },
        }
    }

    /// No constraints at all — used for modpacks, which define the instance
    /// instead of fitting into one.
    pub fn any() -> Self {
        Self {
            mc_version: String::new(),
            loaders: Vec::new(),
        }
    }

    /// Loaders whose mods run on the instance's loader: Quilt loads Fabric
    /// mods, and NeoForge for 1.20.1 still loads Forge mods.
    pub fn for_instance(mc_version: &str, loader: ModLoader) -> Self {
        let loaders = match loader {
            ModLoader::Quilt => vec![ModLoader::Quilt, ModLoader::Fabric],
            ModLoader::NeoForge if mc_version == "1.20.1" => {
                vec![ModLoader::NeoForge, ModLoader::Forge]
            }
            other => vec![other],
        };
        Self {
            mc_version: mc_version.to_owned(),
            loaders,
        }
    }

    /// An empty constraint accepts anything: no loaders means "loader does not
    /// matter", an empty Minecraft version means "any version".
    pub fn accepts(&self, version: &ModVersion) -> bool {
        let loader_ok = self.loaders.is_empty()
            || version.loaders.is_empty()
            || version.loaders.iter().any(|loader| self.loaders.contains(loader));
        let version_ok = self.mc_version.is_empty()
            || version.game_versions.iter().any(|v| v == &self.mc_version);
        loader_ok && version_ok
    }
}

/// The CurseForge key baked in at build time via FIRLAUNCHER_CURSEFORGE_KEY.
/// It never lives in the repository and is never sent to the frontend.
pub fn builtin_curseforge_key() -> Option<&'static str> {
    option_env!("FIRLAUNCHER_CURSEFORGE_KEY")
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

/// The key to use: the built-in one wins, so a release build cannot be
/// reconfigured; builds without it fall back to the key from settings.
pub fn curseforge_key(settings: &Settings) -> Option<String> {
    if let Some(key) = builtin_curseforge_key() {
        return Some(key.to_owned());
    }
    let configured = settings.curseforge_api_key.trim();
    (!configured.is_empty()).then(|| configured.to_owned())
}

/// The providers usable with the current settings, Modrinth first. CurseForge
/// needs an API key and stays out of the list without one.
pub fn providers(settings: &Settings, client: &reqwest::Client) -> Vec<Arc<dyn ModProvider>> {
    let mut list: Vec<Arc<dyn ModProvider>> =
        vec![Arc::new(modrinth::Modrinth::new(client.clone()))];
    if let Some(key) = curseforge_key(settings) {
        list.push(Arc::new(curseforge::CurseForge::new(client.clone(), &key)));
    }
    list
}

pub fn provider(
    settings: &Settings,
    client: &reqwest::Client,
    id: ProviderId,
) -> Result<Arc<dyn ModProvider>> {
    providers(settings, client)
        .into_iter()
        .find(|provider| provider.id() == id)
        .ok_or_else(|| {
            LauncherError::new(
                ErrorKind::Provider,
                format!(
                    "{} недоступен — для CurseForge укажите ключ API в настройках",
                    id.label()
                ),
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_curseforge_key_wins_over_settings() {
        let settings = Settings {
            curseforge_api_key: String::from("  from-settings  "),
            ..Settings::default()
        };
        let expected = builtin_curseforge_key().unwrap_or("from-settings");
        assert_eq!(curseforge_key(&settings).as_deref(), Some(expected));
        assert_eq!(
            curseforge_key(&Settings::default()).as_deref(),
            builtin_curseforge_key()
        );
    }

    fn version(loaders: Vec<ModLoader>, game: &str) -> ModVersion {
        ModVersion {
            provider: ProviderId::Modrinth,
            project_id: String::from("p"),
            version_id: String::from("v"),
            name: String::new(),
            version_number: String::new(),
            file_name: String::from("a.jar"),
            size_bytes: 1,
            sha1: None,
            download_url: String::from("https://x"),
            game_versions: vec![game.to_owned()],
            loaders,
            release_type: ReleaseType::Release,
            published_at: String::new(),
            dependencies: Vec::new(),
        }
    }

    #[test]
    fn quilt_instances_accept_fabric_mods() {
        let target = Target::for_instance("1.20.4", ModLoader::Quilt);
        assert!(target.accepts(&version(vec![ModLoader::Fabric], "1.20.4")));
        assert!(!target.accepts(&version(vec![ModLoader::Forge], "1.20.4")));
    }

    #[test]
    fn the_game_version_must_match_exactly() {
        let target = Target::for_instance("1.20.4", ModLoader::Fabric);
        assert!(!target.accepts(&version(vec![ModLoader::Fabric], "1.20.1")));
    }

    #[test]
    fn packs_ignore_the_loader_but_not_the_game_version() {
        let target = Target::for_content("1.20.4", ModLoader::Fabric, ProjectKind::ResourcePack);
        assert!(target.accepts(&version(vec![], "1.20.4")));
        assert!(target.accepts(&version(vec![ModLoader::Forge], "1.20.4")));
        assert!(!target.accepts(&version(vec![], "1.19.2")));
        assert!(Target::any().accepts(&version(vec![ModLoader::Forge], "1.7.10")));
    }

    #[test]
    fn neoforge_1_20_1_still_runs_forge_mods() {
        let target = Target::for_instance("1.20.1", ModLoader::NeoForge);
        assert!(target.accepts(&version(vec![ModLoader::Forge], "1.20.1")));
        let modern = Target::for_instance("1.21.1", ModLoader::NeoForge);
        assert!(!modern.accepts(&version(vec![ModLoader::Forge], "1.21.1")));
    }
}
