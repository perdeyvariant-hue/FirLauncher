//! Spawning the game, streaming its output and noticing when it dies badly.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Instant;

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::oneshot;

use crate::error::{ErrorKind, LauncherError, Result};

pub const EVENT_GAME_LOG: &str = "game://log";
pub const EVENT_GAME_STARTED: &str = "game://started";
pub const EVENT_GAME_EXIT: &str = "game://exit";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameLogEvent {
    pub instance_id: String,
    /// "stdout", "stderr" or "launcher" for our own messages.
    pub stream: String,
    pub line: String,
}

/// The game's process is up. The launcher has nothing left to do until it
/// exits, which is when a shortcut launch gets out of the way.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameStartedEvent {
    pub instance_id: String,
    pub pid: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameExitEvent {
    pub instance_id: String,
    pub exit_code: i32,
    pub crashed: bool,
    pub played_seconds: u64,
}

struct Running {
    pid: u32,
    started: Instant,
    kill: Option<oneshot::Sender<()>>,
}

/// The end of a game session's output, kept after the process exits so a
/// crash can be diagnosed from it.
pub struct SessionTail {
    pub started: std::time::SystemTime,
    pub lines: VecDeque<String>,
    pub exit_code: Option<i32>,
}

/// Enough to hold a loader's dependency report and a stack trace.
const TAIL_LINES: usize = 4000;

/// Which instances currently have a game process.
#[derive(Default)]
pub struct GameRegistry {
    running: Mutex<HashMap<String, Running>>,
    tails: Mutex<HashMap<String, Arc<Mutex<SessionTail>>>>,
}

impl GameRegistry {
    pub fn pid_of(&self, instance_id: &str) -> Option<u32> {
        self.running.lock().get(instance_id).map(|entry| entry.pid)
    }

    pub fn is_running(&self, instance_id: &str) -> bool {
        self.running.lock().contains_key(instance_id)
    }

    fn insert(&self, instance_id: String, entry: Running) {
        self.running.lock().insert(instance_id, entry);
    }

    fn take(&self, instance_id: &str) -> Option<Running> {
        self.running.lock().remove(instance_id)
    }

    /// Starts a fresh output record for a new session.
    fn begin_tail(&self, instance_id: &str) -> Arc<Mutex<SessionTail>> {
        let tail = Arc::new(Mutex::new(SessionTail {
            started: std::time::SystemTime::now(),
            lines: VecDeque::new(),
            exit_code: None,
        }));
        self.tails.lock().insert(instance_id.to_owned(), Arc::clone(&tail));
        tail
    }

    /// The last session's output, start time and exit code.
    pub fn last_session(&self, instance_id: &str) -> Option<(std::time::SystemTime, String, Option<i32>)> {
        let tail = self.tails.lock().get(instance_id).cloned()?;
        let tail = tail.lock();
        let text = tail.lines.iter().map(String::as_str).collect::<Vec<_>>().join("\n");
        Some((tail.started, text, tail.exit_code))
    }

    /// Asks the process to stop. The waiter task does the actual killing so
    /// the child handle never needs to be shared.
    pub fn kill(&self, instance_id: &str) -> Result<()> {
        let mut running = self.running.lock();
        let entry = running.get_mut(instance_id).ok_or_else(|| {
            LauncherError::new(ErrorKind::Instance, "Сборка сейчас не запущена")
        })?;
        match entry.kill.take() {
            Some(sender) => {
                let _ = sender.send(());
                Ok(())
            }
            // A second press while the first kill is in flight.
            None => Ok(()),
        }
    }

    pub fn kill_all(&self) {
        let mut running = self.running.lock();
        for entry in running.values_mut() {
            if let Some(sender) = entry.kill.take() {
                let _ = sender.send(());
            }
        }
    }
}

pub struct LaunchSpec {
    pub instance_id: String,
    pub java_binary: PathBuf,
    pub arguments: Vec<String>,
    pub working_dir: PathBuf,
    pub env: Vec<(String, String)>,
}

