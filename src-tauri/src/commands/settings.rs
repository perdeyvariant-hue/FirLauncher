use serde::Serialize;
use tauri::State;

use crate::config::settings::Settings;
use crate::error::Result;
use crate::state::AppState;

#[tauri::command]
pub async fn load_settings(state: State<'_, AppState>) -> Result<Settings> {
    Ok(state.settings())
}

/// What this particular build ships with, so the UI can hide settings that
/// are fixed at build time.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildInfo {
    pub curseforge_key_builtin: bool,
    pub discord_app_id_builtin: bool,
}

#[tauri::command]
pub fn build_info() -> BuildInfo {
    BuildInfo {
        curseforge_key_builtin: crate::mods::builtin_curseforge_key().is_some(),
        discord_app_id_builtin: crate::presence::builtin_app_id().is_some(),
    }
}

#[tauri::command]
pub async fn save_settings(state: State<'_, AppState>, mut settings: Settings) -> Result<Settings> {
    settings.appearance = settings.appearance.sanitized();
    settings.save(&state.paths).await?;
    state.replace_settings(settings.clone())?;
    Ok(settings)
}
