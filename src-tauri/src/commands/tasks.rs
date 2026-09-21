use tauri::State;

use crate::error::{ErrorKind, LauncherError, Result};
use crate::state::AppState;
use crate::tasks::TaskDto;

#[tauri::command]
pub async fn list_tasks(state: State<'_, AppState>) -> Result<Vec<TaskDto>> {
    Ok(state.tasks.snapshot())
}

#[tauri::command]
pub async fn cancel_task(state: State<'_, AppState>, id: String) -> Result<()> {
    state.tasks.cancel(&id)
}

#[tauri::command]
pub async fn retry_task(_state: State<'_, AppState>, _id: String) -> Result<()> {
    // Retrying is "press Play again": every installer is idempotent and skips
    // what already matches, so there is nothing to resume centrally.
    Err(LauncherError::new(
        ErrorKind::Unsupported,
        "Повторите действие, которое запустило задачу",
    ))
}
