//! Modrinth API v2.

use std::collections::HashMap;
use std::sync::OnceLock;

use serde::Deserialize;
use serde_json::json;

use crate::error::{ErrorKind, LauncherError, Result};
use crate::instances::ModLoader;

use super::provider::{BoxFuture, Http, ModProvider, RateLimiter};
use super::{
    Category, DependencyKind, ModDependency, ModProject, ModVersion, ProjectKind, ProviderId,
    ReleaseType, SearchQuery, SearchResult, SortOrder, Target,
};

const API: &str = "https://api.modrinth.com/v2";

/// Modrinth allows 300 requests a minute; stay comfortably inside it.
fn limiter() -> &'static RateLimiter {
    static LIMITER: OnceLock<RateLimiter> = OnceLock::new();
    LIMITER.get_or_init(|| RateLimiter::new(4.0, 10.0))
}

/// Tags Modrinth files under `categories` that are really loaders or
/// platforms; they are filters, not something to show as a category chip.
const NON_CATEGORY_TAGS: &[&str] = &[
    "fabric", "quilt", "forge", "neoforge", "liteloader", "modloader", "rift", "minecraft",
    "datapack", "iris", "optifine", "canvas", "vanilla", "bukkit", "spigot", "paper",
    "purpur", "folia", "sponge", "bungeecord", "velocity", "waterfall",
];

pub struct Modrinth {
    http: Http,
}

impl Modrinth {
    pub fn new(client: reqwest::Client) -> Self {
        Self {
            http: Http {
                client,
                limiter: limiter(),
                api_key: None,
                name: "Modrinth",
            },
        }
    }
}

#[derive(Debug, Deserialize)]
struct Hit {
    project_id: String,
    slug: String,
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    author: String,
    icon_url: Option<String>,
    #[serde(default)]
    downloads: u64,
    follows: Option<u64>,
    #[serde(default)]
    display_categories: Vec<String>,
    #[serde(default)]
    categories: Vec<String>,
    project_type: String,
    date_modified: Option<String>,
    license: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    hits: Vec<Hit>,
    total_hits: u64,
    offset: u32,
}

#[derive(Debug, Deserialize)]
struct FileHashes {
    sha1: Option<String>,
}

#[derive(Debug, Deserialize)]
struct File {
    hashes: FileHashes,
    url: String,
    filename: String,
    #[serde(default)]
    primary: bool,
    size: u64,
}

#[derive(Debug, Deserialize)]
struct Dependency {
    version_id: Option<String>,
    project_id: Option<String>,
    dependency_type: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct Version {
    id: String,
    project_id: String,
    name: String,
    version_number: String,
    version_type: String,
    date_published: String,
    #[serde(default)]
    loaders: Vec<String>,
    #[serde(default)]
    game_versions: Vec<String>,
    files: Vec<File>,
    #[serde(default)]
    dependencies: Vec<Dependency>,
}

#[derive(Debug, Deserialize)]
struct Project {
    id: String,
    title: String,
}

#[derive(Debug, Deserialize)]
struct Tag {
    name: String,
    project_type: String,
    header: String,
}

fn kind_of(project_type: &str) -> ProjectKind {
    match project_type {
        "modpack" => ProjectKind::Modpack,
        "resourcepack" => ProjectKind::ResourcePack,
        "shader" => ProjectKind::Shader,
        _ => ProjectKind::Mod,
    }
}

fn kind_facet(kind: ProjectKind) -> &'static str {
    match kind {
        ProjectKind::Mod => "mod",
        ProjectKind::Modpack => "modpack",
        ProjectKind::ResourcePack => "resourcepack",
        ProjectKind::Shader => "shader",
    }
}

pub(crate) fn loader_name(loader: ModLoader) -> &'static str {
    match loader {
        ModLoader::Vanilla => "minecraft",
        ModLoader::Fabric => "fabric",
        ModLoader::Quilt => "quilt",
        ModLoader::Forge => "forge",
        ModLoader::NeoForge => "neoforge",
    }
}

