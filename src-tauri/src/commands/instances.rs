use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::accounts::AccountStore;
use crate::error::{ErrorKind, LauncherError, Result};
use crate::instances::contents::{
    InstalledMod, ResourcePackEntry, ScreenshotEntry, WorldEntry,
};
use crate::instances::{self, contents, CreateInstanceInput, InstanceDto, InstanceMeta, InstanceStatus};
use crate::state::AppState;

/// Attaches live status and the rendered icon to stored metadata.
pub(crate) async fn to_dto(state: &AppState, meta: InstanceMeta) -> InstanceDto {
    let status = match state.games.pid_of(&meta.id) {
        Some(pid) => InstanceStatus::Running { pid },
        None => InstanceStatus::Idle,
    };
    let icon_path = instances::icon_data_url(&state.paths, &meta).await;
    InstanceDto {
        meta,
        status,
        icon_path,
    }
}

#[tauri::command]
pub async fn list_instances(state: State<'_, AppState>) -> Result<Vec<InstanceDto>> {
    let metas = instances::list_metas(&state.paths).await?;
    let mut dtos = Vec::with_capacity(metas.len());
    for meta in metas {
        dtos.push(to_dto(&state, meta).await);
    }
    Ok(dtos)
}

#[tauri::command]
pub async fn create_instance(
    state: State<'_, AppState>,
    input: CreateInstanceInput,
) -> Result<InstanceDto> {
    // The loader itself is installed on first launch; here we only make sure
    // there is something to install.
    let needs_version = input.loader != instances::ModLoader::Vanilla;
    let has_version = input
        .loader_version
        .as_deref()
        .is_some_and(|version| !version.trim().is_empty());
    if needs_version && !has_version {
        return Err(LauncherError::new(
            ErrorKind::Instance,
            format!("Выберите версию {}", input.loader.label()),
        ));
    }
    let meta = instances::create(&state.paths, input).await?;
    Ok(to_dto(&state, meta).await)
}

#[tauri::command]
pub async fn update_instance(
    state: State<'_, AppState>,
    instance: InstanceMeta,
) -> Result<InstanceDto> {
    // The id is a directory name; refuse silent renames through this path.
    let existing = instances::read_meta(&state.paths, &instance.id).await?;
    let merged = InstanceMeta {
        created_at: existing.created_at,
        last_played_at: existing.last_played_at,
        total_play_seconds: existing.total_play_seconds,
        // The UI sends back the rendered data URL, never the stored file name.
        icon_file: existing.icon_file,
        ..instance
    };
    instances::write_meta(&state.paths, &merged).await?;
    Ok(to_dto(&state, merged).await)
}

#[tauri::command]
pub async fn delete_instance(state: State<'_, AppState>, id: String) -> Result<()> {
    if state.games.is_running(&id) {
        return Err(LauncherError::new(
            ErrorKind::Instance,
            "Сначала остановите игру",
        ));
    }
    instances::delete(&state.paths, &id).await
}

#[tauri::command]
pub async fn duplicate_instance(
    state: State<'_, AppState>,
    id: String,
    new_name: String,
) -> Result<InstanceDto> {
    let meta = instances::duplicate(&state.paths, &id, &new_name).await?;
    Ok(to_dto(&state, meta).await)
}

#[tauri::command]
pub async fn open_instance_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;

    let dir = state.paths.instance_game_dir(&id);
    instances::ensure_layout(&state.paths, &id).await?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| {
            LauncherError::io("Не удалось открыть папку").with_detail(error.to_string())
        })
}

