use std::sync::Arc;

use tauri::State;

use crate::error::{ErrorKind, LauncherError, Result};
use crate::instances::{self, ModLoader};
use crate::mods::index::ModIndex;
use crate::mods::install::{self, ModUpdate};
use crate::mods::{
    self, resolve, Category, ModVersion, ProjectDetails, ProjectKind, ProviderId,
    ResolvedInstallPlan, SearchQuery, SearchResult, Target,
};
use crate::state::AppState;
use crate::tasks::{Progress, TaskKind};

/// What content of `kind` must support to go into this instance. Mods need a
/// loader; resource packs and shaders go into any instance.
async fn target_of(state: &AppState, instance_id: &str, kind: ProjectKind) -> Result<Target> {
    if kind == ProjectKind::Modpack {
        return Err(LauncherError::new(
            ErrorKind::Instance,
            "Модпак ставится как новая сборка, а не внутрь существующей",
        ));
    }
    let meta = instances::read_meta(&state.paths, instance_id).await?;
    if kind == ProjectKind::Mod && meta.loader == ModLoader::Vanilla {
        return Err(LauncherError::new(
            ErrorKind::Instance,
            "В ванильную сборку моды не ставятся — создайте сборку с лоадером",
        ));
    }
    Ok(Target::for_content(&meta.mc_version, meta.loader, kind))
}

#[tauri::command]
pub async fn available_providers(state: State<'_, AppState>) -> Result<Vec<ProviderId>> {
    Ok(mods::providers(&state.settings(), &state.client())
        .iter()
        .map(|provider| provider.id())
        .collect())
}

#[tauri::command]
pub async fn search_projects(state: State<'_, AppState>, query: SearchQuery) -> Result<SearchResult> {
    let provider = mods::provider(&state.settings(), &state.client(), query.provider)?;
    provider.search(&query).await
}

#[tauri::command]
pub async fn list_categories(
    state: State<'_, AppState>,
    provider: ProviderId,
    kind: ProjectKind,
) -> Result<Vec<Category>> {
    let provider = mods::provider(&state.settings(), &state.client(), provider)?;
    provider.categories(kind).await
}

#[tauri::command]
pub async fn project_details(
    state: State<'_, AppState>,
    provider: ProviderId,
    project_id: String,
) -> Result<ProjectDetails> {
    let provider = mods::provider(&state.settings(), &state.client(), provider)?;
    provider.details(&project_id).await
}

/// Project ids already in the instance, per provider — the browser shows
/// them as installed.
#[tauri::command]
pub async fn installed_projects(
    state: State<'_, AppState>,
    instance_id: String,
    provider: ProviderId,
    kind: ProjectKind,
) -> Result<Vec<String>> {
    let index = ModIndex::load(&state.paths, &instance_id, kind).await?;
    Ok(index.projects(provider).into_iter().collect())
}

/// Versions of a project for the version picker, newest first. By default
/// only ones that fit the instance; `any_game_version` drops the Minecraft
/// version filter (the loader filter for mods stays — those would not load).
#[tauri::command]
pub async fn list_versions(
    state: State<'_, AppState>,
    instance_id: String,
    provider: ProviderId,
    project_id: String,
    kind: ProjectKind,
    any_game_version: bool,
) -> Result<Vec<ModVersion>> {
    let mut target = target_of(&state, &instance_id, kind).await?;
    if any_game_version {
        target.mc_version.clear();
    }
    let provider_impl = mods::provider(&state.settings(), &state.client(), provider)?;
    let versions = provider_impl.versions(&project_id, &target).await?;
    Ok(versions.into_iter().filter(|v| target.accepts(v)).collect())
}

/// `version_id` installs that exact version instead of the best fit.
#[tauri::command]
pub async fn resolve_install(
    state: State<'_, AppState>,
    instance_id: String,
    provider: ProviderId,
    project_id: String,
    kind: ProjectKind,
    version_id: Option<String>,
) -> Result<ResolvedInstallPlan> {
    let target = target_of(&state, &instance_id, kind).await?;
    let provider_impl = mods::provider(&state.settings(), &state.client(), provider)?;
    let installed = ModIndex::load(&state.paths, &instance_id, kind)
        .await?
        .projects(provider);
    resolve::plan(
        provider_impl.as_ref(),
        &target,
        kind,
        &project_id,
        version_id.as_deref(),
        &installed,
    )
    .await
}

/// Downloads a confirmed plan. Runs as a task so it shows in the bottom bar,
/// and returns once the files are in place.
#[tauri::command]
pub async fn install_plan(
    state: State<'_, AppState>,
    instance_id: String,
    kind: ProjectKind,
    plan: ResolvedInstallPlan,
) -> Result<()> {
    // Validates the kind (no modpacks here) before anything is downloaded.
    target_of(&state, &instance_id, kind).await?;
    let task = state.tasks.start(
        TaskKind::InstallMod,
        plan.primary.name.clone(),
        Some(instance_id.clone()),
    );
    let mut versions = vec![plan.primary];
    versions.extend(plan.dependencies);

    let outcome = install::install_versions(
        &state.client(),
        &state.paths,
        &instance_id,
        kind,
        &versions,
        state.settings().download_concurrency(),
        Arc::clone(&task) as Arc<dyn Progress>,
    )
    .await;

    match &outcome {
        Ok(()) => task.finish_ok(),
        Err(error) => task.finish_err(error),
    }
    outcome
}