fn parse_loader(name: &str) -> Option<ModLoader> {
    match name {
        "fabric" => Some(ModLoader::Fabric),
        "quilt" => Some(ModLoader::Quilt),
        "forge" => Some(ModLoader::Forge),
        "neoforge" => Some(ModLoader::NeoForge),
        _ => None,
    }
}

impl From<Hit> for ModProject {
    fn from(hit: Hit) -> Self {
        let tags = if hit.display_categories.is_empty() {
            hit.categories
        } else {
            hit.display_categories
        };
        let kind = kind_of(&hit.project_type);
        let page_url = Some(format!(
            "https://modrinth.com/{}/{}",
            kind_facet(kind),
            hit.slug
        ));
        ModProject {
            provider: ProviderId::Modrinth,
            project_id: hit.project_id,
            slug: hit.slug,
            name: hit.title,
            summary: hit.description,
            author: hit.author,
            icon_url: hit.icon_url.filter(|url| !url.is_empty()),
            downloads: hit.downloads,
            followers: hit.follows,
            categories: tags
                .into_iter()
                .filter(|tag| !NON_CATEGORY_TAGS.contains(&tag.as_str()))
                .collect(),
            kind,
            updated_at: hit.date_modified,
            license: hit.license,
            page_url,
        }
    }
}

impl Version {
    pub(crate) fn into_mod_version(self) -> Result<ModVersion> {
        // Modrinth marks one file primary; older versions sometimes forget.
        let primary_index = self.files.iter().position(|file| file.primary).unwrap_or(0);
        let file = self.files.into_iter().nth(primary_index).ok_or_else(|| {
            LauncherError::new(ErrorKind::Provider, "У версии мода нет файлов")
        })?;
        Ok(ModVersion {
            provider: ProviderId::Modrinth,
            project_id: self.project_id,
            version_id: self.id,
            name: self.name,
            version_number: self.version_number,
            file_name: file.filename,
            size_bytes: file.size,
            sha1: file.hashes.sha1,
            download_url: file.url,
            game_versions: self.game_versions,
            loaders: self.loaders.iter().filter_map(|l| parse_loader(l)).collect(),
            release_type: match self.version_type.as_str() {
                "beta" => ReleaseType::Beta,
                "alpha" => ReleaseType::Alpha,
                _ => ReleaseType::Release,
            },
            published_at: self.date_published,
            dependencies: self
                .dependencies
                .into_iter()
                .filter_map(|dependency| {
                    // Dependencies that name only a file cannot be resolved.
                    let project_id = dependency.project_id?;
                    Some(ModDependency {
                        provider: ProviderId::Modrinth,
                        project_id,
                        version_id: dependency.version_id,
                        kind: match dependency.dependency_type.as_str() {
                            "required" => DependencyKind::Required,
                            "incompatible" => DependencyKind::Incompatible,
                            "embedded" => DependencyKind::Embedded,
                            _ => DependencyKind::Optional,
                        },
                        name: None,
                    })
                })
                .collect(),
        })
    }
}

/// Modrinth facets: an AND of ORs, JSON-encoded into one query parameter.
pub(crate) fn build_facets(query: &SearchQuery, loaders: &[ModLoader]) -> String {
    let mut facets: Vec<Vec<String>> = vec![vec![format!("project_type:{}", kind_facet(query.kind))]];
    if let Some(version) = &query.game_version {
        facets.push(vec![format!("versions:{version}")]);
    }
    if !loaders.is_empty() {
        facets.push(
            loaders
                .iter()
                .map(|loader| format!("categories:{}", loader_name(*loader)))
                .collect(),
        );
    }
    for category in &query.categories {
        facets.push(vec![format!("categories:{category}")]);
    }
    serde_json::to_string(&facets).unwrap_or_else(|_| String::from("[]"))
}

fn sort_index(sort: SortOrder) -> &'static str {
    match sort {
        SortOrder::Relevance => "relevance",
        SortOrder::Downloads => "downloads",
        SortOrder::Follows => "follows",
        SortOrder::Updated => "updated",
        SortOrder::Newest => "newest",
    }
}

impl ModProvider for Modrinth {
    fn id(&self) -> ProviderId {
        ProviderId::Modrinth
    }

