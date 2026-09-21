//! Microsoft OAuth 2.0 device-code flow against the consumer tenant.
//!
//! The launcher shows a short code, the user confirms it in any browser, and
//! we poll until Microsoft hands back an access token plus a refresh token.
//! No password ever passes through the launcher.

use std::time::{Duration, Instant};

use serde::Deserialize;
use tokio_util::sync::CancellationToken;

use crate::error::{ErrorKind, LauncherError, Result};
use crate::net::retry::network_error;

const DEVICE_CODE_URL: &str =
    "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
const TOKEN_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
/// `XboxLive.signin` is what the Xbox user-token exchange accepts;
/// `offline_access` is what yields a refresh token.
const SCOPE: &str = "XboxLive.signin offline_access";
const DEVICE_GRANT: &str = "urn:ietf:params:oauth:grant-type:device_code";

#[derive(Debug, Clone, Deserialize)]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    #[serde(default = "default_interval")]
    pub interval: u64,
}

fn default_interval() -> u64 {
    5
}

#[derive(Debug, Clone, Deserialize)]
pub struct MsaTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
}

#[derive(Debug, Deserialize)]
struct OAuthError {
    error: String,
    error_description: Option<String>,
}

/// A refresh can fail because the grant is gone (the user must sign in
/// again) or for any transient reason (try again later). The two need
/// different UI, so they are kept apart.
#[derive(Debug)]
pub enum RefreshError {
    SessionExpired,
    Other(LauncherError),
}

impl From<LauncherError> for RefreshError {
    fn from(error: LauncherError) -> Self {
        RefreshError::Other(error)
    }
}

/// Turns an OAuth error body into something a person can act on.
pub fn describe_oauth_error(code: &str, description: Option<&str>) -> LauncherError {
    let detail = description.unwrap_or(code).to_owned();
    match code {
        "authorization_declined" => {
            LauncherError::new(ErrorKind::Auth, "Вход отклонён в браузере")
        }
        "expired_token" | "code_expired" => LauncherError::new(
            ErrorKind::Auth,
            "Код входа устарел — начните вход заново",
        ),
        "bad_verification_code" => {
            LauncherError::new(ErrorKind::Auth, "Microsoft не узнал код входа")
        }
        "invalid_client" | "unauthorized_client" => LauncherError::new(
            ErrorKind::Auth,
            "Microsoft не принял Client ID приложения. Проверьте его в настройках \
             и что в Azure включены «public client flows»",
        )
        .with_detail(detail),
        "invalid_grant" => LauncherError::new(
            ErrorKind::Auth,
            "Сессия Microsoft истекла — войдите заново",
        )
        .with_detail(detail),
        _ => LauncherError::new(ErrorKind::Auth, "Microsoft отклонил запрос входа")
            .with_detail(format!("{code}: {detail}")),
    }
}

async fn read_oauth_error(response: reqwest::Response) -> OAuthError {
    let status = response.status();
    match response.json::<OAuthError>().await {
        Ok(error) => error,
        Err(_) => OAuthError {
            error: String::from("http_error"),
            error_description: Some(format!("HTTP {status}")),
        },
    }
}

/// Step one: ask Microsoft for a code to show the user.
pub async fn request_device_code(client: &reqwest::Client, client_id: &str) -> Result<DeviceCode> {
    let response = client
        .post(DEVICE_CODE_URL)
        .form(&[("client_id", client_id), ("scope", SCOPE)])
        .send()
        .await
        .map_err(|error| network_error("Не удалось связаться с Microsoft", &error))?;

    if !response.status().is_success() {
        let error = read_oauth_error(response).await;
        return Err(describe_oauth_error(
            &error.error,
            error.error_description.as_deref(),
        ));
    }

    response.json::<DeviceCode>().await.map_err(|error| {
        LauncherError::new(ErrorKind::Parse, "Ответ Microsoft не разобрался")
            .with_detail(error.to_string())
    })
}

/// What one poll of the token endpoint told us.
#[derive(Debug, PartialEq, Eq)]
pub enum PollOutcome {
    Pending,
    SlowDown,
}

/// Classifies a token-endpoint error during device-code polling.
pub fn classify_poll_error(code: &str, description: Option<&str>) -> std::result::Result<PollOutcome, LauncherError> {
    match code {
        "authorization_pending" => Ok(PollOutcome::Pending),
        "slow_down" => Ok(PollOutcome::SlowDown),
        _ => Err(describe_oauth_error(code, description)),
    }
}