#[tauri::command]
pub async fn check_updates(
    state: State<'_, AppState>,
    instance_id: String,
    kind: ProjectKind,
) -> Result<Vec<ModUpdate>> {
    let target = target_of(&state, &instance_id, kind).await?;
    let providers = mods::providers(&state.settings(), &state.client());
    install::check_updates(&providers, &state.paths, &instance_id, kind, &target).await
}

#[tauri::command]
pub async fn apply_updates(
    state: State<'_, AppState>,
    instance_id: String,
    kind: ProjectKind,
    updates: Vec<ModUpdate>,
) -> Result<()> {
    target_of(&state, &instance_id, kind).await?;
    if updates.is_empty() {
        return Ok(());
    }
    let title = match updates.as_slice() {
        [single] => single.latest.name.clone(),
        _ => format!("Обновление: {} файлов", updates.len()),
    };
    let task = state.tasks.start(TaskKind::InstallMod, title, Some(instance_id.clone()));
    if state.settings().backup_worlds_before_updates {
        task.set_stage(String::from("Резервная копия миров"));
        crate::instances::worlds::backup_all(&state.paths, &instance_id).await?;
    }

    let outcome = install::apply_updates(
        &state.client(),
        &state.paths,
        &instance_id,
        kind,
        &updates,
        state.settings().download_concurrency(),
        Arc::clone(&task) as Arc<dyn Progress>,
    )
    .await;

    match &outcome {
        Ok(()) => task.finish_ok(),
        Err(error) => task.finish_err(error),
    }
    outcome
}

/// Deletes a resource pack or shader pack, keeping its index in step.
#[tauri::command]
pub async fn remove_content(
    state: State<'_, AppState>,
    instance_id: String,
    kind: ProjectKind,
    file_name: String,
) -> Result<()> {
    if kind == ProjectKind::Mod {
        return crate::instances::contents::remove_mod(&state.paths, &instance_id, &file_name).await;
    }
    crate::instances::contents::remove_pack(&state.paths, &instance_id, kind, &file_name).await
}

/// Performance mods for this instance, and memory/JVM suggestions.
#[tauri::command]
pub async fn optimize_plan(
    state: State<'_, AppState>,
    instance_id: String,
) -> Result<mods::optimize::OptimizePlan> {
    let meta = instances::read_meta(&state.paths, &instance_id).await?;
    if meta.loader == ModLoader::Vanilla {
        return Err(LauncherError::new(
            ErrorKind::Instance,
            "В ванильную сборку моды не ставятся — создайте сборку с лоадером",
        ));
    }
    let modrinth = mods::provider(&state.settings(), &state.client(), ProviderId::Modrinth)?;
    let installed = ModIndex::load(&state.paths, &instance_id, ProjectKind::Mod)
        .await?
        .projects(ProviderId::Modrinth);
    let mod_count = crate::instances::contents::list_mods(&state.paths, &instance_id).await?.len();
    let settings = state.settings();
    let system = crate::java::system_memory();
    Ok(mods::optimize::OptimizePlan {
        mods: mods::optimize::plan_mods(modrinth.as_ref(), &meta.mc_version, meta.loader, &installed).await,
        current_memory_mb: meta.java.memory_mb.unwrap_or(settings.default_memory_mb),
        recommended_memory_mb: mods::optimize::recommended_memory(mod_count, system.total_mb),
        current_jvm_args: meta.java.extra_jvm_args.clone().unwrap_or(settings.default_jvm_args),
        recommended_jvm_args: String::from(mods::optimize::RECOMMENDED_JVM_ARGS),
    })
}

/// Installs the chosen performance mods and applies the memory/JVM choice.
#[tauri::command]
pub async fn apply_optimize(
    state: State<'_, AppState>,
    instance_id: String,
    project_ids: Vec<String>,
    memory_mb: Option<u32>,
    jvm_args: Option<String>,
) -> Result<()> {
    let mut meta = instances::read_meta(&state.paths, &instance_id).await?;
    if memory_mb.is_some() || jvm_args.is_some() {
        if let Some(memory_mb) = memory_mb {
            meta.java.memory_mb = Some(memory_mb.clamp(1024, 65_536));
        }
        if let Some(jvm_args) = jvm_args {
            meta.java.extra_jvm_args = Some(jvm_args);
        }
        instances::write_meta(&state.paths, &meta).await?;
    }
    if project_ids.is_empty() {
        return Ok(());
    }

    let target = target_of(&state, &instance_id, ProjectKind::Mod).await?;
    let modrinth = mods::provider(&state.settings(), &state.client(), ProviderId::Modrinth)?;
    let task = state.tasks.start(TaskKind::InstallMod, format!("Оптимизация: {}", meta.name), Some(instance_id.clone()));
    let outcome = async {
        let mut installed = ModIndex::load(&state.paths, &instance_id, ProjectKind::Mod)
            .await?
            .projects(ProviderId::Modrinth);
        let mut versions = Vec::new();
        for project_id in &project_ids {
            if installed.contains(project_id) {
                continue;
            }
            let plan = resolve::plan(modrinth.as_ref(), &target, ProjectKind::Mod, project_id, None, &installed).await?;
            installed.insert(plan.primary.project_id.clone());
            for dependency in &plan.dependencies {
                installed.insert(dependency.project_id.clone());
            }
            versions.push(plan.primary);
            versions.extend(plan.dependencies);
        }
        install::install_versions(
            &state.client(),
            &state.paths,
            &instance_id,
            ProjectKind::Mod,
            &versions,
            state.settings().download_concurrency(),
            Arc::clone(&task) as Arc<dyn Progress>,
        )
        .await
    }
    .await;
    match &outcome {
        Ok(()) => task.finish_ok(),
        Err(error) => task.finish_err(error),
    }
    outcome
}
