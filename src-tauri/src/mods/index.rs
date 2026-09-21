//! `instances/<id>/mods.json` (and `resourcepacks.json`, `shaderpacks.json`):
//! which provider project each file came from. It powers the source badge, update checks and "already
//! installed" in the browser. Files dropped in by hand are not in it until an
//! update check identifies them by hash.

use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::config::{read_json_opt, write_json_atomic};
use crate::error::Result;
use crate::paths::Paths;

use super::{ModVersion, ProjectKind, ProviderId};

pub const DISABLED_SUFFIX: &str = ".disabled";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexEntry {
    pub provider: ProviderId,
    pub project_id: String,
    pub version_id: String,
    pub version_number: String,
    pub sha1: Option<String>,
}

impl From<&ModVersion> for IndexEntry {
    fn from(version: &ModVersion) -> Self {
        Self {
            provider: version.provider,
            project_id: version.project_id.clone(),
            version_id: version.version_id.clone(),
            version_number: version.version_number.clone(),
            sha1: version.sha1.clone(),
        }
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct ModIndex {
    /// Keyed by file name without the `.disabled` suffix, so toggling a mod
    /// does not lose track of where it came from.
    #[serde(default)]
    pub files: BTreeMap<String, IndexEntry>,
}

fn index_path(paths: &Paths, instance_id: &str, kind: ProjectKind) -> PathBuf {
    paths.instance(instance_id).join(format!("{}.json", kind.folder()))
}

pub fn key(file_name: &str) -> &str {
    file_name.strip_suffix(DISABLED_SUFFIX).unwrap_or(file_name)
}

impl ModIndex {
    pub async fn load(paths: &Paths, instance_id: &str, kind: ProjectKind) -> Result<Self> {
        Ok(read_json_opt(&index_path(paths, instance_id, kind))
            .await?
            .unwrap_or_default())
    }

    pub async fn save(&self, paths: &Paths, instance_id: &str, kind: ProjectKind) -> Result<()> {
        write_json_atomic(&index_path(paths, instance_id, kind), self).await
    }

    pub fn get(&self, file_name: &str) -> Option<&IndexEntry> {
        self.files.get(key(file_name))
    }

    pub fn insert(&mut self, file_name: &str, entry: IndexEntry) {
        self.files.insert(key(file_name).to_owned(), entry);
    }

    pub fn remove(&mut self, file_name: &str) {
        self.files.remove(key(file_name));
    }

    /// File currently holding a project, if any (without `.disabled`).
    pub fn file_of(&self, provider: ProviderId, project_id: &str) -> Option<String> {
        self.files
            .iter()
            .find(|(_, entry)| entry.provider == provider && entry.project_id == project_id)
            .map(|(file, _)| file.clone())
    }

    pub fn projects(&self, provider: ProviderId) -> HashSet<String> {
        self.files
            .values()
            .filter(|entry| entry.provider == provider)
            .map(|entry| entry.project_id.clone())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(project: &str) -> IndexEntry {
        IndexEntry {
            provider: ProviderId::Modrinth,
            project_id: project.to_owned(),
            version_id: String::from("v1"),
            version_number: String::from("1.0"),
            sha1: None,
        }
    }

    #[test]
    fn disabling_a_mod_keeps_its_source() {
        let mut index = ModIndex::default();
        index.insert("sodium.jar", entry("AANobbMI"));
        assert!(index.get("sodium.jar.disabled").is_some());
        assert_eq!(
            index.file_of(ProviderId::Modrinth, "AANobbMI").as_deref(),
            Some("sodium.jar")
        );
        index.remove("sodium.jar.disabled");
        assert!(index.files.is_empty());
    }

    #[test]
    fn projects_are_grouped_by_provider() {
        let mut index = ModIndex::default();
        index.insert("a.jar", entry("A"));
        index.insert(
            "b.jar",
            IndexEntry {
                provider: ProviderId::CurseForge,
                ..entry("238222")
            },
        );
        assert_eq!(index.projects(ProviderId::Modrinth).len(), 1);
        assert!(index.projects(ProviderId::CurseForge).contains("238222"));
    }
}
