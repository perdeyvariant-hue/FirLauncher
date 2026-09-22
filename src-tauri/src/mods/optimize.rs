//! "Optimise this instance": well-known performance mods for its loader and
//! version, plus a memory size and JVM flags that fit the mod count.

use std::collections::HashSet;

use serde::Serialize;

use crate::instances::ModLoader;

use super::{resolve, ModProvider, Target};

/// A performance mod the launcher knows is safe to suggest.
struct Candidate {
    slug: &'static str,
    name: &'static str,
    about: &'static str,
    loaders: &'static [ModLoader],
}

const ALL_MODDED: &[ModLoader] = &[ModLoader::Fabric, ModLoader::Quilt, ModLoader::Forge, ModLoader::NeoForge];

const CANDIDATES: &[Candidate] = &[
    Candidate {
        slug: "sodium",
        name: "Sodium",
        about: "Новый движок рендера — FPS выше в разы",
        loaders: &[ModLoader::Fabric, ModLoader::Quilt, ModLoader::NeoForge],
    },
    Candidate {
        slug: "embeddium",
        name: "Embeddium",
        about: "Sodium для Forge — FPS выше в разы",
        loaders: &[ModLoader::Forge],
    },
    Candidate {
        slug: "lithium",
        name: "Lithium",
        about: "Быстрее игровая логика: мобы, редстоун, чанки",
        loaders: &[ModLoader::Fabric, ModLoader::Quilt, ModLoader::NeoForge],
    },
    Candidate {
        slug: "ferrite-core",
        name: "FerriteCore",
        about: "Заметно меньше расход оперативной памяти",
        loaders: ALL_MODDED,
    },
    Candidate {
        slug: "modernfix",
        name: "ModernFix",
        about: "Быстрее загрузка игры и миров",
        loaders: ALL_MODDED,
    },
    Candidate {
        slug: "entityculling",
        name: "EntityCulling",
        about: "Не рисует мобов и сундуки, которых не видно",
        loaders: ALL_MODDED,
    },
    Candidate {
        slug: "immediatelyfast",
        name: "ImmediatelyFast",
        about: "Ускоряет интерфейс, текст и частицы",
        loaders: &[ModLoader::Fabric, ModLoader::Quilt, ModLoader::NeoForge, ModLoader::Forge],
    },
    Candidate {
        slug: "dynamic-fps",
        name: "Dynamic FPS",
        about: "Снижает FPS, когда окно свёрнуто, — компьютер меньше греется",
        loaders: ALL_MODDED,
    },
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizeMod {
    pub project_id: String,
    pub name: String,
    pub about: String,
    /// The version that would be installed; `None` when there is none for
    /// this Minecraft version and loader.
    pub version_number: Option<String>,
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizePlan {
    pub mods: Vec<OptimizeMod>,
    pub current_memory_mb: u32,
    pub recommended_memory_mb: u32,
    pub current_jvm_args: String,
    pub recommended_jvm_args: String,
}

/// G1 tuned for a game client: short pauses, a young generation big enough
/// for Minecraft's allocation rate. Works on Java 8 through 25.
pub const RECOMMENDED_JVM_ARGS: &str = "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 \
-XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:G1NewSizePercent=30 \
-XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 \
-XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 \
-XX:G1MixedGCLiveThresholdPercent=90 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem \
-XX:MaxTenuringThreshold=1";

/// Memory by mod count, never more than half of the machine nor less than 2 GB.
pub fn recommended_memory(mod_count: usize, system_mb: u64) -> u32 {
    let wanted: u32 = match mod_count {
        0 => 2048,
        1..=40 => 3072,
        41..=120 => 4096,
        121..=200 => 6144,
        _ => 8192,
    };
    let half = u32::try_from(system_mb / 2).unwrap_or(u32::MAX);
    // Round down to a whole 512 MB step so the slider lands on a mark.
    (wanted.min(half) / 512 * 512).max(2048)
}

/// Looks up every suitable candidate on Modrinth.
pub async fn plan_mods(
    modrinth: &dyn ModProvider,
    mc_version: &str,
    loader: ModLoader,
    installed: &HashSet<String>,
) -> Vec<OptimizeMod> {
    let target = Target::for_instance(mc_version, loader);
    let mut out = Vec::new();
    for candidate in CANDIDATES.iter().filter(|c| c.loaders.contains(&loader)) {
        let versions = modrinth.versions(candidate.slug, &target).await.unwrap_or_default();
        let best = resolve::pick_best(&versions, &target);
        let project_id = best
            .as_ref()
            .map(|version| version.project_id.clone())
            .unwrap_or_else(|| candidate.slug.to_owned());
        out.push(OptimizeMod {
            installed: installed.contains(&project_id) || installed.contains(candidate.slug),
            project_id,
            name: candidate.name.to_owned(),
            about: candidate.about.to_owned(),
            version_number: best.map(|version| version.version_number),
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_follows_the_mod_count_within_the_machine() {
        assert_eq!(recommended_memory(0, 16_384), 2048);
        assert_eq!(recommended_memory(30, 16_384), 3072);
        assert_eq!(recommended_memory(150, 16_384), 6144);
        assert_eq!(recommended_memory(400, 16_384), 8192);
        assert_eq!(recommended_memory(400, 8192), 4096, "half of an 8 GB machine");
        assert_eq!(recommended_memory(10, 3000), 2048, "never below 2 GB");
    }

    #[test]
    fn every_loader_gets_a_renderer() {
        for loader in [ModLoader::Fabric, ModLoader::Quilt, ModLoader::Forge, ModLoader::NeoForge] {
            assert!(
                CANDIDATES.iter().any(|c| c.loaders.contains(&loader) && (c.slug == "sodium" || c.slug == "embeddium")),
                "{loader:?}"
            );
        }
    }
}
