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
