//! Exponential backoff with jitter, and the rules for what is worth retrying.

use std::future::Future;
use std::time::Duration;

use crate::error::{ErrorKind, LauncherError, Result};

#[derive(Debug, Clone, Copy)]
pub struct RetryPolicy {
    pub attempts: u32,
    pub base_delay: Duration,
    pub max_delay: Duration,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            attempts: 4,
            base_delay: Duration::from_millis(400),
            max_delay: Duration::from_secs(8),
        }
    }
}

impl RetryPolicy {
    fn delay_for(&self, attempt: u32) -> Duration {
        let exponential = self.base_delay.saturating_mul(1_u32 << attempt.min(16));
        let capped = exponential.min(self.max_delay);
        // Deterministic pseudo-jitter: no rand dependency for something this small.
        let jitter_ms = u64::from(attempt).wrapping_mul(137) % 250;
        capped.saturating_add(Duration::from_millis(jitter_ms))
    }
}

/// Retries `operation` while the error is transient. Cancellation and hash
/// mismatches are never retried — the first is the user's choice, the second
/// means the source is lying to us.
pub async fn with_retry<T, F, Fut>(policy: RetryPolicy, mut operation: F) -> Result<T>
where
    F: FnMut(u32) -> Fut,
    Fut: Future<Output = Result<T>>,
{
    let mut attempt = 0;
    loop {
        match operation(attempt).await {
            Ok(value) => return Ok(value),
            Err(error) => {
                let last = attempt + 1 >= policy.attempts;
                if last || !is_transient(&error) {
                    return Err(error);
                }
                tokio::time::sleep(policy.delay_for(attempt)).await;
                attempt += 1;
            }
        }
    }
}

fn is_transient(error: &LauncherError) -> bool {
    matches!(error.kind, ErrorKind::Network | ErrorKind::Http) && error.retryable
}

/// Maps a transport failure onto our error type, marking it retryable.
pub fn network_error(context: &str, error: &reqwest::Error) -> LauncherError {
    let kind = if error.is_status() {
        ErrorKind::Http
    } else {
        ErrorKind::Network
    };
    // A 4xx (other than 408/429) will not become truthy by trying again.
    let retryable = match error.status() {
        Some(status) => {
            status.is_server_error()
                || status == reqwest::StatusCode::TOO_MANY_REQUESTS
                || status == reqwest::StatusCode::REQUEST_TIMEOUT
        }
        None => true,
    };
    LauncherError::new(kind, context)
        .with_detail(error.to_string())
        .retryable(retryable)
}
