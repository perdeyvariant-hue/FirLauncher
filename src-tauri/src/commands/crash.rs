//! "Why did the game crash, and can we fix it?"

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use serde::Serialize;
use tauri::State;

use crate::error::{ErrorKind, LauncherError, Result};
use crate::instances::{self, contents, ModLoader};
use crate::minecraft::crash::{self, CrashFix, CrashInput, Diagnosis};
use crate::mods::index::ModIndex;
use crate::mods::{self, install, resolve, ProjectKind, ProviderId, Target};
use crate::state::AppState;
use crate::tasks::{Progress, TaskKind};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashAnalysis {
    pub diagnoses: Vec<Diagnosis>,
    /// The first error lines, for when no rule matched.
    pub excerpt: Vec<String>,
    pub exit_code: Option<i32>,
    /// The crash report written by this session, if any.
    pub crash_report: Option<String>,
}

/// The newest file in `dir` whose name matches, written after `since`.
async fn newest_since(dir: &Path, since: SystemTime, matches: impl Fn(&str) -> bool) -> Option<PathBuf> {
    let mut entries = tokio::fs::read_dir(dir).await.ok()?;
    let mut best: Option<(SystemTime, PathBuf)> = None;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !matches(&name) {
            continue;
        }
        let Ok(modified) = entry.metadata().await.and_then(|meta| meta.modified()) else {
            continue;
        };
        if modified >= since && best.as_ref().is_none_or(|(time, _)| modified > *time) {
            best = Some((modified, entry.path()));
        }
    }
    best.map(|(_, path)| path)
}

/// Large files are read only in part: the interesting bits are at the start
/// of a crash report and of an hs_err file.
async fn read_head(path: &Path) -> Option<String> {
    let bytes = tokio::fs::read(path).await.ok()?;
    let head = &bytes[..bytes.len().min(256 * 1024)];
    Some(String::from_utf8_lossy(head).into_owned())
}

#[tauri::command]
pub async fn diagnose_crash(state: State<'_, AppState>, instance_id: String) -> Result<CrashAnalysis> {
    let meta = instances::read_meta(&state.paths, &instance_id).await?;
    let game_dir = state.paths.instance_game_dir(&instance_id);

    // After a restart of the launcher the in-memory output is gone; the log
    // file on disk is the next best thing.
    let (started, mut log, exit_code) = match state.games.last_session(&instance_id) {
        Some(session) => session,
        None => (SystemTime::UNIX_EPOCH, String::new(), None),
    };
    if log.trim().is_empty() {
        log = read_head(&game_dir.join("logs").join("latest.log")).await.unwrap_or_default();
    }

    let report_path = newest_since(&game_dir.join("crash-reports"), started, |name| name.ends_with(".txt")).await;
    let crash_report = match &report_path {
        Some(path) => read_head(path).await,
        None => None,
    };
    let hs_err_path = newest_since(&game_dir, started, |name| {
        name.starts_with("hs_err_pid") && name.ends_with(".log")
    })
    .await;
    let hs_err = match &hs_err_path {
        Some(path) => read_head(path).await,
        None => None,
    };

    let settings = state.settings();
    let memory_mb = meta.java.memory_mb.unwrap_or(settings.default_memory_mb);
    let system = crate::java::system_memory();
    let input = CrashInput {
        log: &log,
        crash_report: crash_report.as_deref(),
        hs_err: hs_err.as_deref(),
        exit_code,
        memory_mb,
        system_memory_mb: system.total_mb,
    };
    let diagnoses = crash::diagnose(&input);
    let excerpt = crash::error_excerpt(&log, crash_report.as_deref());

    Ok(CrashAnalysis {
        diagnoses,
        excerpt,
        exit_code,
        crash_report: report_path.map(|path| path.to_string_lossy().into_owned()),
    })
}

