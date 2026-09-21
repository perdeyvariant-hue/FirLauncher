//! The single error type crossing the IPC boundary.
//!
//! Every command returns `Result<T, LauncherError>`, and `LauncherError`
//! serialises to exactly the shape `src/types/error.ts` expects:
//! `{ kind, message, detail?, retryable }`. That contract is what keeps
//! "Error: undefined" from ever reaching the UI.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    /// Transport-level failure: DNS, TLS, timeout, connection reset.
    Network,
    /// The server answered, but with an unusable status.
    Http,
    Io,
    /// A downloaded file did not match its expected SHA1.
    Hash,
    Parse,
    Auth,
    Java,
    Loader,
    Instance,
    Provider,
    Cancelled,
    Unsupported,
    Internal,
}

#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[error("{message}")]
#[serde(rename_all = "camelCase")]
pub struct LauncherError {
    pub kind: ErrorKind,
    /// Already phrased for a human, in the UI language.
    pub message: String,
    /// Technical context shown in a collapsible block.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// Whether offering a "Retry" button makes sense.
    pub retryable: bool,
}

impl LauncherError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        let retryable = matches!(kind, ErrorKind::Network | ErrorKind::Http);
        Self {
            kind,
            message: message.into(),
            detail: None,
            retryable,
        }
    }

    #[must_use]
    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    #[must_use]
    pub fn retryable(mut self, retryable: bool) -> Self {
        self.retryable = retryable;
        self
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Internal, message)
    }

    pub fn io(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Io, message)
    }

    pub fn unsupported(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Unsupported, message)
    }
}

impl From<std::io::Error> for LauncherError {
    fn from(error: std::io::Error) -> Self {
        Self::new(ErrorKind::Io, "Ошибка файловой системы").with_detail(error.to_string())
    }
}

impl From<serde_json::Error> for LauncherError {
    fn from(error: serde_json::Error) -> Self {
        Self::new(ErrorKind::Parse, "Не удалось разобрать данные").with_detail(error.to_string())
    }
}

pub type Result<T> = std::result::Result<T, LauncherError>;
