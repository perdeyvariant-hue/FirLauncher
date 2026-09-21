//! Turning an installed version plus an instance and an account into the exact
//! process invocation.
//!
//! Shared by the `launch_instance` command and the headless smoke check, so
//! what is verified is what actually runs.

use std::sync::Arc;

use crate::auth::GameSession;
use crate::config::settings::Settings;
use crate::error::{ErrorKind, LauncherError, Result};
use crate::instances::InstanceMeta;
use crate::java;
use crate::paths::Paths;
use crate::tasks::Progress;

use super::args;
use super::install::InstalledVersion;
use super::launch::LaunchSpec;

/// Picks the JVM: an explicit override, a detected one, or a fresh download.
pub async fn resolve_java(
    client: &reqwest::Client,
    paths: &Paths,
    java_override: Option<&str>,
    required_major: u32,
    task: Arc<dyn Progress>,
) -> Result<std::path::PathBuf> {
    if let Some(explicit) = java_override.map(str::trim).filter(|value| !value.is_empty()) {
        let path = std::path::PathBuf::from(explicit);
        if !path.is_file() {
            return Err(
                LauncherError::new(ErrorKind::Java, "Указанный путь к Java не существует")
                    .with_detail(path.display().to_string()),
            );
        }
        return Ok(path);
    }

    task.set_stage(String::from("Поиск Java"));
    let scan_paths = paths.clone();
    let detected = tokio::task::spawn_blocking(move || java::detect::detect_all(&scan_paths))
        .await
        .map_err(|error| {
            LauncherError::internal("Сбой поиска Java").with_detail(error.to_string())
        })??;

    if let Some(runtime) = java::pick_exact(&detected, required_major) {
        return Ok(std::path::PathBuf::from(&runtime.path));
    }

    match java::adoptium::install(client, paths, required_major, Arc::clone(&task)).await {
        Ok(installed) => Ok(std::path::PathBuf::from(installed.path)),
        Err(error) => {
            // Adoptium has no build for some platform/version pairs, and the
            // machine may simply be offline. A newer JVM can misbehave on old
            // versions, but refusing to start at all is worse.
            match java::pick_fallback(&detected, required_major) {
                Some(runtime) => {
                    task.set_stage(format!(
                        "Java {required_major} недоступна, запуск на Java {}",
                        runtime.major
                    ));
                    Ok(std::path::PathBuf::from(&runtime.path))
                }
                None => Err(error),
            }
        }
    }
}

/// Builds the argument vector: JVM flags, main class, then game options.
pub fn build_arguments(
    installed: &InstalledVersion,
    context: &args::LaunchContext,
    memory_mb: u32,
    extra_jvm_args: &str,
) -> Result<Vec<String>> {
    let version = &installed.version;
    let main_class = version
        .main_class
        .clone()
        .ok_or_else(|| LauncherError::new(ErrorKind::Parse, "В описании версии нет mainClass"))?;

    let mut arguments = args::build_jvm_args(version, context);
    arguments.extend(args::memory_args(memory_mb));
    // User flags go last so they can override anything above them.
    arguments.extend(args::split_user_args(extra_jvm_args));
    arguments.push(main_class);

    let mut game = args::build_game_args(version, context);
    if let Some((width, height)) = context.resolution {
        // Pre-1.13 profiles carry no conditional resolution arguments.
        if !game.iter().any(|arg| arg == "--width") {
            game.push(String::from("--width"));
            game.push(width.to_string());
            game.push(String::from("--height"));
            game.push(height.to_string());
        }
    }
    arguments.extend(game);

    Ok(arguments)
}

/// Assembles the full process spec for one launch.
pub fn build_spec(
    paths: &Paths,
    meta: &InstanceMeta,
    session: &GameSession,
    settings: &Settings,
    installed: &InstalledVersion,
    java_binary: std::path::PathBuf,
) -> Result<LaunchSpec> {
    let game_dir = paths.instance_game_dir(&meta.id);

    let context = args::LaunchContext {
        player_name: session.username.clone(),
        player_uuid: session.uuid.clone(),
        access_token: session.access_token.clone(),
        user_type: session.user_type.clone(),
        xuid: session.xuid.clone(),
        client_id: String::new(),
        version_name: installed.version.id.clone(),
        version_type: installed
            .version
            .version_type
            .clone()
            .unwrap_or_else(|| String::from("release")),
        game_dir: args::path_string(&game_dir),
        assets_dir: args::path_string(&installed.assets_dir),
        assets_index_name: installed.assets_index.clone(),
        natives_dir: args::path_string(&installed.natives_dir),
        libraries_dir: args::path_string(&paths.libraries()),
        classpath: args::join_classpath(&installed.classpath),
        resolution: meta
            .java
            .window
            .filter(|window| !window.fullscreen)
            .map(|window| (window.width, window.height)),
    };

    let memory_mb = meta.java.memory_mb.unwrap_or(settings.default_memory_mb);
    let extra = meta
        .java
        .extra_jvm_args
        .clone()
        .unwrap_or_else(|| settings.default_jvm_args.clone());

    let mut arguments = build_arguments(installed, &context, memory_mb, &extra)?;
    if meta.java.window.is_some_and(|window| window.fullscreen) {
        arguments.push(String::from("--fullscreen"));
    }

    Ok(LaunchSpec {
        instance_id: meta.id.clone(),
        java_binary,
        arguments,
        working_dir: game_dir,
        env: meta.java.env.clone().into_iter().collect(),
    })
}
