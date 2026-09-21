//! Turning a version profile's library list into downloads, a classpath and a
//! natives directory.

use std::path::{Path, PathBuf};

use crate::error::{ErrorKind, LauncherError, Result};
use crate::net::download::DownloadItem;

use super::rules::{current_os, current_arch, rules_allow, Features};
use super::version::{maven_path, Artifact, Library, VersionJson};

/// Where vanilla libraries come from when a profile omits an explicit URL.
const DEFAULT_MAVEN: &str = "https://libraries.minecraft.net/";

pub struct ResolvedLibraries {
    pub downloads: Vec<DownloadItem>,
    /// In profile order; the client jar is appended by the caller.
    pub classpath: Vec<PathBuf>,
    /// Jars to unpack into the natives directory, with their exclude globs.
    pub natives: Vec<(PathBuf, Vec<String>)>,
}

/// The `natives` map uses `${arch}` for the 32/64-bit suffix.
fn expand_natives_key(template: &str) -> String {
    let arch_bits = if current_arch() == "x86" { "32" } else { "64" };
    template.replace("${arch}", arch_bits)
}

/// New-style natives are a fourth Maven component, e.g.
/// `org.lwjgl:lwjgl:3.3.3:natives-windows`.
fn classifier_of(name: &str) -> Option<&str> {
    name.split(':').nth(3)
}

fn is_modern_native(library: &Library) -> bool {
    classifier_of(&library.name)
        .is_some_and(|classifier| classifier.starts_with("natives-"))
}

/// Builds the artifact record for a library that only gives Maven coordinates.
fn artifact_from_coordinates(library: &Library) -> Option<Artifact> {
    let path = maven_path(&library.name)?;
    let base = library.url.clone().unwrap_or_else(|| DEFAULT_MAVEN.to_owned());
    let base = if base.ends_with('/') { base } else { format!("{base}/") };
    Some(Artifact {
        url: format!("{base}{path}"),
        path: Some(path),
        sha1: library.sha1.clone(),
        size: library.size,
    })
}

fn artifact_target(libraries_root: &Path, artifact: &Artifact) -> Result<PathBuf> {
    let path = artifact.path.as_ref().ok_or_else(|| {
        LauncherError::new(ErrorKind::Parse, "У библиотеки нет пути в репозитории")
    })?;
    Ok(libraries_root.join(path))
}

fn push_download(items: &mut Vec<DownloadItem>, artifact: &Artifact, dest: &Path) {
    // An empty URL marks a file the Forge installer embeds or its processors
    // generate: it is expected on disk, never downloaded.
    if artifact.url.trim().is_empty() {
        return;
    }
    items.push(
        DownloadItem::new(artifact.url.clone(), dest)
            .with_sha1(artifact.sha1.clone())
            .with_size(artifact.size),
    );
}

/// Applies rules, resolves every artifact and classifies natives.
pub fn resolve(
    version: &VersionJson,
    libraries_root: &Path,
    features: Features,
) -> Result<ResolvedLibraries> {
    let mut resolved = ResolvedLibraries {
        downloads: Vec::new(),
        classpath: Vec::new(),
        natives: Vec::new(),
    };

    for library in &version.libraries {
        if !rules_allow(&library.rules, features) {
            continue;
        }

        let excludes = library
            .extract
            .as_ref()
            .map(|extract| extract.exclude.clone())
            .unwrap_or_default();

        // Pre-1.19 layout: the jar for this OS lives under `classifiers`.
        if let Some(natives) = &library.natives {
            if let Some(key) = natives.get(current_os()).map(|key| expand_natives_key(key)) {
                let artifact = library
                    .downloads
                    .as_ref()
                    .and_then(|downloads| downloads.classifiers.as_ref())
                    .and_then(|classifiers| classifiers.get(&key))
                    .cloned();

                if let Some(artifact) = artifact {
                    let dest = artifact_target(libraries_root, &artifact)?;
                    push_download(&mut resolved.downloads, &artifact, &dest);
                    resolved.natives.push((dest, excludes.clone()));
                }
            }
            // A `natives` entry may also carry a plain artifact for the
            // classpath, so fall through rather than skipping the library.
        }

        // Two library styles exist. Mojang's always has a `downloads` block,
        // and a missing `artifact` there means "natives only" (1.12.2's
        // jinput-platform, lwjgl-platform): there is no plain jar, and
        // inventing a URL from the coordinates yields a 404. Loader-style
        // libraries have no `downloads` at all and are Maven coordinates plus
        // a repository — only those get a synthesised URL.
        let artifact = match &library.downloads {
            Some(downloads) => downloads.artifact.clone(),
            None => artifact_from_coordinates(library),
        };

        let Some(artifact) = artifact else { continue };
        let dest = artifact_target(libraries_root, &artifact)?;
        push_download(&mut resolved.downloads, &artifact, &dest);

        if is_modern_native(library) {
            // 1.19+ keeps natives on the classpath, but java.library.path must
            // still point at the unpacked binaries.
            resolved.natives.push((dest.clone(), excludes));
        }
        resolved.classpath.push(dest);
    }

    // 1.14-1.16 list a library twice — plain artifact and natives variant —
    // pointing at the same jar. Keep the first occurrence so the classpath
    // order is preserved and nothing is unpacked twice.
    let mut seen: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    resolved.classpath.retain(|path| seen.insert(path.clone()));
    let mut seen_natives: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    resolved
        .natives
        .retain(|(path, _)| seen_natives.insert(path.clone()));

    Ok(resolved)
}

