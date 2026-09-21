//! The version JSON model and the `inheritsFrom` merge.
//!
//! Mod loaders ship a thin profile that inherits from the vanilla one; getting
//! the merge right (library order, argument append order, which fields the
//! child may override) is what makes Fabric/Quilt/Forge launch at all.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::rules::Rule;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Artifact {
    /// Relative path inside `libraries/`. Absent for the client jar.
    pub path: Option<String>,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub url: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Downloads {
    pub client: Option<Artifact>,
    pub server: Option<Artifact>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetIndexRef {
    pub id: String,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub total_size: Option<u64>,
    pub url: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LibraryDownloads {
    pub artifact: Option<Artifact>,
    /// Pre-1.19 natives live here, keyed by the `natives` map value.
    pub classifiers: Option<HashMap<String, Artifact>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Extract {
    #[serde(default)]
    pub exclude: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Library {
    /// Maven coordinates: `group:artifact:version[:classifier]`.
    pub name: String,
    pub downloads: Option<LibraryDownloads>,
    /// Maven root used by loader profiles that omit `downloads`.
    pub url: Option<String>,
    /// Fabric and Quilt put the hash and size on the library itself rather
    /// than under `downloads.artifact`.
    #[serde(default)]
    pub sha1: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
    pub natives: Option<HashMap<String, String>>,
    pub extract: Option<Extract>,
    #[serde(default)]
    pub rules: Vec<Rule>,
}

impl Library {
    /// `group:artifact`, the identity used when a child profile overrides a
    /// parent library with a different version.
    pub fn coordinate_key(&self) -> String {
        let mut parts = self.name.split(':');
        let group = parts.next().unwrap_or_default();
        let artifact = parts.next().unwrap_or_default();
        format!("{group}:{artifact}")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ArgValue {
    Single(String),
    Many(Vec<String>),
}

impl ArgValue {
    pub fn into_vec(self) -> Vec<String> {
        match self {
            ArgValue::Single(value) => vec![value],
            ArgValue::Many(values) => values,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Argument {
    Plain(String),
    Conditional {
        #[serde(default)]
        rules: Vec<Rule>,
        value: ArgValue,
    },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Arguments {
    #[serde(default)]
    pub game: Vec<Argument>,
    #[serde(default)]
    pub jvm: Vec<Argument>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaVersion {
    pub component: Option<String>,
    pub major_version: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionJson {
    pub id: String,
    pub inherits_from: Option<String>,
    pub main_class: Option<String>,
    #[serde(rename = "type")]
    pub version_type: Option<String>,
    pub asset_index: Option<AssetIndexRef>,
    /// Legacy field naming the asset index; `assetIndex` supersedes it.
    pub assets: Option<String>,
    pub downloads: Option<Downloads>,
    #[serde(default)]
    pub libraries: Vec<Library>,
    pub arguments: Option<Arguments>,
    /// Pre-1.13 single-string game arguments.
    pub minecraft_arguments: Option<String>,
    pub java_version: Option<JavaVersion>,
    pub release_time: Option<String>,
}

impl VersionJson {
    /// Folds a child profile onto the parent it declares via `inheritsFrom`.
    ///
    /// Library order matters: the child's entries go first so a loader can
    /// shadow a vanilla library, and a `group:artifact` present in the child
    /// removes the parent's copy entirely rather than putting both on the
    /// classpath.
    pub fn merge_onto(child: &VersionJson, parent: &VersionJson) -> VersionJson {
        let child_keys: std::collections::HashSet<String> = child
            .libraries
            .iter()
            .map(Library::coordinate_key)
            .collect();

        let mut libraries = child.libraries.clone();
        libraries.extend(
            parent
                .libraries
                .iter()
                .filter(|library| !child_keys.contains(&library.coordinate_key()))
                .cloned(),
        );

        let arguments = match (&parent.arguments, &child.arguments) {
            (None, None) => None,
            (Some(base), None) => Some(base.clone()),
            (None, Some(extra)) => Some(extra.clone()),
            (Some(base), Some(extra)) => {
                let mut merged = base.clone();
                merged.game.extend(extra.game.iter().cloned());
                merged.jvm.extend(extra.jvm.iter().cloned());
                Some(merged)
            }
        };

        VersionJson {
            id: child.id.clone(),
            inherits_from: None,
            main_class: child.main_class.clone().or_else(|| parent.main_class.clone()),
            version_type: child
                .version_type
                .clone()
                .or_else(|| parent.version_type.clone()),
            asset_index: child
                .asset_index
                .clone()
                .or_else(|| parent.asset_index.clone()),
            assets: child.assets.clone().or_else(|| parent.assets.clone()),
            downloads: child.downloads.clone().or_else(|| parent.downloads.clone()),
            libraries,
            arguments,
            minecraft_arguments: child
                .minecraft_arguments
                .clone()
                .or_else(|| parent.minecraft_arguments.clone()),
            java_version: child
                .java_version
                .clone()
                .or_else(|| parent.java_version.clone()),
            release_time: child
                .release_time
                .clone()
                .or_else(|| parent.release_time.clone()),
        }
    }

    /// Java major version this profile asks for, with the historical defaults
    /// for versions released before Mojang started declaring one.
    pub fn required_java_major(&self) -> u32 {
        self.java_version
            .as_ref()
            .map_or(8, |java| java.major_version)
    }

    pub fn asset_index_id(&self) -> String {
        self.asset_index
            .as_ref()
            .map(|index| index.id.clone())
            .or_else(|| self.assets.clone())
            .unwrap_or_else(|| String::from("legacy"))
    }
}

/// Turns `group:artifact:version[:classifier]` into a repository path.
pub fn maven_path(coordinate: &str) -> Option<String> {
    let mut sections = coordinate.split('@');
    let coordinate = sections.next()?;
    let extension = sections.next().unwrap_or("jar");

    let parts: Vec<&str> = coordinate.split(':').collect();
    let group = parts.first()?.replace('.', "/");
    let artifact = parts.get(1)?;
    let version = parts.get(2)?;
    let classifier = parts.get(3);

    let file = match classifier {
        Some(classifier) => format!("{artifact}-{version}-{classifier}.{extension}"),
        None => format!("{artifact}-{version}.{extension}"),
    };
    Some(format!("{group}/{artifact}/{version}/{file}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maven_coordinates_become_repository_paths() {
        assert_eq!(
            maven_path("net.fabricmc:fabric-loader:0.16.9").as_deref(),
            Some("net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar")
        );
        assert_eq!(
            maven_path("org.lwjgl:lwjgl:3.3.3:natives-windows").as_deref(),
            Some("org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar")
        );
        // The `@ext` suffix selects a non-jar artifact.
        assert_eq!(
            maven_path("de.oceanlabs.mcp:mcp_config:1.20.4@zip").as_deref(),
            Some("de/oceanlabs/mcp/mcp_config/1.20.4/mcp_config-1.20.4.zip")
        );
        assert_eq!(maven_path("broken").as_deref(), None);
    }

    fn library(name: &str) -> Library {
        Library {
            name: name.to_owned(),
            downloads: None,
            url: None,
            sha1: None,
            size: None,
            natives: None,
            extract: None,
            rules: Vec::new(),
        }
    }

    #[test]
    fn child_libraries_shadow_the_parent_and_come_first() {
        let parent = VersionJson {
            id: String::from("1.20.4"),
            main_class: Some(String::from("net.minecraft.client.main.Main")),
            libraries: vec![library("com.google.guava:guava:31.0"), library("org.lwjgl:lwjgl:3.3")],
            ..VersionJson::default()
        };
        let child = VersionJson {
            id: String::from("fabric-1.20.4"),
            inherits_from: Some(String::from("1.20.4")),
            main_class: Some(String::from("net.fabricmc.loader.impl.launch.knot.KnotClient")),
            libraries: vec![library("com.google.guava:guava:32.1")],
            ..VersionJson::default()
        };

        let merged = VersionJson::merge_onto(&child, &parent);

        assert_eq!(merged.id, "fabric-1.20.4");
        assert_eq!(
            merged.main_class.as_deref(),
            Some("net.fabricmc.loader.impl.launch.knot.KnotClient")
        );
        // Guava appears once, at the loader's version, before the inherited ones.
        let names: Vec<&str> = merged.libraries.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, vec!["com.google.guava:guava:32.1", "org.lwjgl:lwjgl:3.3"]);
        assert!(merged.inherits_from.is_none());
    }

    #[test]
    fn arguments_are_appended_parent_first() {
        let parent = VersionJson {
            arguments: Some(Arguments {
                game: vec![Argument::Plain(String::from("--username"))],
                jvm: vec![Argument::Plain(String::from("-cp"))],
            }),
            ..VersionJson::default()
        };
        let child = VersionJson {
            arguments: Some(Arguments {
                game: vec![Argument::Plain(String::from("--fabric"))],
                jvm: vec![Argument::Plain(String::from("-Dfabric=1"))],
            }),
            ..VersionJson::default()
        };

        let merged = VersionJson::merge_onto(&child, &parent);
        let arguments = merged.arguments.unwrap_or_default();
        assert_eq!(arguments.game.len(), 2);
        assert_eq!(arguments.jvm.len(), 2);
    }
}
