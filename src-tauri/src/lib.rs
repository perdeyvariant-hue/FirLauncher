//! FirLauncher backend.
//!
//! The download core and vanilla launching (stage 2), Microsoft accounts with
//! keyring-backed tokens (stage 3), the Fabric, Quilt, Forge and NeoForge
//! loaders (stage 4), the Modrinth/CurseForge browser for mods, resource
//! packs and shaders (stage 5) and pack import/export (stage 6).

// Production paths must surface real errors instead of panicking.
#![deny(clippy::unwrap_used, clippy::expect_used)]

pub mod accounts;
pub mod appearance;
pub mod auth;
pub mod commands;
pub mod config;
pub mod error;
pub mod instances;
pub mod java;
pub mod loaders;
pub mod minecraft;
pub mod mods;
pub mod net;
pub mod packs;
pub mod paths;
pub mod presence;
pub mod shortcuts;
pub mod state;
pub mod tasks;

use serde::Serialize;
use tauri::{Emitter, Manager, WindowEvent};

use crate::config::settings::Settings;
use crate::error::Result;
use crate::paths::Paths;
use crate::state::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub data_dir: String,
    pub platform: String,
    pub arch: String,
}

/// Lets the UI show where data lives and which build is running.
#[tauri::command]
fn app_info(state: tauri::State<'_, AppState>) -> Result<AppInfo> {
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").to_owned(),
        data_dir: state.paths.root().display().to_string(),
        platform: std::env::consts::OS.to_owned(),
        arch: std::env::consts::ARCH.to_owned(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        // First: a second start (a desktop shortcut) hands its arguments to
        // the running launcher instead of opening another window.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            use tauri::{Emitter, Manager};
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            if let Some(id) = shortcuts::launch_target(&args) {
                let _ = app.emit(shortcuts::EVENT_LAUNCH_REQUEST, id);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Settings may redirect the data directory, so they are read from
            // the default location first and the paths re-resolved after.
            let default_paths = Paths::resolve(None)?;
            default_paths.ensure()?;

            let settings = tauri::async_runtime::block_on(Settings::load(&default_paths))?;
            let paths = Paths::resolve(Some(settings.data_dir_override.as_str()))?;
            paths.ensure()?;

            let state = AppState::new(app.handle().clone(), paths, settings)?;
            app.manage(state);

            // Renew stale Microsoft sessions in the background so names and
            // skins are current and the first launch needs no network hop.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = handle.state::<AppState>();
                let changed =
                    auth::refresh_stale_accounts(&state.client(), &state.paths, &state.secrets)
                        .await;
                if changed {
                    let _ = handle.emit(auth::EVENT_ACCOUNTS_CHANGED, ());
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::CloseRequested { .. }) {
                // Leaving orphaned downloads or a headless game behind would
                // be worse than a slightly slower shutdown.
                if let Some(state) = window.try_state::<AppState>() {
                    state.tasks.cancel_all();
                    state.games.kill_all();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            commands::settings::load_settings,
            commands::settings::save_settings,
            commands::settings::build_info,
            commands::appearance::set_appearance_image,
            commands::appearance::appearance_image,
            commands::appearance::clear_appearance_image,
            commands::appearance::list_custom_mascots,
            commands::appearance::add_custom_mascot,
            commands::appearance::remove_custom_mascot,
            commands::appearance::account_figure,
            commands::crash::diagnose_crash,
            commands::crash::apply_crash_fix,
            commands::logs::share_log,
            commands::tasks::list_tasks,
            commands::tasks::cancel_task,
            commands::tasks::retry_task,
            commands::meta::list_minecraft_versions,
            commands::meta::list_java_runtimes,
            commands::meta::system_memory,
            commands::meta::list_loader_versions,
            commands::accounts::list_accounts,
            commands::accounts::add_offline_account,
            commands::accounts::remove_account,
            commands::accounts::refresh_account,
            commands::accounts::begin_microsoft_login,
            commands::accounts::cancel_microsoft_login,
            commands::instances::list_instances,
            commands::instances::create_instance,
            commands::instances::update_instance,
            commands::instances::delete_instance,
            commands::instances::duplicate_instance,
            commands::instances::open_instance_folder,
            commands::instances::launch_instance,
            commands::instances::kill_instance,
            commands::instances::list_installed_mods,
            commands::instances::set_mod_enabled,
            commands::instances::remove_mod,
            commands::instances::list_worlds,
            commands::instances::list_world_backups,
            commands::instances::backup_world,
            commands::instances::restore_world_backup,
            commands::instances::delete_world_backup,
            commands::instances::import_world,
            commands::instances::delete_world,
            commands::instances::list_servers,
            commands::instances::add_server,
            commands::instances::remove_server,
            commands::instances::ping_server,
            commands::instances::add_content_file,
            commands::instances::create_desktop_shortcut,
            commands::instances::take_startup_launch,
            commands::instances::list_resource_packs,
            commands::instances::list_shader_packs,
            commands::instances::list_screenshots,
            commands::instances::read_recent_log,
            commands::mods::available_providers,
            commands::mods::search_projects,
            commands::mods::list_categories,
            commands::mods::installed_projects,
            commands::mods::resolve_install,
            commands::mods::install_plan,
            commands::mods::list_versions,
            commands::mods::project_details,
            commands::mods::check_updates,
            commands::mods::apply_updates,
            commands::mods::optimize_plan,
            commands::mods::apply_optimize,
            commands::mods::remove_content,
            commands::packs::import_pack,
            commands::packs::install_modpack,
            commands::packs::export_instance,
            commands::packs::modpack_info,
            commands::packs::check_modpack_update,
            commands::packs::update_modpack,
        ])
        .run(tauri::generate_context!());

    if let Err(error) = result {
        eprintln!("FirLauncher failed to start: {error}");
        std::process::exit(1);
    }
}
