//! Microsoft sign-in: the OAuth 2.0 authorization-code flow against the
//! consumer endpoints at `login.live.com`.
//!
//! The launcher opens Microsoft's own sign-in page in a separate window and
//! waits for it to land on the desktop redirect, which carries a one-time
//! code in its query string. That code is traded for an access token and a
//! refresh token. No password ever passes through the launcher.

use serde::Deserialize;
use url::Url;

use crate::error::{ErrorKind, LauncherError, Result};
use crate::net::retry::network_error;

/// The application id Minecraft's own launcher signs in with. It is public
/// knowledge, carries no secret, and is the only id Microsoft accepts for the
/// `MBI_SSL` Xbox Live scope without a Mojang-approved Azure registration.
pub const CLIENT_ID: &str = "00000000402b5328";

const AUTHORIZE_URL: &str = "https://login.live.com/oauth20_authorize.srf";
const TOKEN_URL: &str = "https://login.live.com/oauth20_token.srf";

/// The "desktop" redirect: a blank page on Microsoft's side that exists only
/// so a native application can read the code out of the address bar.
pub const REDIRECT_URI: &str = "https://login.live.com/oauth20_desktop.srf";

/// The legacy Xbox Live scope. Its access token goes to Xbox Live as-is,
/// without the `d=` prefix an Azure AD token would need.
const SCOPE: &str = "service::user.auth.xboxlive.com::MBI_SSL";

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

/// Percent-encodes everything outside the unreserved set, which is all the
/// escaping these few parameters can ever need.
fn encoded(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(char::from(byte));
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// Where to send the sign-in window. `prompt=select_account` keeps a second
/// account from being signed in silently with the first one's cookies.
pub fn authorize_url() -> String {
    let query = [
        ("client_id", CLIENT_ID),
        ("response_type", "code"),
        ("scope", SCOPE),
        ("redirect_uri", REDIRECT_URI),
        ("prompt", "select_account"),
    ];
    let mut url = String::from(AUTHORIZE_URL);
    for (index, (key, value)) in query.iter().enumerate() {
        url.push(if index == 0 { '?' } else { '&' });
        url.push_str(key);
        url.push('=');
        url.push_str(&encoded(value));
    }
    url
}

/// Reads a navigation the sign-in window is about to make.
///
/// `None` means "an ordinary page of the sign-in flow, let it through".
/// Anything else ends the flow: the code to exchange, or the reason
/// Microsoft refused.
pub fn code_from_redirect(url: &Url) -> Option<Result<String>> {
    let landed = url.as_str().split(['?', '#']).next().unwrap_or_default();
    if landed.trim_end_matches('/') != REDIRECT_URI {
        return None;
    }

    let mut code = None;
    let mut error = None;
    let mut description = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "error" => error = Some(value.into_owned()),
            "error_description" => description = Some(value.into_owned()),
            _ => {}
        }
    }

    Some(match (code, error) {
        (Some(code), _) => Ok(code),
        (None, Some(error)) => Err(describe_oauth_error(&error, description.as_deref())),
        (None, None) => Err(LauncherError::new(
            ErrorKind::Auth,
            "Microsoft закрыл вход без кода — попробуйте ещё раз",
        )),
    })
}

