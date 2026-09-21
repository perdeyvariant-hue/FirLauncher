//! Finding a usable JVM, and fetching one when the machine has none.

pub mod adoptium;
pub mod detect;

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum JavaSource {
    /// Found on the system.
    Detected,
    /// Downloaded by the launcher into `<data>/java`.
    Managed,
    /// Entered by hand in instance settings.
    Manual,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaRuntime {
    pub path: String,
    pub major: u32,
    pub full_version: String,
    pub vendor: String,
    pub arch: String,
    pub source: JavaSource,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMemory {
    pub total_mb: u64,
    pub available_mb: u64,
}

pub fn system_memory() -> SystemMemory {
    let mut system = sysinfo::System::new();
    system.refresh_memory();
    SystemMemory {
        total_mb: system.total_memory() / (1024 * 1024),
        available_mb: system.available_memory() / (1024 * 1024),
    }
}

/// Which Java the given Minecraft version needs, for profiles that predate
/// Mojang declaring it. The boundaries are 1.17 (Java 17) and 1.20.5 (Java 21).
pub fn major_for_declared(declared: u32) -> u32 {
    match declared {
        0..=8 => 8,
        9..=17 => 17,
        _ => declared,
    }
}

/// The runtime matching exactly what the version profile asks for.
///
/// Minecraft wants a specific major, not a minimum: 1.16 and older break on
/// Java 17+ in ways that only show up once mods are involved, which is why the
/// vanilla launcher downloads the exact component instead of reusing whatever
/// newer JVM happens to be installed.
pub fn pick_exact(runtimes: &[JavaRuntime], required: u32) -> Option<&JavaRuntime> {
    runtimes.iter().find(|runtime| runtime.major == required)
}

/// Last resort when the right major cannot be installed — for instance on a
/// platform Adoptium does not build Java 8 for. Newer may misbehave, but it is
/// better than refusing to start at all.
pub fn pick_fallback(runtimes: &[JavaRuntime], required: u32) -> Option<&JavaRuntime> {
    runtimes
        .iter()
        .filter(|runtime| runtime.major > required)
        .min_by_key(|runtime| runtime.major)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runtime(major: u32) -> JavaRuntime {
        JavaRuntime {
            path: format!("/jvm/{major}/bin/java"),
            major,
            full_version: format!("{major}.0.1"),
            vendor: String::from("Test"),
            arch: String::from("x64"),
            source: JavaSource::Detected,
        }
    }

    #[test]
    fn an_exact_major_is_required() {
        let installed = vec![runtime(17), runtime(21)];
        assert_eq!(pick_exact(&installed, 17).map(|r| r.major), Some(17));
        // Java 8 is not satisfied by Java 17 being installed.
        assert!(pick_exact(&installed, 8).is_none());
    }

    #[test]
    fn the_fallback_takes_the_closest_newer_runtime() {
        let installed = vec![runtime(21), runtime(17)];
        assert_eq!(pick_fallback(&installed, 8).map(|r| r.major), Some(17));
        assert!(pick_fallback(&installed, 21).is_none());
    }

    #[test]
    fn undeclared_java_versions_map_to_the_historical_defaults() {
        assert_eq!(major_for_declared(8), 8);
        assert_eq!(major_for_declared(16), 17);
        assert_eq!(major_for_declared(21), 21);
    }
}
