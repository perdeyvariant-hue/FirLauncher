//! CurseForge API v1. Needs a personal API key; without one the provider is
//! not offered at all.

use std::collections::HashMap;
use std::sync::OnceLock;

use serde::Deserialize;
use serde_json::json;

use crate::error::{ErrorKind, LauncherError, Result};
use crate::instances::ModLoader;

use super::provider::{BoxFuture, Http, ModProvider, RateLimiter};
use super::{
    BodyFormat, Category, DependencyKind, GalleryImage, LinkKind, ModDependency, ModProject,
    ModVersion, ProjectDetails, ProjectKind, ProjectLink, ProviderId, ReleaseType, SearchQuery,
    SearchResult, SortOrder, Target,
};

const API: &str = "https://api.curseforge.com/v1";
const MINECRAFT: u32 = 432;
/// CurseForge caps `index + pageSize` at 10 000.
const MAX_WINDOW: u32 = 10_000;

fn limiter() -> &'static RateLimiter {
    static LIMITER: OnceLock<RateLimiter> = OnceLock::new();
    LIMITER.get_or_init(|| RateLimiter::new(4.0, 8.0))
}

pub struct CurseForge {
    http: Http,
}

impl CurseForge {
    pub fn new(client: reqwest::Client, api_key: &str) -> Self {
        Self {
            http: Http {
                client,
                limiter: limiter(),
                api_key: Some(("x-api-key", api_key.to_owned())),
                name: "CurseForge",
            },
        }
    }
}

fn class_id(kind: ProjectKind) -> u32 {
    match kind {
        ProjectKind::Mod => 6,
        ProjectKind::Modpack => 4471,
        ProjectKind::ResourcePack => 12,
        ProjectKind::Shader => 6552,
    }
}

fn kind_of(class: Option<u32>) -> ProjectKind {
    match class {
        Some(4471) => ProjectKind::Modpack,
        Some(12) => ProjectKind::ResourcePack,
        Some(6552) => ProjectKind::Shader,
        _ => ProjectKind::Mod,
    }
}

pub(crate) fn loader_type(loader: ModLoader) -> Option<u32> {
    match loader {
        ModLoader::Forge => Some(1),
        ModLoader::Fabric => Some(4),
        ModLoader::Quilt => Some(5),
        ModLoader::NeoForge => Some(6),
        ModLoader::Vanilla => None,
    }
}

fn sort_field(sort: SortOrder) -> u32 {
    match sort {
        SortOrder::Relevance => 1,
        SortOrder::Downloads => 6,
        SortOrder::Follows => 2,
        SortOrder::Updated => 3,
        SortOrder::Newest => 11,
    }
}

