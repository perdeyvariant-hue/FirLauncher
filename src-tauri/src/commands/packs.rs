use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::commands::instances::to_dto;
use crate::error::Result;
use crate::instances::{self, InstanceDto};
use crate::mods::{self, ProviderId};
use crate::packs::export::{ExportFormat, ExportSummary};
use crate::packs::{self, PackContext, SkippedFile};
use crate::state::AppState;
use crate::tasks::{Progress, TaskHandle, TaskKind};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub instance: InstanceDto,
    /// Files the user has to fetch by hand (CurseForge opt-outs and the like).
    pub skipped: Vec<SkippedFile>,
}

fn finish<T>(task: &TaskHandle, outcome: &Result<T>) {
    match outcome {
        Ok(_) => task.finish_ok(),
        Err(error) => task.finish_err(error),
    }
}

async fn run_import(state: &AppState, task: &Arc<TaskHandle>, source: PathBuf) -> Result<ImportResult> {
    let settings = state.settings();
    let client = state.client();
    let ctx = PackContext {
        client: &client,
        paths: &state.paths,
        settings: &settings,
        progress: Arc::clone(task) as Arc<dyn Progress>,
    };
    let (meta, skipped) = packs::import(&ctx, &source).await?;
    Ok(ImportResult {
        instance: to_dto(state, meta).await,
        skipped,
    })
}

/// Imports a `.mrpack`, CurseForge zip, MultiMC/Prism instance (zip or
/// folder) or FirLauncher archive as a new instance.
#[tauri::command]
pub async fn import_pack(state: State<'_, AppState>, path: String) -> Result<ImportResult> {
    let source = PathBuf::from(&path);
    let title = source
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| String::from("Импорт сборки"));
    let task = state.tasks.start(TaskKind::ImportPack, format!("Импорт: {title}"), None);
    let outcome = run_import(&state, &task, source).await;
    finish(&task, &outcome);
    outcome
}

/// Downloads a modpack from Modrinth or CurseForge and imports it.
#[tauri::command]
pub async fn install_modpack(
    state: State<'_, AppState>,
    provider: ProviderId,
    project_id: String,
    name: String,
) -> Result<ImportResult> {
    let task = state.tasks.start(TaskKind::ImportPack, format!("Модпак: {name}"), None);
    let outcome = async {
        let settings = state.settings();
        let client = state.client();
        let provider_impl = mods::provider(&client, provider)?;
        let ctx = PackContext {
            client: &client,
            paths: &state.paths,
            settings: &settings,
            progress: Arc::clone(&task) as Arc<dyn Progress>,
        };
        let (meta, skipped) =
            packs::install_from_provider(&ctx, provider_impl.as_ref(), &project_id).await?;
        Ok(ImportResult {
            instance: to_dto(&state, meta).await,
            skipped,
        })
    }
    .await;
    finish(&task, &outcome);
    outcome
}

#[tauri::command]
pub async fn export_instance(
    state: State<'_, AppState>,
    id: String,
    format: ExportFormat,
    destination: String,
) -> Result<ExportSummary> {
    let meta = instances::read_meta(&state.paths, &id).await?;
    let task = state.tasks.start(TaskKind::ExportPack, format!("Экспорт: {}", meta.name), Some(id));
    let settings = state.settings();
    let client = state.client();
    let ctx = PackContext {
        client: &client,
        paths: &state.paths,
        settings: &settings,
        progress: Arc::clone(&task) as Arc<dyn Progress>,
    };
    let outcome = packs::export::export(&ctx, &meta, format, &PathBuf::from(destination)).await;
    finish(&task, &outcome);
    outcome
}

/// Which modpack an instance came from, if any.
#[tauri::command]
pub async fn modpack_info(state: State<'_, AppState>, id: String) -> Result<Option<packs::update::ModpackInfo>> {
    packs::update::info(&state.paths, &id).await
}

#[tauri::command]
pub async fn check_modpack_update(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<packs::update::ModpackUpdate>> {
    let modrinth = mods::provider(&state.client(), ProviderId::Modrinth)?;
    packs::update::check(&state.paths, modrinth.as_ref(), &id).await
}

/// Brings a modpack instance up to the newest version, keeping the user's
/// own changes (see `packs::update`).
#[tauri::command]
pub async fn update_modpack(state: State<'_, AppState>, id: String) -> Result<packs::update::UpdateSummary> {
    if state.games.is_running(&id) {
        return Err(crate::error::LauncherError::new(
            crate::error::ErrorKind::Instance,
            "Закройте игру перед обновлением модпака",
        ));
    }
    let meta = instances::read_meta(&state.paths, &id).await?;
    let task = state.tasks.start(TaskKind::ImportPack, format!("Обновление: {}", meta.name), Some(id));
    let outcome = async {
        let settings = state.settings();
        let client = state.client();
        let modrinth = mods::provider(&client, ProviderId::Modrinth)?;
        if settings.backup_worlds_before_updates {
            task.set_stage(String::from("Резервная копия миров"));
            instances::worlds::backup_all(&state.paths, &meta.id).await?;
        }
        let ctx = PackContext {
            client: &client,
            paths: &state.paths,
            settings: &settings,
            progress: Arc::clone(&task) as Arc<dyn Progress>,
        };
        packs::update::apply(&ctx, modrinth.as_ref(), &meta).await
    }
    .await;
    finish(&task, &outcome);
    outcome
}