fn is_excluded(name: &str, excludes: &[String]) -> bool {
    // Mojang's excludes are directory prefixes such as "META-INF/".
    excludes.iter().any(|prefix| name.starts_with(prefix.as_str()))
}

/// Unpacks native jars next to the instance so `java.library.path` resolves.
/// Blocking on purpose — callers hand it to `spawn_blocking`.
pub fn extract_natives(natives: &[(PathBuf, Vec<String>)], target: &Path) -> Result<()> {
    std::fs::create_dir_all(target).map_err(|error| {
        LauncherError::io(format!("Не удалось создать {}", target.display()))
            .with_detail(error.to_string())
    })?;

    for (jar, excludes) in natives {
        let file = std::fs::File::open(jar).map_err(|error| {
            LauncherError::io(format!("Не удалось открыть {}", jar.display()))
                .with_detail(error.to_string())
        })?;
        let mut archive = zip::ZipArchive::new(file).map_err(|error| {
            LauncherError::new(ErrorKind::Parse, format!("Повреждён архив {}", jar.display()))
                .with_detail(error.to_string())
        })?;

        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).map_err(|error| {
                LauncherError::new(ErrorKind::Parse, "Не удалось прочитать запись архива")
                    .with_detail(error.to_string())
            })?;

            if entry.is_dir() {
                continue;
            }
            let Some(relative) = entry.enclosed_name() else {
                // Rejects absolute paths and `..` traversal.
                continue;
            };
            let name = relative.to_string_lossy().replace('\\', "/");
            if is_excluded(&name, excludes) {
                continue;
            }

            // Natives are flat shared libraries; nested paths only ever hold
            // metadata we do not want.
            let Some(file_name) = relative.file_name() else {
                continue;
            };
            let dest = target.join(file_name);

            let mut out = std::fs::File::create(&dest).map_err(|error| {
                LauncherError::io(format!("Не удалось записать {}", dest.display()))
                    .with_detail(error.to_string())
            })?;
            std::io::copy(&mut entry, &mut out).map_err(|error| {
                LauncherError::io(format!("Не удалось распаковать {name}"))
                    .with_detail(error.to_string())
            })?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::minecraft::version::{Artifact, LibraryDownloads};
    use std::collections::HashMap;

    fn artifact(path: &str) -> Artifact {
        Artifact {
            path: Some(path.to_owned()),
            sha1: Some(String::from("abc")),
            size: Some(10),
            url: format!("https://libraries.minecraft.net/{path}"),
        }
    }

    /// The exact shape of a 1.16.5 profile: `org.lwjgl:lwjgl-opengl:3.2.2`
    /// appears twice, once plain and once carrying the natives classifier,
    /// and both name the same `downloads.artifact`.
    fn double_listed_library() -> VersionJson {
        let path = "org/lwjgl/lwjgl-opengl/3.2.2/lwjgl-opengl-3.2.2.jar";
        let plain = Library {
            name: String::from("org.lwjgl:lwjgl-opengl:3.2.2"),
            downloads: Some(LibraryDownloads {
                artifact: Some(artifact(path)),
                classifiers: None,
            }),
            url: None,
            sha1: None,
            size: None,
            natives: None,
            extract: None,
            rules: Vec::new(),
        };

        let mut classifiers = HashMap::new();
        classifiers.insert(
            format!("natives-{}", current_os()),
            artifact("org/lwjgl/lwjgl-opengl/3.2.2/lwjgl-opengl-3.2.2-natives.jar"),
        );
        let mut natives = HashMap::new();
        natives.insert(current_os().to_owned(), format!("natives-{}", current_os()));

        let with_natives = Library {
            name: String::from("org.lwjgl:lwjgl-opengl:3.2.2"),
            downloads: Some(LibraryDownloads {
                artifact: Some(artifact(path)),
                classifiers: Some(classifiers),
            }),
            url: None,
            sha1: None,
            size: None,
            natives: Some(natives),
            extract: None,
            rules: Vec::new(),
        };

        VersionJson {
            id: String::from("1.16.5"),
            libraries: vec![plain, with_natives],
            ..VersionJson::default()
        }
    }

    #[test]
    fn a_double_listed_library_lands_on_the_classpath_once() {
        let version = double_listed_library();
        let resolved = match resolve(&version, Path::new("/libs"), Features::default()) {
            Ok(resolved) => resolved,
            Err(error) => panic!("resolve: {error}"),
        };

        // Two tasks writing one .part would race and one rename would fail.
        assert_eq!(resolved.classpath.len(), 1);
        // The natives jar is a different file and stays.
        assert_eq!(resolved.natives.len(), 1);
        assert!(resolved.natives[0]
            .0
            .to_string_lossy()
            .contains("natives"));

        let deduped = crate::net::download::dedupe_by_destination(resolved.downloads);
        assert_eq!(deduped.len(), 2);
    }

    #[test]
    fn natives_only_libraries_have_no_plain_jar() {
        // 1.12.2's jinput-platform: classifiers, but no downloads.artifact.
        let mut classifiers = HashMap::new();
        classifiers.insert(
            format!("natives-{}", current_os()),
            artifact("net/java/jinput/jinput-platform/2.0.5/jinput-platform-2.0.5-natives.jar"),
        );
        let mut natives = HashMap::new();
        natives.insert(current_os().to_owned(), format!("natives-{}", current_os()));

        let version = VersionJson {
            libraries: vec![Library {
                name: String::from("net.java.jinput:jinput-platform:2.0.5"),
                downloads: Some(LibraryDownloads {
                    artifact: None,
                    classifiers: Some(classifiers),
                }),
                url: None,
                sha1: None,
                size: None,
                natives: Some(natives),
                extract: None,
                rules: Vec::new(),
            }],
            ..VersionJson::default()
        };

        let resolved = match resolve(&version, Path::new("/libs"), Features::default()) {
            Ok(resolved) => resolved,
            Err(error) => panic!("resolve: {error}"),
        };
        // Only the natives jar is fetched; nothing guessed from coordinates.
        assert_eq!(resolved.downloads.len(), 1);
        assert!(resolved.downloads[0].url.contains("-natives"));
        assert!(resolved.classpath.is_empty());
        assert_eq!(resolved.natives.len(), 1);
    }

    #[test]
    fn loader_libraries_are_fetched_by_coordinates() {
        let version = VersionJson {
            libraries: vec![Library {
                name: String::from("net.fabricmc:sponge-mixin:0.15.4+mixin.0.8.7"),
                downloads: None,
                url: Some(String::from("https://maven.fabricmc.net/")),
                sha1: Some(String::from("abc")),
                size: Some(42),
                natives: None,
                extract: None,
                rules: Vec::new(),
            }],
            ..VersionJson::default()
        };
        let resolved = match resolve(&version, Path::new("/libs"), Features::default()) {
            Ok(resolved) => resolved,
            Err(error) => panic!("resolve: {error}"),
        };
        assert_eq!(
            resolved.downloads[0].url,
            "https://maven.fabricmc.net/net/fabricmc/sponge-mixin/0.15.4+mixin.0.8.7/sponge-mixin-0.15.4+mixin.0.8.7.jar"
        );
        assert_eq!(resolved.downloads[0].size, Some(42));
        assert_eq!(resolved.classpath.len(), 1);
    }
}
