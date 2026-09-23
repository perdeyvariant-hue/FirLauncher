//! Xbox Live user token and XSTS authorisation — the middle of the chain
//! between a Microsoft account and a Minecraft session.

use serde::Deserialize;
use serde_json::json;

use crate::error::{ErrorKind, LauncherError, Result};
use crate::net::retry::network_error;

const XBL_URL: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_URL: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
/// The relying party that makes the XSTS token usable with Minecraft services.
const MINECRAFT_RELYING_PARTY: &str = "rp://api.minecraftservices.com/";

#[derive(Debug, Deserialize)]
struct UserHash {
    uhs: String,
}

#[derive(Debug, Deserialize)]
struct DisplayClaims {
    xui: Vec<UserHash>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct XboxTokenResponse {
    token: String,
    display_claims: DisplayClaims,
}

#[derive(Debug, Deserialize)]
struct XstsError {
    #[serde(rename = "XErr")]
    xerr: Option<u64>,
    #[serde(rename = "Message")]
    message: Option<String>,
}

#[derive(Debug, Clone)]
pub struct XboxToken {
    pub token: String,
    /// User hash; the Minecraft login needs it next to the XSTS token.
    pub user_hash: String,
}

/// The XSTS error codes people actually hit, in words they can act on.
pub fn describe_xerr(code: u64) -> LauncherError {
    let message = match code {
        2_148_916_227 => "Этот аккаунт заблокирован в Xbox Live",
        2_148_916_229 => {
            "Родительский контроль запрещает сетевую игру — взрослому в семье \
             Microsoft нужно разрешить это на account.xbox.com"
        }
        2_148_916_233 => {
            "У аккаунта Microsoft нет профиля Xbox. Зайдите один раз на xbox.com, \
             чтобы создать его, и повторите вход"
        }
        2_148_916_234 => "Нужно принять условия Xbox Live на xbox.com",
        2_148_916_235 => "Xbox Live недоступен в стране, указанной в аккаунте",
        2_148_916_236 | 2_148_916_237 => {
            "Для этого региона Xbox требует подтвердить возраст на xbox.com"
        }
        2_148_916_238 => {
            "Это детский аккаунт: взрослый должен добавить его в семью Microsoft \
             на account.microsoft.com/family"
        }
        _ => "Xbox Live отказал во входе",
    };
    LauncherError::new(ErrorKind::Auth, message).with_detail(format!("XErr {code}"))
}

async fn parse_token(response: reqwest::Response, step: &str) -> Result<XboxToken> {
    let parsed = response.json::<XboxTokenResponse>().await.map_err(|error| {
        LauncherError::new(ErrorKind::Parse, format!("Ответ {step} не разобрался"))
            .with_detail(error.to_string())
    })?;
    let user_hash = parsed
        .display_claims
        .xui
        .into_iter()
        .next()
        .map(|claim| claim.uhs)
        .ok_or_else(|| {
            LauncherError::new(ErrorKind::Auth, format!("{step} не вернул идентификатор пользователя"))
        })?;
    Ok(XboxToken {
        token: parsed.token,
        user_hash,
    })
}

/// Microsoft access token -> Xbox Live user token.
pub async fn authenticate(client: &reqwest::Client, msa_access_token: &str) -> Result<XboxToken> {
    let body = json!({
        "Properties": {
            "AuthMethod": "RPS",
            "SiteName": "user.auth.xboxlive.com",
            // A token from the legacy `MBI_SSL` scope goes in as it is; the
            // `d=` prefix belongs to Azure AD tokens and Xbox rejects it here.
            "RpsTicket": msa_access_token,
        },
        "RelyingParty": "http://auth.xboxlive.com",
        "TokenType": "JWT",
    });

    let response = client
        .post(XBL_URL)
        .header(reqwest::header::ACCEPT, "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|error| network_error("Xbox Live недоступен", &error))?;

    if !response.status().is_success() {
        let status = response.status();
        return Err(
            LauncherError::new(ErrorKind::Auth, "Xbox Live не принял токен Microsoft")
                .with_detail(format!("HTTP {status}"))
                .retryable(status.is_server_error()),
        );
    }
    parse_token(response, "Xbox Live").await
}

/// Xbox user token -> XSTS token scoped to Minecraft services.
pub async fn authorize(client: &reqwest::Client, user_token: &str) -> Result<XboxToken> {
    let body = json!({
        "Properties": {
            "SandboxId": "RETAIL",
            "UserTokens": [user_token],
        },
        "RelyingParty": MINECRAFT_RELYING_PARTY,
        "TokenType": "JWT",
    });

    let response = client
        .post(XSTS_URL)
        .header(reqwest::header::ACCEPT, "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|error| network_error("Сервис XSTS недоступен", &error))?;

    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        let error = response.json::<XstsError>().await.ok();
        return Err(match error.and_then(|error| error.xerr.map(|code| (code, error.message))) {
            Some((code, _)) => describe_xerr(code),
            None => LauncherError::new(ErrorKind::Auth, "Xbox Live отказал во входе"),
        });
    }
    if !status.is_success() {
        return Err(
            LauncherError::new(ErrorKind::Auth, "XSTS отклонил запрос")
                .with_detail(format!("HTTP {status}"))
                .retryable(status.is_server_error()),
        );
    }
    parse_token(response, "XSTS").await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_xerr_codes_explain_what_to_do() {
        assert!(describe_xerr(2_148_916_233).message.contains("профиля Xbox"));
        assert!(describe_xerr(2_148_916_238).message.contains("семью"));
        assert_eq!(
            describe_xerr(2_148_916_238).detail.as_deref(),
            Some("XErr 2148916238")
        );
    }

    #[test]
    fn unknown_codes_still_carry_the_number() {
        let error = describe_xerr(42);
        assert_eq!(error.detail.as_deref(), Some("XErr 42"));
        assert_eq!(error.kind, ErrorKind::Auth);
    }
}
