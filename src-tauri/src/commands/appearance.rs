use std::path::PathBuf;

use tauri::State;

use crate::accounts::AccountStore;
use crate::appearance::{self, CustomMascot, ImageSlot};
use crate::auth::skin;
use crate::error::Result;
use crate::state::AppState;

/// Copies a picked picture into the slot; returns it ready to display.
#[tauri::command]
pub async fn set_appearance_image(
    state: State<'_, AppState>,
    slot: ImageSlot,
    path: PathBuf,
) -> Result<String> {
    appearance::set_image(&state.paths, slot, &path).await
}

#[tauri::command]
pub async fn appearance_image(state: State<'_, AppState>, slot: ImageSlot) -> Result<Option<String>> {
    appearance::load_image(&state.paths, slot).await
}

#[tauri::command]
pub async fn clear_appearance_image(state: State<'_, AppState>, slot: ImageSlot) -> Result<()> {
    appearance::clear_image(&state.paths, slot).await;
    Ok(())
}

#[tauri::command]
pub async fn list_custom_mascots(state: State<'_, AppState>) -> Result<Vec<CustomMascot>> {
    appearance::list_mascots(&state.paths).await
}

#[tauri::command]
pub async fn add_custom_mascot(state: State<'_, AppState>, path: PathBuf) -> Result<CustomMascot> {
    appearance::add_mascot(&state.paths, &path).await
}

#[tauri::command]
pub async fn remove_custom_mascot(state: State<'_, AppState>, id: String) -> Result<()> {
    appearance::remove_mascot(&state.paths, &id).await
}

/// The account's skin drawn full-length, for the corner mascot. `None` when
/// the account has no skin (offline) or it could not be fetched.
#[tauri::command]
pub async fn account_figure(state: State<'_, AppState>, account_id: String) -> Result<Option<String>> {
    let store = AccountStore::load(&state.paths).await?;
    let Some(url) = store.find(&account_id).and_then(|account| account.skin_url.clone()) else {
        return Ok(None);
    };
    Ok(skin::fetch_body(&state.client(), &url).await)
}
