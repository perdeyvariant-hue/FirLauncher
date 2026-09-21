//! Locating JVMs already installed on the machine.
//!
//! Reading the `release` file that ships inside every JDK/JRE is both faster
//! and more reliable than spawning `java -version` for each candidate; the
//! spawn is only a fallback.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::error::Result;
use crate::paths::Paths;

use super::{JavaRuntime, JavaSource};

/// The launcher-visible executable: `javaw` on Windows has no console window,
/// and redirected pipes still work.
fn executable_names() -> &'static [&'static str] {
    if cfg!(windows) {
        &["javaw.exe", "java.exe"]
    } else {
        &["java"]
    }
}

fn binary_in(home: &Path) -> Option<PathBuf> {
    for name in executable_names() {
        let candidate = home.join("bin").join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Parses `JAVA_VERSION="21.0.5"` style lines from a JDK `release` file.
fn parse_release_file(home: &Path) -> Option<(String, String)> {
    let text = std::fs::read_to_string(home.join("release")).ok()?;
    let mut fields: BTreeMap<String, String> = BTreeMap::new();
    for line in text.lines() {
        if let Some((key, value)) = line.split_once('=') {
            fields.insert(
                key.trim().to_owned(),
                value.trim().trim_matches('"').to_owned(),
            );
        }
    }
    let version = fields.get("JAVA_VERSION")?.clone();
    let vendor = fields
        .get("IMPLEMENTOR")
        .cloned()
        .unwrap_or_else(|| String::from("Неизвестный поставщик"));
    Some((version, vendor))
}

/// `1.8.0_432` -> 8, `21.0.5` -> 21.
pub fn major_of(version: &str) -> Option<u32> {
    let cleaned = version.trim();
    let first = cleaned.split(['.', '_', '-', '+']).next()?;
    let first: u32 = first.parse().ok()?;
    if first == 1 {
        cleaned
            .split('.')
            .nth(1)
            .and_then(|part| part.parse::<u32>().ok())
    } else {
        Some(first)
    }
}

fn arch_of(home: &Path) -> String {
    // Adoptium encodes the architecture in the directory name; otherwise the
    // host architecture is the only sane guess.
    let name = home.to_string_lossy().to_ascii_lowercase();
    if name.contains("x86-32") || name.contains("i686") {
        String::from("x86")
    } else if name.contains("aarch64") || name.contains("arm64") {
        String::from("aarch64")
    } else {
        String::from(std::env::consts::ARCH)
    }
}

fn runtime_from_home(home: &Path, source: JavaSource) -> Option<JavaRuntime> {
    let binary = binary_in(home)?;
    let (full_version, vendor) = parse_release_file(home)?;
    let major = major_of(&full_version)?;
    Some(JavaRuntime {
        path: binary.to_string_lossy().into_owned(),
        major,
        full_version,
        vendor,
        arch: arch_of(home),
        source,
    })
}

/// Directories that typically hold several JDKs side by side.
fn search_roots(paths: &Paths) -> Vec<PathBuf> {
    let mut roots = vec![paths.java()];

    if cfg!(windows) {
        for base in [
            "C:/Program Files/Eclipse Adoptium",
            "C:/Program Files/Java",
            "C:/Program Files/Microsoft",
            "C:/Program Files/Amazon Corretto",
            "C:/Program Files/Zulu",
            "C:/Program Files (x86)/Java",
        ] {
            roots.push(PathBuf::from(base));
        }
    } else if cfg!(target_os = "macos") {
        roots.push(PathBuf::from("/Library/Java/JavaVirtualMachines"));
        if let Some(home) = dirs::home_dir() {
            roots.push(home.join("Library/Java/JavaVirtualMachines"));
        }
    } else {
        for base in ["/usr/lib/jvm", "/usr/java", "/opt/java"] {
            roots.push(PathBuf::from(base));
        }
    }

    roots
}

/// macOS wraps the JDK in `Contents/Home`.
fn normalise_home(candidate: PathBuf) -> PathBuf {
    let nested = candidate.join("Contents").join("Home");
    if nested.is_dir() {
        nested
    } else {
        candidate
    }
}

fn collect_from_root(root: &Path, source: JavaSource, out: &mut Vec<JavaRuntime>) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let home = normalise_home(entry.path());
        if !home.is_dir() {
            continue;
        }
        if let Some(runtime) = runtime_from_home(&home, source) {
            out.push(runtime);
        }
    }
}

/// Scans JAVA_HOME, PATH, the managed directory and the usual system
/// locations. Blocking — call it from `spawn_blocking`.
pub fn detect_all(paths: &Paths) -> Result<Vec<JavaRuntime>> {
    let mut found: Vec<JavaRuntime> = Vec::new();

    if let Some(java_home) = std::env::var_os("JAVA_HOME") {
        let home = normalise_home(PathBuf::from(java_home));
        if let Some(runtime) = runtime_from_home(&home, JavaSource::Detected) {
            found.push(runtime);
        }
    }

    // A `java` on PATH usually sits in `<home>/bin`.
    if let Some(path_var) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_var) {
            for name in executable_names() {
                if dir.join(name).is_file() {
                    if let Some(home) = dir.parent() {
                        if let Some(runtime) = runtime_from_home(home, JavaSource::Detected) {
                            found.push(runtime);
                        }
                    }
                }
            }
        }
    }

    let managed_root = paths.java();
    for root in search_roots(paths) {
        let source = if root == managed_root {
            JavaSource::Managed
        } else {
            JavaSource::Detected
        };
        collect_from_root(&root, source, &mut found);
    }

    // Same JVM reachable through several roots: keep one entry per binary.
    found.sort_by(|a, b| b.major.cmp(&a.major).then_with(|| a.path.cmp(&b.path)));
    found.dedup_by(|a, b| a.path.eq_ignore_ascii_case(&b.path));
    Ok(found)
}

/// Validates a path the user typed in instance settings.
pub fn inspect_manual(binary: &Path) -> Option<JavaRuntime> {
    let home = binary.parent()?.parent()?;
    let mut runtime = runtime_from_home(home, JavaSource::Manual)?;
    runtime.path = binary.to_string_lossy().into_owned();
    Some(runtime)
}

#[cfg(test)]
mod tests {
    use super::major_of;

    #[test]
    fn java_version_strings_yield_major_versions() {
        assert_eq!(major_of("1.8.0_432"), Some(8));
        assert_eq!(major_of("17.0.13"), Some(17));
        assert_eq!(major_of("21.0.5+11"), Some(21));
        assert_eq!(major_of("24-ea"), Some(24));
        assert_eq!(major_of("nonsense"), None);
    }
}
