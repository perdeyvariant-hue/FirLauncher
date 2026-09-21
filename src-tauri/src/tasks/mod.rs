//! Long-running work, as the UI sees it.
//!
//! Anything that downloads or installs runs under a task: it owns a
//! cancellation token, accumulates byte counts and pushes `task://update`
//! events to the front end. The bottom bar is a direct rendering of this
//! registry.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::error::{ErrorKind, LauncherError, Result};
use crate::net::download::ProgressSink;

pub const EVENT_TASK_UPDATE: &str = "task://update";
pub const EVENT_TASK_FINISHED: &str = "task://finished";

/// Byte-progress events are throttled to this interval; stage changes and
/// terminal states always emit immediately.
const EMIT_INTERVAL: Duration = Duration::from_millis(120);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum TaskKind {
    InstallVersion,
    InstallLoader,
    InstallJava,
    InstallMod,
    ImportPack,
    ExportPack,
    RefreshMeta,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskState {
    Queued,
    Running,
    Paused,
    Succeeded,
    Failed,
    Cancelled,
}

impl TaskState {
    fn is_terminal(self) -> bool {
        matches!(
            self,
            TaskState::Succeeded | TaskState::Failed | TaskState::Cancelled
        )
    }
}

/// Exactly the shape of `Task` in `src/types/task.ts`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDto {
    pub id: String,
    pub kind: TaskKind,
    pub title: String,
    pub stage: String,
    pub state: TaskState,
    pub progress: Option<f64>,
    pub bytes_done: u64,
    pub bytes_total: Option<u64>,
    pub bytes_per_second: Option<f64>,
    pub error: Option<String>,
    pub cancellable: bool,
    pub instance_id: Option<String>,
}

struct Entry {
    dto: TaskDto,
    token: CancellationToken,
}

pub struct TaskManager {
    app: AppHandle,
    entries: Mutex<HashMap<String, Entry>>,
}

impl TaskManager {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            entries: Mutex::new(HashMap::new()),
        }
    }

    /// Registers a task and hands back the handle the worker reports through.
    pub fn start(
        self: &Arc<Self>,
        kind: TaskKind,
        title: impl Into<String>,
        instance_id: Option<String>,
    ) -> Arc<TaskHandle> {
        let id = Uuid::new_v4().to_string();
        let token = CancellationToken::new();
        let dto = TaskDto {
            id: id.clone(),
            kind,
            title: title.into(),
            stage: String::from("Подготовка"),
            state: TaskState::Running,
            progress: None,
            bytes_done: 0,
            bytes_total: None,
            bytes_per_second: None,
            error: None,
            cancellable: true,
            instance_id,
        };

        self.entries.lock().insert(
            id.clone(),
            Entry {
                dto: dto.clone(),
                token: token.clone(),
            },
        );
        let _ = self.app.emit(EVENT_TASK_UPDATE, &dto);

        Arc::new(TaskHandle {
            manager: Arc::clone(self),
            id,
            token,
            bytes_done: AtomicU64::new(0),
            started: Instant::now(),
            last_emit: Mutex::new(Instant::now()),
        })
    }

    pub fn snapshot(&self) -> Vec<TaskDto> {
        let entries = self.entries.lock();
        let mut tasks: Vec<TaskDto> = entries.values().map(|entry| entry.dto.clone()).collect();
        tasks.sort_by(|a, b| a.title.cmp(&b.title));
        tasks
    }

    pub fn cancel(&self, id: &str) -> Result<()> {
        let entries = self.entries.lock();
        match entries.get(id) {
            Some(entry) => {
                entry.token.cancel();
                Ok(())
            }
            None => Err(LauncherError::new(
                ErrorKind::Internal,
                "Задача уже завершена",
            )),
        }
    }

    /// Cancels everything — used when the window is closing.
    pub fn cancel_all(&self) {
        for entry in self.entries.lock().values() {
            entry.token.cancel();
        }
    }

    fn mutate(&self, id: &str, apply: impl FnOnce(&mut TaskDto)) -> Option<TaskDto> {
        let mut entries = self.entries.lock();
        let entry = entries.get_mut(id)?;
        apply(&mut entry.dto);
        Some(entry.dto.clone())
    }

    fn forget(&self, id: &str) {
        self.entries.lock().remove(id);
    }
}

/// The worker side of a task.
pub struct TaskHandle {
    manager: Arc<TaskManager>,
    id: String,
    token: CancellationToken,
    bytes_done: AtomicU64,
    started: Instant,
    last_emit: Mutex<Instant>,
}

impl TaskHandle {
    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn token(&self) -> CancellationToken {
        self.token.clone()
    }

    /// Fails fast when the user pressed cancel, so callers can just use `?`.
    pub fn check_cancelled(&self) -> Result<()> {
        if self.token.is_cancelled() {
            return Err(LauncherError::new(ErrorKind::Cancelled, "Операция отменена"));
        }
        Ok(())
    }

    pub fn set_stage(&self, stage: impl Into<String>) {
        let stage = stage.into();
        if let Some(dto) = self.manager.mutate(&self.id, |dto| dto.stage = stage) {
            self.emit_now(&dto);
        }
    }

