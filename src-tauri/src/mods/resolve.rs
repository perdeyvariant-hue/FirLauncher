//! Walking a mod's required dependencies into an install plan.

use std::collections::{HashSet, VecDeque};

use crate::error::{ErrorKind, LauncherError, Result};

use super::{
    DependencyKind, ModDependency, ModProvider, ModVersion, ProjectKind, ReleaseType,
    ResolvedInstallPlan, Target,
};

/// A mod with more transitive dependencies than this is almost certainly a
/// cycle in someone's metadata; stop rather than loop.
const MAX_DEPENDENCIES: usize = 64;

/// The version to install: the newest release that fits, falling back to the
/// newest beta or alpha only when no release exists for this setup.
pub fn pick_best(versions: &[ModVersion], target: &Target) -> Option<ModVersion> {
    let fitting: Vec<&ModVersion> = versions.iter().filter(|v| target.accepts(v)).collect();
    fitting
        .iter()
        .find(|version| version.release_type == ReleaseType::Release)
        .or_else(|| fitting.first())
        .map(|version| (*version).clone())
}

pub async fn best_version(
    provider: &dyn ModProvider,
    project_id: &str,
    target: &Target,
) -> Result<Option<ModVersion>> {
    let versions = provider.versions(project_id, target).await?;
    Ok(pick_best(&versions, target))
}