fn emit_log(app: &AppHandle, instance_id: &str, stream: &str, line: String) {
    let _ = app.emit(
        EVENT_GAME_LOG,
        GameLogEvent {
            instance_id: instance_id.to_owned(),
            stream: stream.to_owned(),
            line,
        },
    );
}

/// Forwards one pipe to the front end, line by line, until it closes, and
/// keeps the most recent lines for crash diagnosis.
fn pump<R>(
    app: AppHandle,
    instance_id: String,
    stream: &'static str,
    reader: R,
    tail: Arc<Mutex<SessionTail>>,
) where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        // `next_line` fails on invalid UTF-8; game logs on Windows locales are
        // not always clean, so stop pumping rather than spin on the error.
        while let Ok(Some(line)) = lines.next_line().await {
            {
                let mut tail = tail.lock();
                if tail.lines.len() == TAIL_LINES {
                    tail.lines.pop_front();
                }
                tail.lines.push_back(line.clone());
            }
            emit_log(&app, &instance_id, stream, line);
        }
    });
}

/// Starts the game and returns its pid. Output streaming, exit detection and
/// playtime accounting all run in background tasks.
pub async fn spawn_game(
    app: AppHandle,
    registry: Arc<GameRegistry>,
    spec: LaunchSpec,
    on_exit: impl FnOnce(u64, i32, bool) + Send + 'static,
) -> Result<u32> {
    if registry.is_running(&spec.instance_id) {
        return Err(LauncherError::new(
            ErrorKind::Instance,
            "Сборка уже запущена",
        ));
    }

    let mut command = tokio::process::Command::new(&spec.java_binary);
    command
        .args(&spec.arguments)
        .current_dir(&spec.working_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    for (key, value) in &spec.env {
        command.env(key, value);
    }

    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: javaw already hides the console, but a plain
        // java.exe would flash one.
        command.creation_flags(0x0800_0000);
    }

    let mut child = command.spawn().map_err(|error| {
        LauncherError::new(ErrorKind::Java, "Не удалось запустить Java")
            .with_detail(format!("{}\n{error}", spec.java_binary.display()))
    })?;

    let pid = child.id().unwrap_or_default();
    let (kill_tx, kill_rx) = oneshot::channel::<()>();
    let started = Instant::now();

    registry.insert(
        spec.instance_id.clone(),
        Running {
            pid,
            started,
            kill: Some(kill_tx),
        },
    );

    let _ = app.emit(
        EVENT_GAME_STARTED,
        GameStartedEvent {
            instance_id: spec.instance_id.clone(),
            pid,
        },
    );

    let tail = registry.begin_tail(&spec.instance_id);
    if let Some(stdout) = child.stdout.take() {
        pump(app.clone(), spec.instance_id.clone(), "stdout", stdout, Arc::clone(&tail));
    }
    if let Some(stderr) = child.stderr.take() {
        pump(app.clone(), spec.instance_id.clone(), "stderr", stderr, Arc::clone(&tail));
    }

    let instance_id = spec.instance_id.clone();
    tokio::spawn(async move {
        let status = tokio::select! {
            status = child.wait() => status,
            _ = kill_rx => {
                emit_log(&app, &instance_id, "launcher", String::from("Остановка по запросу пользователя"));
                let _ = child.kill().await;
                child.wait().await
            }
        };

        let exit_code = match status {
            Ok(status) => status.code().unwrap_or(-1),
            Err(error) => {
                emit_log(
                    &app,
                    &instance_id,
                    "launcher",
                    format!("Не удалось дождаться завершения игры: {error}"),
                );
                -1
            }
        };

        let played_seconds = registry
            .take(&instance_id)
            .map(|entry| entry.started.elapsed().as_secs())
            .unwrap_or_else(|| started.elapsed().as_secs());

        // Minecraft exits with 0 on a clean quit; anything else — including
        // the JVM's own 1 on a crash — means something went wrong.
        let crashed = exit_code != 0;
        tail.lock().exit_code = Some(exit_code);
        on_exit(played_seconds, exit_code, crashed);

        let _ = app.emit(
            EVENT_GAME_EXIT,
            GameExitEvent {
                instance_id: instance_id.clone(),
                exit_code,
                crashed,
                played_seconds,
            },
        );
    });

    Ok(pid)
}