    /// Resets the byte counters for a new phase (libraries, then assets, ...).
    pub fn begin_phase(&self, stage: impl Into<String>, bytes_total: Option<u64>) {
        self.bytes_done.store(0, Ordering::Relaxed);
        let stage = stage.into();
        if let Some(dto) = self.manager.mutate(&self.id, |dto| {
            dto.stage = stage;
            dto.bytes_done = 0;
            dto.bytes_total = bytes_total;
            dto.progress = bytes_total.map(|_| 0.0);
        }) {
            self.emit_now(&dto);
        }
    }

    pub fn finish_ok(&self) {
        if let Some(mut dto) = self.manager.mutate(&self.id, |dto| {
            dto.state = TaskState::Succeeded;
            dto.progress = Some(1.0);
            dto.stage = String::from("Готово");
            dto.cancellable = false;
        }) {
            dto.bytes_per_second = None;
            let _ = self.manager.app.emit(EVENT_TASK_UPDATE, &dto);
            let _ = self.manager.app.emit(EVENT_TASK_FINISHED, &dto);
        }
        self.manager.forget(&self.id);
    }

    pub fn finish_err(&self, error: &LauncherError) {
        let cancelled = error.kind == ErrorKind::Cancelled;
        if let Some(dto) = self.manager.mutate(&self.id, |dto| {
            dto.state = if cancelled {
                TaskState::Cancelled
            } else {
                TaskState::Failed
            };
            dto.stage = if cancelled {
                String::from("Отменено")
            } else {
                String::from("Ошибка")
            };
            dto.error = Some(match &error.detail {
                Some(detail) => format!("{}\n{detail}", error.message),
                None => error.message.clone(),
            });
            dto.cancellable = false;
        }) {
            let _ = self.manager.app.emit(EVENT_TASK_UPDATE, &dto);
            let _ = self.manager.app.emit(EVENT_TASK_FINISHED, &dto);
        }
        self.manager.forget(&self.id);
    }
}

impl TaskHandle {
    fn emit_now(&self, dto: &TaskDto) {
        *self.last_emit.lock() = Instant::now();
        let _ = self.manager.app.emit(EVENT_TASK_UPDATE, dto);
    }

    fn throttled_emit(&self) {
        {
            let mut last = self.last_emit.lock();
            if last.elapsed() < EMIT_INTERVAL {
                return;
            }
            *last = Instant::now();
        }

        let done = self.bytes_done.load(Ordering::Relaxed);
        let elapsed = self.started.elapsed().as_secs_f64().max(0.001);
        let speed = done as f64 / elapsed;

        if let Some(dto) = self.manager.mutate(&self.id, |dto| {
            dto.bytes_done = done;
            dto.bytes_per_second = Some(speed);
            // Some manifests omit sizes (Fabric libraries fetched by Maven
            // coordinates), so the real total can outgrow the declared one;
            // never show "87 MB of 84 MB".
            dto.bytes_total = dto.bytes_total.map(|total| total.max(done));
            dto.progress = dto.bytes_total.and_then(|total| {
                if total == 0 {
                    None
                } else {
                    Some((done as f64 / total as f64).clamp(0.0, 1.0))
                }
            });
        }) {
            if !dto.state.is_terminal() {
                let _ = self.manager.app.emit(EVENT_TASK_UPDATE, &dto);
            }
        }
    }
}

impl ProgressSink for TaskHandle {
    fn add_bytes(&self, bytes: u64) {
        self.bytes_done.fetch_add(bytes, Ordering::Relaxed);
        self.throttled_emit();
    }

    fn item_finished(&self, done: usize, total: usize) {
        // Files, not bytes: the only honest progress signal when a manifest
        // omits sizes.
        if let Some(dto) = self.manager.mutate(&self.id, |dto| {
            if dto.bytes_total.is_none() {
                dto.progress = Some(done as f64 / total.max(1) as f64);
            }
        }) {
            let _ = self.manager.app.emit(EVENT_TASK_UPDATE, &dto);
        }
    }
}

/// The progress surface long-running work is written against.
///
/// Keeping it a trait rather than a concrete `TaskHandle` means the install
/// pipeline can be exercised headlessly, without a Tauri app handle.
pub trait Progress: ProgressSink {
    fn set_stage(&self, stage: String);
    fn begin_phase(&self, stage: String, bytes_total: Option<u64>);
    fn token(&self) -> CancellationToken;

    /// Fails fast when the user pressed cancel, so callers can use `?`.
    fn check_cancelled(&self) -> Result<()> {
        if self.token().is_cancelled() {
            return Err(LauncherError::new(ErrorKind::Cancelled, "Операция отменена"));
        }
        Ok(())
    }
}

impl Progress for TaskHandle {
    fn set_stage(&self, stage: String) {
        TaskHandle::set_stage(self, stage);
    }

    fn begin_phase(&self, stage: String, bytes_total: Option<u64>) {
        TaskHandle::begin_phase(self, stage, bytes_total);
    }

    fn token(&self) -> CancellationToken {
        TaskHandle::token(self)
    }
}