/// Resolves a project and everything it requires. Projects already in the
/// instance are skipped; dependencies that cannot be satisfied end up in
/// `unresolved` so the dialog can say so instead of installing a broken set.
///
/// `pinned` is a version the user picked by hand. It is taken as is, even if
/// it was made for another Minecraft version: the picker already warned.
///
/// Only mods pull their dependencies in. A resource pack or shader that
/// needs a mod (Fresh Animations → Entity Texture Features) gets it listed in
/// `unresolved`: the jar belongs in `mods/`, for the instance's loader.
pub async fn plan(
    provider: &dyn ModProvider,
    target: &Target,
    kind: ProjectKind,
    project_id: &str,
    pinned: Option<&str>,
    installed: &HashSet<String>,
) -> Result<ResolvedInstallPlan> {
    let primary = match pinned {
        Some(version_id) => Some(provider.version(project_id, version_id).await?),
        None => best_version(provider, project_id, target).await?,
    };
    let primary = primary.ok_or_else(|| {
        let loaders: Vec<&str> = target.loaders.iter().map(|loader| loader.label()).collect();
        let message = if loaders.is_empty() {
            format!("Нет версии для Minecraft {}", target.mc_version)
        } else {
            format!(
                "У этого мода нет версии для Minecraft {} с {}",
                target.mc_version,
                loaders.join(" / ")
            )
        };
        LauncherError::new(ErrorKind::Provider, message)
    })?;

    if primary.download_url.is_empty() {
        return Err(LauncherError::new(
            ErrorKind::Provider,
            "Автор запретил скачивание этого мода через сторонние лаунчеры — \
             скачайте файл вручную со страницы мода и положите в папку mods",
        ));
    }

    let mut seen: HashSet<String> = installed.clone();
    seen.insert(primary.project_id.clone());

    let mut queue: VecDeque<ModDependency> = primary.dependencies.iter().cloned().collect();
    let mut dependencies: Vec<ModVersion> = Vec::new();
    let mut unresolved: Vec<ModDependency> = Vec::new();

    while let Some(dependency) = queue.pop_front() {
        if dependency.kind != DependencyKind::Required || !seen.insert(dependency.project_id.clone()) {
            continue;
        }
        if kind != ProjectKind::Mod {
            unresolved.push(dependency);
            continue;
        }
        if dependencies.len() >= MAX_DEPENDENCIES {
            unresolved.push(dependency);
            continue;
        }

        let resolved = match &dependency.version_id {
            // A pinned version is what the author tested against; use it if it
            // still fits, otherwise fall back to the newest compatible one.
            Some(version_id) => match provider.version(&dependency.project_id, version_id).await {
                Ok(version) if target.accepts(&version) => Some(version),
                _ => best_version(provider, &dependency.project_id, target).await?,
            },
            None => best_version(provider, &dependency.project_id, target).await?,
        };

        match resolved {
            Some(version) if !version.download_url.is_empty() => {
                queue.extend(version.dependencies.iter().cloned());
                dependencies.push(version);
            }
            _ => unresolved.push(dependency),
        }
    }

    // Names make the dialog readable; failing to fetch them is not fatal.
    if !unresolved.is_empty() {
        let ids: Vec<String> = unresolved.iter().map(|d| d.project_id.clone()).collect();
        if let Ok(names) = provider.project_names(&ids).await {
            for dependency in &mut unresolved {
                dependency.name = names.get(&dependency.project_id).cloned();
            }
        }
    }

    let total_bytes = primary.size_bytes + dependencies.iter().map(|d| d.size_bytes).sum::<u64>();
    Ok(ResolvedInstallPlan {
        primary,
        dependencies,
        unresolved,
        total_bytes,
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use crate::instances::ModLoader;
    use crate::mods::provider::BoxFuture;
    use crate::mods::{Category, ProviderId, SearchQuery, SearchResult};

    /// Projects keyed by id, each with its versions newest first.
    struct Fake {
        projects: HashMap<&'static str, Vec<ModVersion>>,
    }

    fn version(project: &str, id: &str, deps: &[&str], release: ReleaseType) -> ModVersion {
        ModVersion {
            provider: ProviderId::Modrinth,
            project_id: project.to_owned(),
            version_id: id.to_owned(),
            name: project.to_owned(),
            version_number: id.to_owned(),
            file_name: format!("{project}-{id}.jar"),
            size_bytes: 10,
            sha1: None,
            download_url: format!("https://cdn/{project}/{id}.jar"),
            game_versions: vec![String::from("1.20.4")],
            loaders: vec![ModLoader::Fabric],
            release_type: release,
            published_at: String::new(),
            dependencies: deps
                .iter()
                .map(|dep| ModDependency {
                    provider: ProviderId::Modrinth,
                    project_id: (*dep).to_owned(),
                    version_id: None,
                    kind: DependencyKind::Required,
                    name: None,
                })
                .collect(),
        }
    }

    impl ModProvider for Fake {
        fn id(&self) -> ProviderId {
            ProviderId::Modrinth
        }
        fn search<'a>(&'a self, _: &'a SearchQuery) -> BoxFuture<'a, Result<SearchResult>> {
            Box::pin(async { Err(LauncherError::internal("unused")) })
        }
        fn categories(&self, _: ProjectKind) -> BoxFuture<'_, Result<Vec<Category>>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn details<'a>(&'a self, _: &'a str) -> BoxFuture<'a, Result<crate::mods::ProjectDetails>> {
            Box::pin(async { Err(LauncherError::internal("unused")) })
        }
        fn versions<'a>(&'a self, project: &'a str, _: &'a Target) -> BoxFuture<'a, Result<Vec<ModVersion>>> {
            let found = self.projects.get(project).cloned().unwrap_or_default();
            Box::pin(async move { Ok(found) })
        }
        fn version<'a>(&'a self, project: &'a str, id: &'a str) -> BoxFuture<'a, Result<ModVersion>> {
            let found = self
                .projects
                .get(project)
                .and_then(|versions| versions.iter().find(|v| v.version_id == id).cloned());
            Box::pin(async move { found.ok_or_else(|| LauncherError::internal("missing")) })
        }
        fn project_names<'a>(&'a self, ids: &'a [String]) -> BoxFuture<'a, Result<HashMap<String, String>>> {
            let names = ids.iter().map(|id| (id.clone(), format!("Name of {id}"))).collect();
            Box::pin(async move { Ok(names) })
        }
        fn identify<'a>(&'a self, _: &'a [String]) -> BoxFuture<'a, Result<HashMap<String, ModVersion>>> {
            Box::pin(async { Ok(HashMap::new()) })
        }
        fn latest_for<'a>(&'a self, _: &'a [String], _: &'a Target) -> BoxFuture<'a, Result<HashMap<String, ModVersion>>> {
            Box::pin(async { Ok(HashMap::new()) })
        }
    }

    fn target() -> Target {
        Target::for_instance("1.20.4", ModLoader::Fabric)
    }

    #[tokio::test]
    async fn transitive_dependencies_are_collected_once() -> Result<()> {
        // iris -> sodium -> fabric-api, and iris -> fabric-api directly.
        let fake = Fake {
            projects: HashMap::from([
                ("iris", vec![version("iris", "i1", &["sodium", "fabric-api"], ReleaseType::Release)]),
                ("sodium", vec![version("sodium", "s1", &["fabric-api"], ReleaseType::Release)]),
                ("fabric-api", vec![version("fabric-api", "f1", &[], ReleaseType::Release)]),
            ]),
        };
        let plan = plan(&fake, &target(), ProjectKind::Mod, "iris", None, &HashSet::new()).await?;
        let ids: Vec<&str> = plan.dependencies.iter().map(|v| v.project_id.as_str()).collect();
        assert_eq!(ids, vec!["sodium", "fabric-api"]);
        assert!(plan.unresolved.is_empty());
        assert_eq!(plan.total_bytes, 30);
        Ok(())
    }

    #[tokio::test]
    async fn installed_projects_and_cycles_are_skipped() -> Result<()> {
        let fake = Fake {
            projects: HashMap::from([
                ("a", vec![version("a", "a1", &["b"], ReleaseType::Release)]),
                ("b", vec![version("b", "b1", &["a", "c"], ReleaseType::Release)]),
                ("c", vec![version("c", "c1", &[], ReleaseType::Release)]),
            ]),
        };
        let installed = HashSet::from([String::from("c")]);
        let plan = plan(&fake, &target(), ProjectKind::Mod, "a", None, &installed).await?;
        let ids: Vec<&str> = plan.dependencies.iter().map(|v| v.project_id.as_str()).collect();
        assert_eq!(ids, vec!["b"]);
        Ok(())
    }

    #[tokio::test]
    async fn unsatisfiable_dependencies_are_reported_with_names() -> Result<()> {
        let fake = Fake {
            projects: HashMap::from([(
                "addon",
                vec![version("addon", "x1", &["gone"], ReleaseType::Release)],
            )]),
        };
        let plan = plan(&fake, &target(), ProjectKind::Mod, "addon", None, &HashSet::new()).await?;
        assert_eq!(plan.unresolved.len(), 1);
        assert_eq!(plan.unresolved[0].name.as_deref(), Some("Name of gone"));
        Ok(())
    }

    #[tokio::test]
    async fn releases_win_over_newer_betas() -> Result<()> {
        let fake = Fake {
            projects: HashMap::from([(
                "m",
                vec![
                    version("m", "beta", &[], ReleaseType::Beta),
                    version("m", "stable", &[], ReleaseType::Release),
                ],
            )]),
        };
        let plan = plan(&fake, &target(), ProjectKind::Mod, "m", None, &HashSet::new()).await?;
        assert_eq!(plan.primary.version_id, "stable");
        Ok(())
    }

    #[tokio::test]
    async fn a_pinned_version_is_used_even_when_older() -> Result<()> {
        let fake = Fake {
            projects: HashMap::from([(
                "m",
                vec![
                    version("m", "new", &[], ReleaseType::Release),
                    version("m", "old", &[], ReleaseType::Release),
                ],
            )]),
        };
        let plan = plan(&fake, &target(), ProjectKind::Mod, "m", Some("old"), &HashSet::new()).await?;
        assert_eq!(plan.primary.version_id, "old");
        Ok(())
    }

    #[tokio::test]
    async fn packs_list_their_mod_dependencies_instead_of_installing_them() -> Result<()> {
        let fake = Fake {
            projects: HashMap::from([
                ("fresh", vec![version("fresh", "f1", &["etf"], ReleaseType::Release)]),
                ("etf", vec![version("etf", "e1", &[], ReleaseType::Release)]),
            ]),
        };
        let plan = plan(&fake, &target(), ProjectKind::ResourcePack, "fresh", None, &HashSet::new()).await?;
        assert!(plan.dependencies.is_empty());
        assert_eq!(plan.unresolved.len(), 1);
        assert_eq!(plan.unresolved[0].name.as_deref(), Some("Name of etf"));
        Ok(())
    }

    #[tokio::test]
    async fn a_blocked_download_is_refused_up_front() {
        let mut blocked = version("cf", "1", &[], ReleaseType::Release);
        blocked.download_url = String::new();
        let fake = Fake {
            projects: HashMap::from([("cf", vec![blocked])]),
        };
        let error = plan(&fake, &target(), ProjectKind::Mod, "cf", None, &HashSet::new()).await.err();
        assert!(error.is_some_and(|e| e.message.contains("вручную")));
    }
}
