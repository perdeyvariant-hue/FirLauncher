//! The one `reqwest::Client` the whole launcher shares.

use std::time::Duration;

use crate::error::{ErrorKind, LauncherError, Result};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// No overall request timeout: downloads of a 200 MB client jar are legitimate.
const READ_TIMEOUT: Duration = Duration::from_secs(60);

/// Modrinth and CurseForge both require a User-Agent that identifies the app
/// and offers a way to contact whoever is making the requests.
pub fn user_agent(contact: &str) -> String {
    let version = env!("CARGO_PKG_VERSION");
    let contact = contact.trim();
    if contact.is_empty() {
        format!("FirLauncher/{version} (+https://github.com/firlauncher)")
    } else {
        format!("FirLauncher/{version} ({contact})")
    }
}

pub fn build_client(contact: &str) -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(user_agent(contact))
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(READ_TIMEOUT)
        // HTTP/1.1 on purpose. Over HTTP/2 reqwest multiplexes every request
        // onto a single connection, so sixteen "parallel" asset downloads end
        // up sharing one socket and one server-side queue. Minecraft assets
        // are thousands of tiny files where per-request latency dominates, and
        // separate connections are several times faster.
        .http1_only()
        .pool_max_idle_per_host(32)
        .build()
        .map_err(|error| {
            LauncherError::new(ErrorKind::Network, "Не удалось создать HTTP-клиент")
                .with_detail(error.to_string())
        })
}