    fn search<'a>(&'a self, query: &'a SearchQuery) -> BoxFuture<'a, Result<SearchResult>> {
        Box::pin(async move {
            // Loader facets only mean something for mods and modpacks.
            let loaders = match (query.loader, query.kind) {
                (Some(loader), ProjectKind::Mod | ProjectKind::Modpack)
                    if loader != ModLoader::Vanilla =>
                {
                    Target::for_instance(query.game_version.as_deref().unwrap_or(""), loader).loaders
                }
                _ => Vec::new(),
            };
            let response: SearchResponse = self
                .http
                .get(
                    &format!("{API}/search"),
                    &[
                        ("query", query.text.clone()),
                        ("facets", build_facets(query, &loaders)),
                        ("index", sort_index(query.sort).to_owned()),
                        ("offset", query.offset.to_string()),
                        ("limit", query.limit.clamp(1, 100).to_string()),
                    ],
                )
                .await?;
            Ok(SearchResult {
                hits: response.hits.into_iter().map(ModProject::from).collect(),
                total_hits: response.total_hits,
                offset: response.offset,
            })
        })
    }

    fn categories(&self, kind: ProjectKind) -> BoxFuture<'_, Result<Vec<Category>>> {
        Box::pin(async move {
            let tags: Vec<Tag> = self.http.get(&format!("{API}/tag/category"), &[]).await?;
            let wanted = kind_facet(kind);
            let mut categories: Vec<Category> = tags
                .into_iter()
                .filter(|tag| tag.project_type == wanted && tag.header == "categories")
                .map(|tag| Category {
                    name: humanize(&tag.name),
                    id: tag.name,
                })
                .collect();
            categories.sort_by(|a, b| a.name.cmp(&b.name));
            Ok(categories)
        })
    }

    fn versions<'a>(
        &'a self,
        project_id: &'a str,
        target: &'a Target,
    ) -> BoxFuture<'a, Result<Vec<ModVersion>>> {
        Box::pin(async move {
            // Resource packs and shaders are published under their own
            // "loaders" (minecraft, iris, optifine), so an empty target means
            // "do not filter" rather than "match nothing".
            let mut params = Vec::new();
            if !target.loaders.is_empty() {
                let loaders: Vec<&str> = target.loaders.iter().map(|l| loader_name(*l)).collect();
                params.push(("loaders", json!(loaders).to_string()));
            }
            if !target.mc_version.is_empty() {
                params.push(("game_versions", json!([target.mc_version]).to_string()));
            }
            let versions: Vec<Version> = self
                .http
                .get(&format!("{API}/project/{project_id}/version"), &params)
                .await?;
            // Modrinth already sorts newest first.
            versions.into_iter().map(Version::into_mod_version).collect()
        })
    }

    fn version<'a>(
        &'a self,
        _project_id: &'a str,
        version_id: &'a str,
    ) -> BoxFuture<'a, Result<ModVersion>> {
        Box::pin(async move {
            let version: Version = self.http.get(&format!("{API}/version/{version_id}"), &[]).await?;
            version.into_mod_version()
        })
    }

    fn project_names<'a>(
        &'a self,
        ids: &'a [String],
    ) -> BoxFuture<'a, Result<HashMap<String, String>>> {
        Box::pin(async move {
            if ids.is_empty() {
                return Ok(HashMap::new());
            }
            let projects: Vec<Project> = self
                .http
                .get(&format!("{API}/projects"), &[("ids", json!(ids).to_string())])
                .await?;
            Ok(projects.into_iter().map(|p| (p.id, p.title)).collect())
        })
    }

    fn identify<'a>(
        &'a self,
        sha1s: &'a [String],
    ) -> BoxFuture<'a, Result<HashMap<String, ModVersion>>> {
        Box::pin(async move {
            if sha1s.is_empty() {
                return Ok(HashMap::new());
            }
            let found: HashMap<String, Version> = self
                .http
                .post(
                    &format!("{API}/version_files"),
                    &json!({ "hashes": sha1s, "algorithm": "sha1" }),
                )
                .await?;
            convert_map(found)
        })
    }

    fn latest_for<'a>(
        &'a self,
        sha1s: &'a [String],
        target: &'a Target,
    ) -> BoxFuture<'a, Result<HashMap<String, ModVersion>>> {
        Box::pin(async move {
            if sha1s.is_empty() {
                return Ok(HashMap::new());
            }
            let loaders: Vec<&str> = target.loaders.iter().map(|l| loader_name(*l)).collect();
            let found: HashMap<String, Version> = self
                .http
                .post(
                    &format!("{API}/version_files/update"),
                    &json!({
                        "hashes": sha1s,
                        "algorithm": "sha1",
                        "loaders": loaders,
                        "game_versions": [target.mc_version],
                    }),
                )
                .await?;
            convert_map(found)
        })
    }
}