#[derive(Debug, Deserialize)]
struct Envelope<T> {
    data: T,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pagination {
    index: u32,
    total_count: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchEnvelope {
    data: Vec<Mod>,
    pagination: Pagination,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Logo {
    thumbnail_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Author {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CategoryRef {
    id: u64,
    name: String,
    #[serde(default)]
    is_class: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Links {
    website_url: Option<String>,
    #[serde(default)]
    wiki_url: Option<String>,
    #[serde(default)]
    issues_url: Option<String>,
    #[serde(default)]
    source_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Screenshot {
    #[serde(default)]
    title: String,
    #[serde(default)]
    description: String,
    thumbnail_url: Option<String>,
    url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileIndex {
    game_version: String,
    mod_loader: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Mod {
    id: u64,
    name: String,
    slug: String,
    #[serde(default)]
    summary: String,
    /// A JSON number that can exceed what CurseForge itself writes as an
    /// integer, so it is read as a float.
    #[serde(default)]
    download_count: f64,
    logo: Option<Logo>,
    #[serde(default)]
    authors: Vec<Author>,
    #[serde(default)]
    categories: Vec<CategoryRef>,
    date_modified: Option<String>,
    links: Option<Links>,
    class_id: Option<u32>,
    #[serde(default)]
    screenshots: Vec<Screenshot>,
    #[serde(default)]
    latest_files_indexes: Vec<FileIndex>,
    date_released: Option<String>,
}

fn loader_label(loader: u32) -> Option<&'static str> {
    match loader {
        1 => Some("forge"),
        4 => Some("fabric"),
        5 => Some("quilt"),
        6 => Some("neoforge"),
        _ => None,
    }
}

impl Mod {
    fn into_details(mut self, body: String) -> ProjectDetails {
        let links = self.links.take();
        let screenshots = std::mem::take(&mut self.screenshots);
        let indexes = std::mem::take(&mut self.latest_files_indexes);
        let published_at = self.date_released.take();

        // Newest first, as CurseForge lists them; each only once.
        let mut game_versions: Vec<String> = Vec::new();
        let mut loaders: Vec<String> = Vec::new();
        for index in &indexes {
            if !game_versions.contains(&index.game_version) {
                game_versions.push(index.game_version.clone());
            }
            if let Some(label) = index.mod_loader.and_then(loader_label) {
                if !loaders.iter().any(|known| known == label) {
                    loaders.push(label.to_owned());
                }
            }
        }

        let mut out_links = Vec::new();
        if let Some(links) = links {
            for (kind, url) in [
                (LinkKind::Page, links.website_url),
                (LinkKind::Source, links.source_url),
                (LinkKind::Issues, links.issues_url),
                (LinkKind::Wiki, links.wiki_url),
            ] {
                if let Some(url) = url.filter(|url| !url.trim().is_empty()) {
                    out_links.push(ProjectLink { kind, label: String::new(), url });
                }
            }
        }

        let mut project = ModProject::from(self);
        project.page_url = out_links
            .iter()
            .find(|link| link.kind == LinkKind::Page)
            .map(|link| link.url.clone());

        ProjectDetails {
            project,
            body,
            body_format: BodyFormat::Html,
            gallery: screenshots
                .into_iter()
                .map(|shot| GalleryImage {
                    url: shot.thumbnail_url.unwrap_or_else(|| shot.url.clone()),
                    full_url: shot.url,
                    title: Some(shot.title).filter(|title| !title.is_empty()),
                    description: Some(shot.description).filter(|text| !text.is_empty()),
                })
                .collect(),
            links: out_links,
            game_versions,
            loaders,
            published_at,
        }
    }
}

#[derive(Debug, Deserialize)]
struct Hash {
    value: String,
    algo: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileDependency {
    mod_id: u64,
    relation_type: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct File {
    id: u64,
    mod_id: u64,
    display_name: String,
    file_name: String,
    release_type: u32,
    file_date: String,
    file_length: u64,
    /// Null when the author opted out of third-party distribution.
    download_url: Option<String>,
    #[serde(default)]
    game_versions: Vec<String>,
    #[serde(default)]
    hashes: Vec<Hash>,
    #[serde(default)]
    dependencies: Vec<FileDependency>,
}

impl From<Mod> for ModProject {
    fn from(item: Mod) -> Self {
        ModProject {
            provider: ProviderId::CurseForge,
            project_id: item.id.to_string(),
            slug: item.slug,
            name: item.name,
            summary: item.summary,
            author: item
                .authors
                .first()
                .map(|author| author.name.clone())
                .unwrap_or_default(),
            icon_url: item.logo.and_then(|logo| logo.thumbnail_url),
            // Saturating float-to-int: counts are never negative in practice.
            downloads: item.download_count.max(0.0) as u64,
            followers: None,
            categories: item
                .categories
                .into_iter()
                .filter(|category| category.is_class != Some(true))
                .map(|category| category.name)
                .collect(),
            kind: kind_of(item.class_id),
            updated_at: item.date_modified,
            license: None,
            page_url: item.links.and_then(|links| links.website_url),
        }
    }
}

fn parse_loader(tag: &str) -> Option<ModLoader> {
    match tag.to_ascii_lowercase().as_str() {
        "forge" => Some(ModLoader::Forge),
        "fabric" => Some(ModLoader::Fabric),
        "quilt" => Some(ModLoader::Quilt),
        "neoforge" => Some(ModLoader::NeoForge),
        _ => None,
    }
}

impl File {
    fn into_mod_version(self) -> ModVersion {
        let sha1 = self
            .hashes
            .iter()
            .find(|hash| hash.algo == 1)
            .map(|hash| hash.value.to_ascii_lowercase());
        // CurseForge mixes loaders, environments ("Client") and Minecraft
        // versions into one list; split them apart.
        let loaders: Vec<ModLoader> = self.game_versions.iter().filter_map(|tag| parse_loader(tag)).collect();
        let game_versions: Vec<String> = self
            .game_versions
            .iter()
            .filter(|tag| tag.chars().next().is_some_and(|c| c.is_ascii_digit()))
            .cloned()
            .collect();

        ModVersion {
            provider: ProviderId::CurseForge,
            project_id: self.mod_id.to_string(),
            version_id: self.id.to_string(),
            name: self.display_name.clone(),
            version_number: self.display_name,
            file_name: self.file_name,
            size_bytes: self.file_length,
            sha1,
            download_url: self.download_url.unwrap_or_default(),
            game_versions,
            loaders,
            release_type: match self.release_type {
                2 => ReleaseType::Beta,
                3 => ReleaseType::Alpha,
                _ => ReleaseType::Release,
            },
            published_at: self.file_date,
            dependencies: self
                .dependencies
                .into_iter()
                .filter_map(|dependency| {
                    let kind = match dependency.relation_type {
                        3 => DependencyKind::Required,
                        2 => DependencyKind::Optional,
                        5 => DependencyKind::Incompatible,
                        1 | 6 => DependencyKind::Embedded,
                        // 4 = "tool": not something a game instance needs.
                        _ => return None,
                    };
                    Some(ModDependency {
                        provider: ProviderId::CurseForge,
                        project_id: dependency.mod_id.to_string(),
                        version_id: None,
                        kind,
                        name: None,
                    })
                })
                .collect(),
        }
    }
}

fn parse_id(value: &str, what: &str) -> Result<u64> {
    value.parse().map_err(|_| {
        LauncherError::new(
            ErrorKind::Provider,
            format!("Некорректный идентификатор {what} CurseForge: {value}"),
        )
    })
}

/// What a modpack importer needs to know about a project.
#[derive(Debug, Clone)]
pub struct ProjectInfo {
    pub name: String,
    pub kind: ProjectKind,
    pub page_url: Option<String>,
}

impl CurseForge {
    /// Many files in one request — a modpack lists hundreds.
    pub async fn files_by_ids(&self, file_ids: &[u64]) -> Result<Vec<ModVersion>> {
        let mut out = Vec::with_capacity(file_ids.len());
        for chunk in file_ids.chunks(500) {
            let response: Envelope<Vec<File>> = self
                .http
                .post(&format!("{API}/mods/files"), &json!({ "fileIds": chunk }))
                .await?;
            out.extend(response.data.into_iter().map(File::into_mod_version));
        }
        Ok(out)
    }

    /// Names, content kind (mod, resource pack, shader) and page links.
    pub async fn project_info(&self, mod_ids: &[u64]) -> Result<HashMap<String, ProjectInfo>> {
        let mut out = HashMap::with_capacity(mod_ids.len());
        for chunk in mod_ids.chunks(500) {
            let response: Envelope<Vec<Mod>> = self
                .http
                .post(&format!("{API}/mods"), &json!({ "modIds": chunk }))
                .await?;
            for item in response.data {
                out.insert(
                    item.id.to_string(),
                    ProjectInfo {
                        kind: kind_of(item.class_id),
                        page_url: item.links.as_ref().and_then(|links| links.website_url.clone()),
                        name: item.name,
                    },
                );
            }
        }
        Ok(out)
    }
}

impl ModProvider for CurseForge {
    fn id(&self) -> ProviderId {
        ProviderId::CurseForge
    }

    fn search<'a>(&'a self, query: &'a SearchQuery) -> BoxFuture<'a, Result<SearchResult>> {
        Box::pin(async move {
            let page_size = query.limit.clamp(1, 50);
            let index = query.offset.min(MAX_WINDOW.saturating_sub(page_size));
            let mut params = vec![
                ("gameId", MINECRAFT.to_string()),
                ("classId", class_id(query.kind).to_string()),
                ("searchFilter", query.text.clone()),
                ("sortField", sort_field(query.sort).to_string()),
                ("sortOrder", String::from("desc")),
                ("index", index.to_string()),
                ("pageSize", page_size.to_string()),
            ];
            if let Some(version) = &query.game_version {
                params.push(("gameVersion", version.clone()));
            }
            // CurseForge filters by one loader; Quilt instances search Fabric's
            // catalogue too, so for them the filter is left open.
            if matches!(query.kind, ProjectKind::Mod | ProjectKind::Modpack) {
                if let Some(code) = query
                    .loader
                    .filter(|loader| *loader != ModLoader::Quilt)
                    .and_then(loader_type)
                {
                    params.push(("modLoaderType", code.to_string()));
                }
            }
            if let Some(category) = query.categories.first() {
                params.push(("categoryId", category.clone()));
            }

            let response: SearchEnvelope = self.http.get(&format!("{API}/mods/search"), &params).await?;
            Ok(SearchResult {
                hits: response.data.into_iter().map(ModProject::from).collect(),
                total_hits: response.pagination.total_count.min(u64::from(MAX_WINDOW)),
                offset: response.pagination.index,
            })
        })
    }

    fn details<'a>(&'a self, project_id: &'a str) -> BoxFuture<'a, Result<ProjectDetails>> {
        Box::pin(async move {
            let id = parse_id(project_id, "проекта")?;
            let item: Envelope<Mod> = self.http.get(&format!("{API}/mods/{id}"), &[]).await?;
            let body: Envelope<String> = self
                .http
                .get(&format!("{API}/mods/{id}/description"), &[])
                .await?;
            Ok(item.data.into_details(body.data))
        })
    }

    fn categories(&self, kind: ProjectKind) -> BoxFuture<'_, Result<Vec<Category>>> {
        Box::pin(async move {
            let response: Envelope<Vec<CategoryRef>> = self
                .http
                .get(
                    &format!("{API}/categories"),
                    &[
                        ("gameId", MINECRAFT.to_string()),
                        ("classId", class_id(kind).to_string()),
                    ],
                )
                .await?;
            let mut categories: Vec<Category> = response
                .data
                .into_iter()
                .filter(|category| category.is_class != Some(true))
                .map(|category| Category {
                    id: category.id.to_string(),
                    name: category.name,
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
            let mod_id = parse_id(project_id, "проекта")?;
            let mut params = vec![("pageSize", String::from("50"))];
            if !target.mc_version.is_empty() {
                params.push(("gameVersion", target.mc_version.clone()));
            }
            let response: Envelope<Vec<File>> = self
                .http
                .get(&format!("{API}/mods/{mod_id}/files"), &params)
                .await?;
            let mut versions: Vec<ModVersion> = response
                .data
                .into_iter()
                .map(File::into_mod_version)
                .filter(|version| target.accepts(version))
                .collect();
            // CurseForge does not promise an order; ISO dates sort as text.
            versions.sort_by(|a, b| b.published_at.cmp(&a.published_at));
            Ok(versions)
        })
    }

    fn version<'a>(
        &'a self,
        project_id: &'a str,
        version_id: &'a str,
    ) -> BoxFuture<'a, Result<ModVersion>> {
        Box::pin(async move {
            let mod_id = parse_id(project_id, "проекта")?;
            let file_id = parse_id(version_id, "файла")?;
            let response: Envelope<File> = self
                .http
                .get(&format!("{API}/mods/{mod_id}/files/{file_id}"), &[])
                .await?;
            Ok(response.data.into_mod_version())
        })
    }

    fn project_names<'a>(
        &'a self,
        ids: &'a [String],
    ) -> BoxFuture<'a, Result<HashMap<String, String>>> {
        Box::pin(async move {
            let numeric: Vec<u64> = ids.iter().filter_map(|id| id.parse().ok()).collect();
            if numeric.is_empty() {
                return Ok(HashMap::new());
            }
            let response: Envelope<Vec<Mod>> = self
                .http
                .post(&format!("{API}/mods"), &json!({ "modIds": numeric }))
                .await?;
            Ok(response
                .data
                .into_iter()
                .map(|item| (item.id.to_string(), item.name))
                .collect())
        })
    }

    /// CurseForge identifies files by a Murmur2 fingerprint, not SHA1, so
    /// only files the launcher installed itself (recorded in the instance's
    /// mod index) are tracked for CurseForge.
    fn identify<'a>(
        &'a self,
        _sha1s: &'a [String],
    ) -> BoxFuture<'a, Result<HashMap<String, ModVersion>>> {
        Box::pin(async { Ok(HashMap::new()) })
    }

    fn latest_for<'a>(
        &'a self,
        _sha1s: &'a [String],
        _target: &'a Target,
    ) -> BoxFuture<'a, Result<HashMap<String, ModVersion>>> {
        Box::pin(async { Ok(HashMap::new()) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_mod_becomes_a_description_page() -> std::result::Result<(), serde_json::Error> {
        let item: Mod = serde_json::from_str(
            r#"{
                "id": 238222, "name": "JEI", "slug": "jei", "summary": "Items",
                "downloadCount": 5.0, "logo": {"thumbnailUrl": "https://img/logo.png"},
                "authors": [{"name": "mezz"}], "categories": [], "classId": 6,
                "links": {"websiteUrl": "https://www.curseforge.com/minecraft/mc-mods/jei",
                          "wikiUrl": "", "issuesUrl": "https://github.com/mezz/JEI/issues",
                          "sourceUrl": null},
                "screenshots": [{"title": "Shot", "description": "", "thumbnailUrl": "https://img/t.png",
                                 "url": "https://img/full.png"}],
                "latestFilesIndexes": [
                    {"gameVersion": "1.21.1", "modLoader": 6},
                    {"gameVersion": "1.21.1", "modLoader": 1},
                    {"gameVersion": "1.20.1", "modLoader": 1},
                    {"gameVersion": "1.12.2", "modLoader": null}
                ],
                "dateReleased": "2015-01-01T00:00:00Z"
            }"#,
        )?;
        let details = item.into_details(String::from("<p>Hi</p>"));

        assert_eq!(details.project.author, "mezz");
        assert_eq!(details.body_format, BodyFormat::Html);
        assert_eq!(
            details.project.page_url.as_deref(),
            Some("https://www.curseforge.com/minecraft/mc-mods/jei")
        );
        let kinds: Vec<LinkKind> = details.links.iter().map(|link| link.kind).collect();
        assert_eq!(kinds, vec![LinkKind::Page, LinkKind::Issues]);
        assert_eq!(details.game_versions, vec!["1.21.1", "1.20.1", "1.12.2"]);
        assert_eq!(details.loaders, vec!["neoforge", "forge"]);
        assert_eq!(details.gallery[0].url, "https://img/t.png");
        assert_eq!(details.gallery[0].full_url, "https://img/full.png");
        assert_eq!(details.published_at.as_deref(), Some("2015-01-01T00:00:00Z"));
        Ok(())
    }

    const FILE: &str = r#"{
        "id": 5101366, "modId": 238222, "displayName": "jei-1.20.1-forge-15.3.0.4.jar",
        "fileName": "jei-1.20.1-forge-15.3.0.4.jar", "releaseType": 1,
        "fileDate": "2024-03-01T12:00:00Z", "fileLength": 1400000,
        "downloadUrl": "https://edge.forgecdn.net/files/5101/366/jei-1.20.1-forge-15.3.0.4.jar",
        "gameVersions": ["Forge", "1.20.1", "Client", "NeoForge"],
        "hashes": [{"value": "ABCDEF0123", "algo": 1}, {"value": "md5md5", "algo": 2}],
        "dependencies": [{"modId": 1, "relationType": 3}, {"modId": 2, "relationType": 4},
                         {"modId": 3, "relationType": 2}]
    }"#;

    fn file() -> File {
        match serde_json::from_str(FILE) {
            Ok(file) => file,
            Err(error) => panic!("fixture: {error}"),
        }
    }

    #[test]
    fn files_split_loaders_from_game_versions() {
        let version = file().into_mod_version();
        assert_eq!(version.loaders, vec![ModLoader::Forge, ModLoader::NeoForge]);
        assert_eq!(version.game_versions, vec!["1.20.1"]);
        assert_eq!(version.sha1.as_deref(), Some("abcdef0123"));
        assert_eq!(version.project_id, "238222");
        assert_eq!(version.version_id, "5101366");
    }

    #[test]
    fn dependency_relations_map_and_tools_are_dropped() {
        let deps = file().into_mod_version().dependencies;
        assert_eq!(deps.len(), 2);
        assert_eq!(deps[0].kind, DependencyKind::Required);
        assert_eq!(deps[1].kind, DependencyKind::Optional);
    }

    #[test]
    fn an_opted_out_file_has_no_download_url() -> std::result::Result<(), serde_json::Error> {
        // The author disabled third-party distribution: no URL is invented.
        let blocked: File = serde_json::from_str(&FILE.replace(
            "\"https://edge.forgecdn.net/files/5101/366/jei-1.20.1-forge-15.3.0.4.jar\"",
            "null",
        ))?;
        assert!(blocked.into_mod_version().download_url.is_empty());
        Ok(())
    }

    #[test]
    fn search_results_map_to_projects() -> std::result::Result<(), serde_json::Error> {
        let envelope: SearchEnvelope = serde_json::from_str(
            r#"{"data": [{"id": 238222, "name": "Just Enough Items", "slug": "jei",
                "summary": "View items and recipes", "downloadCount": 312345678.0,
                "logo": {"thumbnailUrl": "https://media.forgecdn.net/avatars/thumbnails/1.png"},
                "authors": [{"name": "mezz"}],
                "categories": [{"id": 6, "name": "Mods", "isClass": true},
                               {"id": 423, "name": "Map and Information"}],
                "dateModified": "2024-03-01T12:00:00Z",
                "links": {"websiteUrl": "https://www.curseforge.com/minecraft/mc-mods/jei"},
                "classId": 6}],
               "pagination": {"index": 0, "pageSize": 20, "resultCount": 1, "totalCount": 1}}"#,
        )?;
        let project = ModProject::from(envelope.data.into_iter().next().unwrap_or_else(|| panic!("empty")));
        assert_eq!(project.downloads, 312_345_678);
        assert_eq!(project.author, "mezz");
        // The class ("Mods") is not a category chip.
        assert_eq!(project.categories, vec!["Map and Information"]);
        assert_eq!(project.kind, ProjectKind::Mod);
        assert!(project.page_url.is_some());
        Ok(())
    }
}
