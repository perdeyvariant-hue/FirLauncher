use tauri::State;

use crate::error::{LauncherError, Result};
use crate::instances::ModLoader;
use crate::java::{self, JavaRuntime, SystemMemory};
use crate::loaders::{self, LoaderVersion};
use crate::minecraft::manifest::{self, MinecraftVersionDto};
use crate::state::AppState;

#[tauri::command]
pub async fn list_minecraft_versions(
    state: State<'_, AppState>,
) -> Result<Vec<MinecraftVersionDto>> {
    let client = state.client();
    let manifest = manifest::load_manifest(&client, &state.paths, false).await?;
    // Snapshots are filtered in the dialog, so hand over everything.
    Ok(manifest::to_dto(&manifest, true))
}

#[tauri::command]
pub async fn list_java_runtimes(state: State<'_, AppState>) -> Result<Vec<JavaRuntime>> {
    let paths = state.paths.clone();
    tokio::task::spawn_blocking(move || java::detect::detect_all(&paths))
        .await
        .map_err(|error| {
            LauncherError::internal("Сбой поиска Java").with_detail(error.to_string())
        })?
}

#[tauri::command]
pub async fn system_memory(_state: State<'_, AppState>) -> Result<SystemMemory> {
    Ok(java::system_memory())
}

#[tauri::command]
pub async fn list_loader_versions(
    state: State<'_, AppState>,
    loader: ModLoader,
    mc_version: String,
) -> Result<Vec<LoaderVersion>> {
    loaders::list_versions(&state.client(), loader, &mc_version).await
}

/// How much each part of the data folder takes.
#[tauri::command]
pub async fn storage_usage(state: State<'_, AppState>) -> Result<crate::storage::StorageUsage> {
    crate::storage::usage(&state.paths).await
}

/// What a cleanup would remove, without removing anything.
#[tauri::command]
pub async fn plan_storage_cleanup(state: State<'_, AppState>) -> Result<crate::storage::CleanupPlan> {
    crate::storage::plan_cleanup(&state.paths).await
}

/// Removes libraries and client jars no instance refers to.
#[tauri::command]
pub async fn clean_storage(state: State<'_, AppState>) -> Result<crate::storage::CleanupPlan> {
    if state.games.any_running() {
        return Err(crate::error::LauncherError::new(
            crate::error::ErrorKind::Instance,
            "Сначала закройте игру: пока она запущена, её файлы заняты",
        ));
    }
    let (files, bytes) = crate::storage::clean(&state.paths).await?;
    Ok(crate::storage::CleanupPlan { files, bytes, blocked: None })
}

/// Title-screen panoramas from the downloaded assets, as cover thumbnails.
#[tauri::command]
pub async fn game_panoramas(state: State<'_, AppState>) -> Result<Vec<String>> {
    crate::art::panoramas(&state.paths).await
}

/// Block textures from the newest downloaded client, by name.
#[tauri::command]
pub async fn block_textures(
    state: State<'_, AppState>,
    names: Vec<String>,
) -> Result<std::collections::HashMap<String, String>> {
    crate::art::block_textures(&state.paths, names).await
}
