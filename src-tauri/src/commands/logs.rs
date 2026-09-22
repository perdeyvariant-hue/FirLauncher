//! Sharing a game log through mclo.gs, the paste service the Minecraft
//! community uses for logs (it also strips IP addresses on its side).

use std::sync::OnceLock;

use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{ErrorKind, LauncherError, Result};
use crate::net::retry::network_error;
use crate::state::AppState;

const API: &str = "https://api.mclo.gs/1/log";
/// mclo.gs keeps at most 25 000 lines; the end of a log matters most.
const MAX_LINES: usize = 25_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedLog {
    pub url: String,
}

#[derive(Debug, Deserialize)]
struct Response {
    success: bool,
    url: Option<String>,
    error: Option<String>,
}

fn patterns() -> &'static [(Regex, &'static str)] {
    static CELL: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    CELL.get_or_init(|| {
        [
            // C:\Users\name\… and /home/name/… reveal the account name.
            (r"(?i)([A-Z]:[\\/]+Users[\\/]+)[^\\/\s]+", "${1}<user>"),
            (r"(/home/|/Users/)[^/\s]+", "${1}<user>"),
            // Session and access tokens should never be in a log, but mods print odd things.
            (r"(?i)(--accessToken\s+|accessToken[=:]\s*|token:)[A-Za-z0-9._\-]{10,}", "${1}<hidden>"),
            (r"eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}", "<hidden-jwt>"),
        ]
        .into_iter()
        .filter_map(|(pattern, replacement)| Regex::new(pattern).ok().map(|re| (re, replacement)))
        .collect()
    })
}

/// Removes what identifies the person rather than the problem.
pub fn redact(text: &str) -> String {
    patterns()
        .iter()
        .fold(text.to_owned(), |acc, (re, replacement)| re.replace_all(&acc, *replacement).into_owned())
}

#[tauri::command]
pub async fn share_log(state: State<'_, AppState>, lines: Vec<String>) -> Result<SharedLog> {
    if lines.iter().all(|line| line.trim().is_empty()) {
        return Err(LauncherError::new(ErrorKind::Instance, "Журнал пуст — делиться нечем"));
    }
    let start = lines.len().saturating_sub(MAX_LINES);
    let content = redact(&lines[start..].join("\n"));

    let response = state
        .client()
        .post(API)
        .form(&[("content", content)])
        .send()
        .await
        .map_err(|error| network_error("mclo.gs недоступен", &error))?;
    let status = response.status();
    let body: Response = response
        .json()
        .await
        .map_err(|error| network_error("mclo.gs ответил непонятно", &error))?;
    match (body.success, body.url) {
        (true, Some(url)) => Ok(SharedLog { url }),
        _ => Err(LauncherError::new(ErrorKind::Http, "mclo.gs не принял журнал")
            .with_detail(body.error.unwrap_or_else(|| format!("HTTP {status}")))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn personal_details_are_removed() {
        let log = "Loading C:\\Users\\alexe\\AppData\\Roaming\\FirLauncher\\mods\n\
                   Also /home/alex/.minecraft and C:/Users/Иван/Desktop\n\
                   [main/INFO]: Setting user: Steve\n\
                   bad mod printed accessToken=abcdefghijklmnop123 and \
                   eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstu";
        let clean = redact(log);
        assert!(!clean.contains("alexe"));
        assert!(!clean.contains("/home/alex/"));
        assert!(!clean.contains("Иван"));
        assert!(clean.contains("C:\\Users\\<user>\\AppData"));
        assert!(!clean.contains("abcdefghijklmnop123"));
        assert!(!clean.contains("eyJhbGci"));
        // The in-game name is how people ask for help; it stays.
        assert!(clean.contains("Setting user: Steve"));
    }
}