#[tauri::command]
pub async fn list_installed_mods(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<InstalledMod>> {
    contents::list_mods(&state.paths, &id).await
}

#[tauri::command]
pub async fn set_mod_enabled(
    state: State<'_, AppState>,
    id: String,
    file_name: String,
    enabled: bool,
) -> Result<()> {
    contents::set_mod_enabled(&state.paths, &id, &file_name, enabled).await
}

#[tauri::command]
pub async fn remove_mod(
    state: State<'_, AppState>,
    id: String,
    file_name: String,
) -> Result<()> {
    contents::remove_mod(&state.paths, &id, &file_name).await
}

#[tauri::command]
pub async fn list_worlds(state: State<'_, AppState>, id: String) -> Result<Vec<WorldEntry>> {
    contents::list_worlds(&state.paths, &id).await
}

#[tauri::command]
pub async fn list_resource_packs(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<ResourcePackEntry>> {
    contents::list_resource_packs(&state.paths, &id).await
}

#[tauri::command]
pub async fn list_shader_packs(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<ResourcePackEntry>> {
    contents::list_shader_packs(&state.paths, &id).await
}

#[tauri::command]
pub async fn list_screenshots(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<ScreenshotEntry>> {
    contents::list_screenshots(&state.paths, &id).await
}

#[tauri::command]
pub async fn read_recent_log(state: State<'_, AppState>, id: String) -> Result<Vec<String>> {
    contents::read_recent_log(&state.paths, &id, 2000).await
}

#[tauri::command]
pub async fn kill_instance(state: State<'_, AppState>, id: String) -> Result<()> {
    state.games.kill(&id)
}

#[allow(clippy::too_many_arguments)]
async fn run_launch(
    app: AppHandle,
    paths: crate::paths::Paths,
    client: reqwest::Client,
    settings: crate::config::settings::Settings,
    games: Arc<crate::minecraft::launch::GameRegistry>,
    task: Arc<crate::tasks::TaskHandle>,
    secrets: crate::auth::secrets::SecretStore,
    meta: InstanceMeta,
    account: crate::accounts::Account,
    server: Option<String>,
    presence: Arc<crate::presence::Presence>,
) -> Result<()> {
    use crate::minecraft::{install, servers, session};
    use crate::tasks::Progress;
    use tauri::Emitter;

    instances::ensure_layout(&paths, &meta.id).await?;

    let progress = Arc::clone(&task) as Arc<dyn Progress>;
    let mut meta = meta;

    // The account comes first: an expired Microsoft session should fail in a
    // second, not after half a gigabyte of assets.
    progress.set_stage(String::from("Проверка аккаунта"));
    let game_session =
        crate::auth::session_for(&client, &paths, &secrets, &account).await;
    // A refresh may have renamed the player, changed the skin or marked the
    // account expired; let the sidebar catch up either way.
    let _ = app.emit(crate::auth::EVENT_ACCOUNTS_CHANGED, ());
    let game_session = game_session?;
    // A loader is installed on first launch (and repaired if its profile went
    // missing); afterwards this is a single file-existence check.
    let loader_ctx = crate::loaders::LoaderContext {
        client: &client,
        paths: &paths,
        concurrency: settings.download_concurrency(),
        progress: Arc::clone(&progress),
        instance_id: &meta.id,
    };
    let profile_id = crate::loaders::ensure_profile(&loader_ctx, &meta).await?;
    if meta.loader != instances::ModLoader::Vanilla && meta.profile_id.as_deref() != Some(&profile_id)
    {
        meta.profile_id = Some(profile_id.clone());
        instances::write_meta(&paths, &meta).await?;
    }

    let installed = install::ensure_installed(
        &client,
        &paths,
        &meta.id,
        &profile_id,
        settings.download_concurrency(),
        Arc::clone(&progress),
    )
    .await?;
    progress.check_cancelled()?;

    let required = meta
        .java
        .java_major
        .unwrap_or_else(|| crate::java::major_for_declared(installed.version.required_java_major()));
    let java_binary = session::resolve_java(
        &client,
        &paths,
        meta.java.java_path.as_deref(),
        required,
        Arc::clone(&progress),
    )
    .await?;

    progress.set_stage(String::from("Запуск игры"));
    let mut spec = session::build_spec(
        &paths,
        &meta,
        &game_session,
        &settings,
        &installed,
        java_binary,
    )?;
    if let Some(server) = server.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        // Versions with Quick Play declare the argument in their profile.
        let quick_play = serde_json::to_string(&installed.version.arguments)
            .is_ok_and(|text| text.contains("quickPlayMultiplayer"));
        spec.arguments.extend(servers::join_arguments(server, quick_play));
    }

    let exit_paths = paths.clone();
    let exit_id = meta.id.clone();
    let exit_presence = Arc::clone(&presence);
    crate::minecraft::launch::spawn_game(app, games, spec, move |played_seconds, _code, _crashed| {
        exit_presence.stop();
        // Playtime is only worth recording for a session that actually ran.
        tokio::spawn(async move {
            if played_seconds < 5 {
                return;
            }
            if let Ok(mut current) = instances::read_meta(&exit_paths, &exit_id).await {
                current.total_play_seconds += played_seconds;
                current.last_played_at = Some(chrono::Utc::now().to_rfc3339());
                let _ = instances::write_meta(&exit_paths, &current).await;
            }
        });
    })
    .await?;

    if settings.discord_presence {
        if let Some(app_id) = crate::presence::app_id(&settings) {
            let loader = match meta.loader {
                instances::ModLoader::Vanilla => String::new(),
                other => format!(" {}", other.label()),
            };
            presence.play(crate::presence::Playing {
                app_id,
                instance_name: meta.name.clone(),
                detail: format!("Minecraft {}{loader}", meta.mc_version),
                started_at: chrono::Utc::now().timestamp_millis(),
            });
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn launch_instance(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    account_id: String,
    server: Option<String>,
) -> Result<()> {
    use crate::tasks::TaskKind;

    if state.games.is_running(&id) {
        return Err(LauncherError::new(
            ErrorKind::Instance,
            "Сборка уже запущена",
        ));
    }

    // Validate synchronously so an obvious mistake is a plain error rather
    // than a failed task in the bottom bar.
    let meta = instances::read_meta(&state.paths, &id).await?;
    let account = AccountStore::load(&state.paths)
        .await?
        .find(&account_id)
        .cloned()
        .ok_or_else(|| LauncherError::new(ErrorKind::Auth, "Аккаунт не найден"))?;

    let task = state.tasks.start(
        TaskKind::InstallVersion,
        format!("{} · {}", meta.name, meta.mc_version),
        Some(id.clone()),
    );

    let paths = state.paths.clone();
    let client = state.client();
    let settings = state.settings();
    let games = Arc::clone(&state.games);
    let secrets = state.secrets.clone();
    let presence = Arc::clone(&state.presence);
    let worker = Arc::clone(&task);

    // The install can take minutes; the command returns now and the UI
    // follows the task events.
    tokio::spawn(async move {
        match run_launch(
            app,
            paths,
            client,
            settings,
            games,
            Arc::clone(&worker),
            secrets,
            meta,
            account,
            server,
            presence,
        )
        .await
        {
            Ok(()) => worker.finish_ok(),
            Err(error) => worker.finish_err(&error),
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn list_world_backups(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<instances::worlds::WorldBackup>> {
    instances::worlds::list(&state.paths, &id).await
}

#[tauri::command]
pub async fn backup_world(
    state: State<'_, AppState>,
    id: String,
    world: String,
) -> Result<instances::worlds::WorldBackup> {
    if state.games.is_running(&id) {
        return Err(LauncherError::new(
            ErrorKind::Instance,
            "Закройте игру: копия мира во время игры может получиться повреждённой",
        ));
    }
    instances::worlds::backup(&state.paths, &id, &world, false).await
}

/// Returns the restored world's folder name.
#[tauri::command]
pub async fn restore_world_backup(state: State<'_, AppState>, id: String, file_name: String) -> Result<String> {
    if state.games.is_running(&id) {
        return Err(LauncherError::new(ErrorKind::Instance, "Закройте игру перед восстановлением мира"));
    }
    instances::worlds::restore(&state.paths, &id, &file_name).await
}

#[tauri::command]
pub async fn delete_world_backup(state: State<'_, AppState>, id: String, file_name: String) -> Result<()> {
    instances::worlds::delete_backup(&state.paths, &id, &file_name).await
}

/// Returns the imported world's folder name.
#[tauri::command]
pub async fn import_world(state: State<'_, AppState>, id: String, path: String) -> Result<String> {
    instances::worlds::import(&state.paths, &id, std::path::Path::new(&path)).await
}

#[tauri::command]
pub async fn delete_world(state: State<'_, AppState>, id: String, world: String) -> Result<()> {
    if state.games.is_running(&id) {
        return Err(LauncherError::new(ErrorKind::Instance, "Закройте игру перед удалением мира"));
    }
    instances::worlds::delete_world(&state.paths, &id, &world).await
}

fn servers_file(state: &AppState, id: &str) -> std::path::PathBuf {
    state.paths.instance_game_dir(id).join("servers.dat")
}

#[tauri::command]
pub async fn list_servers(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<crate::minecraft::servers::ServerEntry>> {
    Ok(crate::minecraft::servers::load(&servers_file(&state, &id)).await?.1)
}

#[tauri::command]
pub async fn add_server(state: State<'_, AppState>, id: String, name: String, address: String) -> Result<()> {
    let address = address.trim();
    if address.is_empty() {
        return Err(LauncherError::new(ErrorKind::Instance, "Укажите адрес сервера"));
    }
    if state.games.is_running(&id) {
        // The game rewrites servers.dat on exit and would drop the new entry.
        return Err(LauncherError::new(ErrorKind::Instance, "Закройте игру, чтобы изменить список серверов"));
    }
    let name = if name.trim().is_empty() { address } else { name.trim() };
    crate::minecraft::servers::add(&servers_file(&state, &id), name, address).await
}

#[tauri::command]
pub async fn remove_server(state: State<'_, AppState>, id: String, index: usize) -> Result<()> {
    if state.games.is_running(&id) {
        return Err(LauncherError::new(ErrorKind::Instance, "Закройте игру, чтобы изменить список серверов"));
    }
    crate::minecraft::servers::remove(&servers_file(&state, &id), index).await
}

#[tauri::command]
pub async fn ping_server(address: String) -> Result<crate::minecraft::servers::ServerStatus> {
    crate::minecraft::servers::ping(&address).await
}

/// Copies a dropped or picked file into the content folder of an instance
/// (`mods/`, `resourcepacks/`, `shaderpacks/`). Returns the file name.
#[tauri::command]
pub async fn add_content_file(
    state: State<'_, AppState>,
    id: String,
    kind: crate::mods::ProjectKind,
    path: String,
) -> Result<String> {
    use crate::mods::ProjectKind;
    let source = std::path::Path::new(&path);
    let file_name = source
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or_else(|| LauncherError::new(ErrorKind::Io, "Не удалось прочитать имя файла"))?;
    let expected = match kind {
        ProjectKind::Mod => ".jar",
        ProjectKind::ResourcePack | ProjectKind::Shader => ".zip",
        ProjectKind::Modpack => {
            return Err(LauncherError::new(ErrorKind::Instance, "Модпак импортируется как новая сборка"));
        }
    };
    if !file_name.to_ascii_lowercase().ends_with(expected) {
        return Err(LauncherError::new(
            ErrorKind::Instance,
            format!("Сюда подходят только файлы {expected}: {file_name}"),
        ));
    }
    let dir = state.paths.instance_game_dir(&id).join(kind.folder());
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|error| LauncherError::io("Не удалось создать папку").with_detail(error.to_string()))?;
    let target = dir.join(&file_name);
    if target.exists() || dir.join(format!("{file_name}.disabled")).exists() {
        return Err(LauncherError::new(ErrorKind::Instance, format!("{file_name} уже есть в сборке")));
    }
    tokio::fs::copy(source, &target)
        .await
        .map_err(|error| LauncherError::io(format!("Не удалось скопировать {file_name}")).with_detail(error.to_string()))?;
    Ok(file_name)
}

/// Puts a shortcut on the desktop that starts this instance directly.
#[tauri::command]
pub async fn create_desktop_shortcut(state: State<'_, AppState>, id: String) -> Result<String> {
    let meta = instances::read_meta(&state.paths, &id).await?;
    let path = crate::shortcuts::create(&meta.id, &meta.name).await?;
    Ok(path.display().to_string())
}

/// The instance the launcher was started for (`--launch <id>`), once.
#[tauri::command]
pub fn take_startup_launch() -> Option<String> {
    static TAKEN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if TAKEN.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return None;
    }
    let args: Vec<String> = std::env::args().collect();
    crate::shortcuts::launch_target(&args)
}