fn convert_map(found: HashMap<String, Version>) -> Result<HashMap<String, ModVersion>> {
    found
        .into_iter()
        .map(|(hash, version)| Ok((hash, version.into_mod_version()?)))
        .collect()
}

/// `game-mechanics` -> `Game mechanics`.
fn humanize(slug: &str) -> String {
    let spaced = slug.replace('-', " ");
    let mut chars = spaced.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query() -> SearchQuery {
        SearchQuery {
            provider: ProviderId::Modrinth,
            text: String::from("sodium"),
            kind: ProjectKind::Mod,
            game_version: Some(String::from("1.20.4")),
            loader: Some(ModLoader::Quilt),
            categories: vec![String::from("optimization")],
            sort: SortOrder::Relevance,
            offset: 0,
            limit: 20,
        }
    }

    #[test]
    fn facets_are_an_and_of_ors() {
        let facets = build_facets(&query(), &[ModLoader::Quilt, ModLoader::Fabric]);
        assert_eq!(
            facets,
            r#"[["project_type:mod"],["versions:1.20.4"],["categories:quilt","categories:fabric"],["categories:optimization"]]"#
        );
    }

    #[test]
    fn loader_tags_are_not_shown_as_categories() -> std::result::Result<(), serde_json::Error> {
        let hit: Hit = serde_json::from_str(
            r#"{"project_id":"AANobbMI","slug":"sodium","title":"Sodium","description":"Fast",
                "author":"jellysquid3","icon_url":"https://cdn.modrinth.com/x.webp","downloads":5,
                "follows":2,"display_categories":["fabric","neoforge","optimization","quilt"],
                "project_type":"mod","date_modified":"2026-09-20T21:27:06Z","license":"MIT"}"#,
        )?;
        let project = ModProject::from(hit);
        assert_eq!(project.categories, vec!["optimization"]);
        assert_eq!(project.page_url.as_deref(), Some("https://modrinth.com/mod/sodium"));
        Ok(())
    }

    #[test]
    fn the_primary_file_is_chosen() -> Result<()> {
        let version: Version = serde_json::from_str(
            r#"{"id":"v","project_id":"p","name":"n","version_number":"1","version_type":"beta",
                "date_published":"2024-01-01","loaders":["fabric","iris"],"game_versions":["1.20.4"],
                "files":[{"hashes":{"sha1":"aaa"},"url":"https://x/sources.jar","filename":"s.jar","primary":false,"size":1},
                         {"hashes":{"sha1":"bbb"},"url":"https://x/main.jar","filename":"m.jar","primary":true,"size":2}],
                "dependencies":[{"version_id":null,"project_id":"P7dR8mSH","file_name":null,"dependency_type":"required"},
                                {"version_id":null,"project_id":null,"file_name":"x.jar","dependency_type":"required"}]}"#,
        )?;
        let version = version.into_mod_version()?;
        assert_eq!(version.file_name, "m.jar");
        assert_eq!(version.sha1.as_deref(), Some("bbb"));
        assert_eq!(version.release_type, ReleaseType::Beta);
        // Unknown loaders ("iris") are dropped; file-only dependencies too.
        assert_eq!(version.loaders, vec![ModLoader::Fabric]);
        assert_eq!(version.dependencies.len(), 1);
        Ok(())
    }
}