/// Step two: poll until the user confirms, declines, or the code expires.
pub async fn poll_for_token(
    client: &reqwest::Client,
    client_id: &str,
    code: &DeviceCode,
    cancel: &CancellationToken,
) -> Result<MsaTokens> {
    let deadline = Instant::now() + Duration::from_secs(code.expires_in);
    let mut interval = Duration::from_secs(code.interval.max(1));

    loop {
        tokio::select! {
            biased;
            () = cancel.cancelled() => {
                return Err(LauncherError::new(ErrorKind::Cancelled, "Вход отменён"));
            }
            () = tokio::time::sleep(interval) => {}
        }

        if Instant::now() >= deadline {
            return Err(describe_oauth_error("expired_token", None));
        }

        let response = client
            .post(TOKEN_URL)
            .form(&[
                ("grant_type", DEVICE_GRANT),
                ("client_id", client_id),
                ("device_code", code.device_code.as_str()),
            ])
            .send()
            .await;

        let response = match response {
            Ok(response) => response,
            // A dropped poll is not a reason to abandon the whole sign-in.
            Err(_) => continue,
        };

        if response.status().is_success() {
            return response.json::<MsaTokens>().await.map_err(|error| {
                LauncherError::new(ErrorKind::Parse, "Токен Microsoft не разобрался")
                    .with_detail(error.to_string())
            });
        }

        let error = read_oauth_error(response).await;
        match classify_poll_error(&error.error, error.error_description.as_deref())? {
            PollOutcome::Pending => {}
            // RFC 8628: back off by five seconds and keep going.
            PollOutcome::SlowDown => interval += Duration::from_secs(5),
        }
    }
}

/// Exchanges a refresh token for fresh tokens.
pub async fn refresh(
    client: &reqwest::Client,
    client_id: &str,
    refresh_token: &str,
) -> std::result::Result<MsaTokens, RefreshError> {
    let response = client
        .post(TOKEN_URL)
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", client_id),
            ("refresh_token", refresh_token),
            ("scope", SCOPE),
        ])
        .send()
        .await
        .map_err(|error| network_error("Не удалось связаться с Microsoft", &error))?;

    if response.status().is_success() {
        return response.json::<MsaTokens>().await.map_err(|error| {
            RefreshError::Other(
                LauncherError::new(ErrorKind::Parse, "Токен Microsoft не разобрался")
                    .with_detail(error.to_string()),
            )
        });
    }

    let error = read_oauth_error(response).await;
    if error.error == "invalid_grant" {
        return Err(RefreshError::SessionExpired);
    }
    Err(RefreshError::Other(describe_oauth_error(
        &error.error,
        error.error_description.as_deref(),
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_and_slow_down_keep_polling() {
        assert_eq!(classify_poll_error("authorization_pending", None).ok(), Some(PollOutcome::Pending));
        assert_eq!(classify_poll_error("slow_down", None).ok(), Some(PollOutcome::SlowDown));
    }

    #[test]
    fn terminal_errors_become_readable_messages() {
        let declined = classify_poll_error("authorization_declined", None).err();
        assert_eq!(declined.map(|e| e.message), Some(String::from("Вход отклонён в браузере")));

        let expired = classify_poll_error("expired_token", None).err();
        assert!(expired.is_some_and(|e| e.message.contains("устарел")));

        let unknown = classify_poll_error("weird_thing", Some("details")).err();
        assert!(unknown.is_some_and(|e| e.detail.as_deref() == Some("weird_thing: details")));
    }

    #[test]
    fn a_bad_client_id_points_at_the_setting() {
        let error = describe_oauth_error("invalid_client", Some("AADSTS700016"));
        assert!(error.message.contains("Client ID"));
        assert_eq!(error.detail.as_deref(), Some("AADSTS700016"));
    }

    #[test]
    fn device_code_defaults_the_poll_interval() {
        let parsed: DeviceCode = match serde_json::from_str(
            r#"{"device_code":"d","user_code":"ABCD-1234","verification_uri":"https://microsoft.com/link","expires_in":900}"#,
        ) {
            Ok(parsed) => parsed,
            Err(error) => panic!("parse: {error}"),
        };
        assert_eq!(parsed.interval, 5);
        assert_eq!(parsed.user_code, "ABCD-1234");
    }
}