/// Turns an OAuth error into something a person can act on.
pub fn describe_oauth_error(code: &str, description: Option<&str>) -> LauncherError {
    let detail = description.unwrap_or(code).to_owned();
    match code {
        "access_denied" | "authorization_declined" => {
            LauncherError::new(ErrorKind::Auth, "Вход отклонён в окне Microsoft")
        }
        "expired_token" | "code_expired" => {
            LauncherError::new(ErrorKind::Auth, "Код входа устарел — начните вход заново")
        }
        "invalid_client" | "unauthorized_client" => {
            LauncherError::new(ErrorKind::Auth, "Microsoft больше не принимает это приложение")
                .with_detail(detail)
        }
        "invalid_grant" => {
            LauncherError::new(ErrorKind::Auth, "Сессия Microsoft истекла — войдите заново")
                .with_detail(detail)
        }
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

/// Trades the one-time code from the redirect for real tokens.
pub async fn exchange_code(client: &reqwest::Client, code: &str) -> Result<MsaTokens> {
    let response = client
        .post(TOKEN_URL)
        .form(&[
            ("client_id", CLIENT_ID),
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", REDIRECT_URI),
            ("scope", SCOPE),
        ])
        .send()
        .await
        .map_err(|error| network_error("Не удалось связаться с Microsoft", &error))?;

    if !response.status().is_success() {
        let error = read_oauth_error(response).await;
        // Here a refused grant means the one-time code went stale, which
        // reads nothing like the expired session the same code means later.
        if error.error == "invalid_grant" {
            return Err(LauncherError::new(
                ErrorKind::Auth,
                "Код входа не подошёл — войдите ещё раз",
            )
            .with_detail(error.error_description.unwrap_or(error.error)));
        }
        return Err(describe_oauth_error(
            &error.error,
            error.error_description.as_deref(),
        ));
    }
    response.json::<MsaTokens>().await.map_err(|error| {
        LauncherError::new(ErrorKind::Parse, "Ответ Microsoft не разобрался")
            .with_detail(error.to_string())
    })
}

/// Exchanges a refresh token for fresh tokens.
pub async fn refresh(
    client: &reqwest::Client,
    refresh_token: &str,
) -> std::result::Result<MsaTokens, RefreshError> {
    let response = client
        .post(TOKEN_URL)
        .form(&[
            ("client_id", CLIENT_ID),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("redirect_uri", REDIRECT_URI),
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

    fn parse(raw: &str) -> Url {
        match Url::parse(raw) {
            Ok(url) => url,
            Err(error) => panic!("parse {raw}: {error}"),
        }
    }

    #[test]
    fn the_authorize_url_carries_the_whole_request() {
        let url = authorize_url();
        assert!(url.starts_with("https://login.live.com/oauth20_authorize.srf?"));
        assert!(url.contains("client_id=00000000402b5328"));
        assert!(url.contains("response_type=code"));
        // The scope's colons must survive encoding.
        assert!(url.contains("scope=service%3A%3Auser.auth.xboxlive.com%3A%3AMBI_SSL"));
        assert!(url.contains("redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf"));
    }

    #[test]
    fn pages_of_the_sign_in_flow_pass_through() {
        assert!(code_from_redirect(&parse("https://login.live.com/oauth20_authorize.srf?x=1")).is_none());
        assert!(code_from_redirect(&parse("https://login.live.com/ppsecure/post.srf")).is_none());
        assert!(code_from_redirect(&parse("https://account.live.com/recover")).is_none());
    }

    #[test]
    fn the_redirect_gives_up_its_code() {
        let url = parse("https://login.live.com/oauth20_desktop.srf?code=M.C123_BAY.2.U.abc&lc=1033");
        assert_eq!(
            code_from_redirect(&url).and_then(std::result::Result::ok),
            Some(String::from("M.C123_BAY.2.U.abc"))
        );
    }

    #[test]
    fn a_refused_sign_in_reads_as_a_refusal() {
        let url = parse(
            "https://login.live.com/oauth20_desktop.srf?error=access_denied&error_description=The+user+has+denied+access",
        );
        let error = match code_from_redirect(&url) {
            Some(Err(error)) => error,
            other => panic!("expected a refusal, got {other:?}"),
        };
        assert_eq!(error.kind, ErrorKind::Auth);
        assert!(error.message.contains("отклонён"));
    }

    #[test]
    fn an_empty_redirect_is_not_mistaken_for_success() {
        let url = parse("https://login.live.com/oauth20_desktop.srf");
        assert!(code_from_redirect(&url).is_some_and(|outcome| outcome.is_err()));
    }
}
