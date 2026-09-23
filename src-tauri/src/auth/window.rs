//! The sign-in window: Microsoft's own page, in a window of its own.
//!
//! Nothing of the launcher runs inside it — no IPC, no injected script. The
//! window exists to watch for one thing: the navigation to the desktop
//! redirect that carries the authorization code.

use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

use crate::error::{ErrorKind, LauncherError, Result};

use super::msa;

const WINDOW_LABEL: &str = "msa-login";

type Slot = Arc<Mutex<Option<oneshot::Sender<Result<String>>>>>;

/// Delivers the first outcome and ignores every later one: the window fires
/// a close event after a successful navigation too.
fn settle(slot: &Slot, outcome: Result<String>) {
    let taken = match slot.lock() {
        Ok(mut guard) => guard.take(),
        Err(poisoned) => poisoned.into_inner().take(),
    };
    if let Some(sender) = taken {
        let _ = sender.send(outcome);
    }
}

fn cancelled() -> LauncherError {
    LauncherError::new(ErrorKind::Cancelled, "Вход отменён")
}

/// Opens the sign-in window and resolves with the authorization code.
///
/// Closing the window counts as cancelling, so a person who changes their
/// mind is never left with a dialog spinning at them.
pub async fn ask_for_code(app: &AppHandle, cancel: &CancellationToken) -> Result<String> {
    // A window left over from an abandoned attempt would take the label, and
    // closing one is processed by the event loop rather than right away.
    if let Some(stale) = app.get_webview_window(WINDOW_LABEL) {
        let _ = stale.destroy();
        for _ in 0..40 {
            if app.get_webview_window(WINDOW_LABEL).is_none() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
    }

    let url = tauri::Url::parse(&msa::authorize_url()).map_err(|error| {
        LauncherError::internal("Не удалось составить адрес входа").with_detail(error.to_string())
    })?;

    let (sender, receiver) = oneshot::channel();
    let slot: Slot = Arc::new(Mutex::new(Some(sender)));

    let on_navigation = Arc::clone(&slot);
    let window = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::External(url))
        .title("Вход через Microsoft")
        .inner_size(520.0, 720.0)
        .min_inner_size(420.0, 520.0)
        .center()
        .focused(true)
        .on_navigation(move |url| match msa::code_from_redirect(url) {
            // Let the sign-in itself proceed page by page.
            None => true,
            // The redirect page is blank anyway; there is nothing to show.
            Some(outcome) => {
                settle(&on_navigation, outcome);
                false
            }
        })
        .build()
        .map_err(|error| {
            LauncherError::new(ErrorKind::Auth, "Не удалось открыть окно входа Microsoft")
                .with_detail(error.to_string())
        })?;

    let on_close = Arc::clone(&slot);
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed) {
            settle(&on_close, Err(cancelled()));
        }
    });

    let outcome = tokio::select! {
        () = cancel.cancelled() => Err(cancelled()),
        received = receiver => received.unwrap_or_else(|_| Err(cancelled())),
    };

    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.destroy();
    }
    outcome
}
