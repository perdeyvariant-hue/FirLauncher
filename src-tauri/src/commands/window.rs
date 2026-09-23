//! The launcher's own window.
//!
//! A shortcut launch shows a small card instead of the whole launcher, hides
//! it while the game runs, and brings the launcher back only if something
//! went wrong. These commands are the frontend's handle on that.

use tauri::{AppHandle, LogicalSize, Manager, WebviewWindow};

use crate::error::{LauncherError, Result};

/// Just enough room for the instance name, a progress bar and one button.
const COMPACT_WIDTH: f64 = 420.0;
const COMPACT_HEIGHT: f64 = 250.0;

/// The size from `tauri.conf.json`; going back to it has to be explicit,
/// because the compact card shrank the window.
const FULL_WIDTH: f64 = 1280.0;
const FULL_HEIGHT: f64 = 800.0;

fn main_window(app: &AppHandle) -> Result<WebviewWindow> {
    app.get_webview_window("main")
        .ok_or_else(|| LauncherError::internal("Окно лаунчера не найдено"))
}

fn failed(error: tauri::Error) -> LauncherError {
    LauncherError::internal("Не удалось изменить окно лаунчера").with_detail(error.to_string())
}

/// Shrinks the window to the launch card and shows it.
#[tauri::command]
pub fn shrink_launcher(app: AppHandle) -> Result<()> {
    let window = main_window(&app)?;
    // Order matters: the minimum size from the config would otherwise refuse
    // the smaller size.
    window.set_min_size(Some(LogicalSize::new(COMPACT_WIDTH, COMPACT_HEIGHT))).map_err(failed)?;
    window.set_resizable(false).map_err(failed)?;
    window.set_size(LogicalSize::new(COMPACT_WIDTH, COMPACT_HEIGHT)).map_err(failed)?;
    window.center().map_err(failed)?;
    window.show().map_err(failed)?;
    window.set_focus().map_err(failed)?;
    Ok(())
}

/// Gets out of the way while the game is running.
#[tauri::command]
pub fn hide_launcher(app: AppHandle) -> Result<()> {
    main_window(&app)?.hide().map_err(failed)
}

/// Steps aside without disappearing — for "minimise on launch".
#[tauri::command]
pub fn minimize_launcher(app: AppHandle) -> Result<()> {
    main_window(&app)?.minimize().map_err(failed)
}

/// Brings the whole launcher back, at its normal size.
#[tauri::command]
pub fn restore_launcher(app: AppHandle) -> Result<()> {
    let window = main_window(&app)?;
    window.set_min_size(Some(LogicalSize::new(940.0, 620.0))).map_err(failed)?;
    window.set_resizable(true).map_err(failed)?;
    window.set_size(LogicalSize::new(FULL_WIDTH, FULL_HEIGHT)).map_err(failed)?;
    window.center().map_err(failed)?;
    window.unminimize().map_err(failed)?;
    window.show().map_err(failed)?;
    window.set_focus().map_err(failed)?;
    Ok(())
}

/// Closes the launcher the same way the close button does, so downloads and
/// a running game are cleaned up rather than orphaned.
#[tauri::command]
pub fn quit_launcher(app: AppHandle) -> Result<()> {
    main_window(&app)?.close().map_err(failed)
}