/// Applies a fix from a diagnosis. Returns a line for the confirmation toast.
#[tauri::command]
pub async fn apply_crash_fix(
    state: State<'_, AppState>,
    instance_id: String,
    fix: CrashFix,
) -> Result<String> {
    let mut meta = instances::read_meta(&state.paths, &instance_id).await?;
    match fix {
        CrashFix::UseJava { major } => {
            meta.java.java_major = Some(major);
            // An explicit path would win over the major; the fix means "this Java".
            meta.java.java_path = None;
            instances::write_meta(&state.paths, &meta).await?;
            Ok(format!("Сборка будет запускаться на Java {major} — лаунчер скачает её при запуске"))
        }
        CrashFix::SetMemory { memory_mb } => {
            meta.java.memory_mb = Some(memory_mb);
            instances::write_meta(&state.paths, &meta).await?;
            Ok(format!("Выделено {memory_mb} МБ памяти"))
        }
        CrashFix::DisableMods { mod_ids } => {
            let files = contents::mod_files_by_id(&state.paths, &instance_id).await?;
            let mut disabled = Vec::new();
            for mod_id in &mod_ids {
                let Some(file) = files.get(mod_id) else { continue };
                if file.ends_with(".disabled") {
                    continue;
                }
                contents::set_mod_enabled(&state.paths, &instance_id, file, false).await?;
                disabled.push(file.clone());
            }
            if disabled.is_empty() {
                return Err(LauncherError::new(
                    ErrorKind::Instance,
                    format!("Не нашёл файлы модов {} в папке mods", mod_ids.join(", ")),
                ));
            }
            Ok(format!("Выключено: {}", disabled.join(", ")))
        }
        CrashFix::InstallMods { mod_ids } => install_missing(&state, &meta, &mod_ids).await,
    }
}

/// Finds each mod on Modrinth by id (Modrinth slugs are usually mod ids) and
/// installs the best fit with its dependencies.
async fn install_missing(
    state: &AppState,
    meta: &instances::InstanceMeta,
    mod_ids: &[String],
) -> Result<String> {
    if meta.loader == ModLoader::Vanilla {
        return Err(LauncherError::new(ErrorKind::Instance, "В ванильную сборку моды не ставятся"));
    }
    let provider = mods::provider(&state.settings(), &state.client(), ProviderId::Modrinth)?;
    let target = Target::for_instance(&meta.mc_version, meta.loader);
    let task = state.tasks.start(
        TaskKind::InstallMod,
        format!("Недостающие моды: {}", mod_ids.join(", ")),
        Some(meta.id.clone()),
    );

    let outcome = async {
        let mut installed: HashSet<String> = ModIndex::load(&state.paths, &meta.id, ProjectKind::Mod)
            .await?
            .projects(ProviderId::Modrinth);
        let mut versions = Vec::new();
        let mut not_found = Vec::new();
        for mod_id in mod_ids {
            // Mod ids use underscores where Modrinth slugs use dashes.
            let candidates = [mod_id.clone(), mod_id.replace('_', "-")];
            let mut plan = None;
            for slug in candidates.iter().collect::<std::collections::BTreeSet<_>>() {
                if let Ok(found) =
                    resolve::plan(provider.as_ref(), &target, ProjectKind::Mod, slug, None, &installed).await
                {
                    plan = Some(found);
                    break;
                }
            }
            match plan {
                Some(plan) => {
                    installed.insert(plan.primary.project_id.clone());
                    for dependency in &plan.dependencies {
                        installed.insert(dependency.project_id.clone());
                    }
                    versions.push(plan.primary);
                    versions.extend(plan.dependencies);
                }
                None => not_found.push(mod_id.clone()),
            }
        }
        if versions.is_empty() {
            return Err(LauncherError::new(
                ErrorKind::Provider,
                format!(
                    "На Modrinth нет версий {} для Minecraft {} — найдите их вручную",
                    not_found.join(", "),
                    meta.mc_version
                ),
            ));
        }
        install::install_versions(
            &state.client(),
            &state.paths,
            &meta.id,
            ProjectKind::Mod,
            &versions,
            state.settings().download_concurrency(),
            Arc::clone(&task) as Arc<dyn Progress>,
        )
        .await?;
        let names: Vec<String> = versions.iter().map(|version| version.name.clone()).collect();
        let mut message = format!("Установлено: {}", names.join(", "));
        if !not_found.is_empty() {
            message.push_str(&format!(". Не нашлись: {}", not_found.join(", ")));
        }
        Ok(message)
    }
    .await;

    match &outcome {
        Ok(_) => task.finish_ok(),
        Err(error) => task.finish_err(error),
    }
    outcome
}
