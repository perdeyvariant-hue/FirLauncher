//! The last hop: XSTS -> Minecraft access token -> Java Edition profile.

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::error::{ErrorKind, LauncherError, Result};
use crate::net::retry::network_error;

use super::xbox::XboxToken;

const LOGIN_URL: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";
const PROFILE_URL: &str = "https://api.minecraftservices.com/minecraft/profile";

#[derive(Debug, Clone, Deserialize)]
pub struct MinecraftToken {
    pub access_token: String,
    pub expires_in: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skin {
    pub url: String,
    pub state: String,
    pub variant: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Profile {
    /// Undashed UUID as the API returns it.
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub skins: Vec<Skin>,
}

impl Profile {
    /// The skin the player currently wears, served over HTTPS so the
    /// launcher's content policy lets the webview load it.
    pub fn active_skin_url(&self) -> Option<String> {
        self.skins
            .iter()
            .find(|skin| skin.state.eq_ignore_ascii_case("ACTIVE"))
            .or_else(|| self.skins.first())
            .map(|skin| to_https(&skin.url))
    }

    pub fn dashed_uuid(&self) -> String {
        dash_uuid(&self.id)
    }
}

pub fn to_https(url: &str) -> String {
    match url.strip_prefix("http://") {
        Some(rest) => format!("https://{rest}"),
        None => url.to_owned(),
    }
}

/// `069a79f444e94726a5befca90e38aaf5` -> `069a79f4-44e9-4726-a5be-fca90e38aaf5`.
pub fn dash_uuid(raw: &str) -> String {
    if raw.len() != 32 || raw.contains('-') {
        return raw.to_owned();
    }
    format!(
        "{}-{}-{}-{}-{}",
        &raw[0..8],
        &raw[8..12],
        &raw[12..16],
        &raw[16..20],
        &raw[20..32]
    )
}

/// The Minecraft access token is a JWT whose payload carries the Xbox user
/// id. Reading it here saves a second XSTS round trip just for `${auth_xuid}`.
/// Best effort: the game runs fine without it.
pub fn xuid_from_token(token: &str) -> Option<String> {
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .ok()?;
    let claims: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    match claims.get("xuid")? {
        serde_json::Value::String(value) => Some(value.clone()),
        serde_json::Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

/// XSTS token -> Minecraft access token.
pub async fn login_with_xbox(client: &reqwest::Client, xsts: &XboxToken) -> Result<MinecraftToken> {
    let body = json!({
        "identityToken": format!("XBL3.0 x={};{}", xsts.user_hash, xsts.token),
    });

    let response = client
        .post(LOGIN_URL)
        .json(&body)
        .send()
        .await
        .map_err(|error| network_error("Сервис Minecraft недоступен", &error))?;

    let status = response.status();
    if status.is_success() {
        return response.json::<MinecraftToken>().await.map_err(|error| {
            LauncherError::new(ErrorKind::Parse, "Токен Minecraft не разобрался")
                .with_detail(error.to_string())
        });
    }

    let body = response.text().await.unwrap_or_default();
    Err(match status {
        // The trap every new launcher falls into: Microsoft is happy, Mojang
        // is not, because the Azure app was never approved for this API.
        reqwest::StatusCode::FORBIDDEN => LauncherError::new(
            ErrorKind::Auth,
            "Вход в Microsoft прошёл, но Mojang отклонил приложение: этот Client ID \
             не одобрен для Minecraft API. Нужен одобренный ID — см. README",
        )
        .with_detail(body),
        reqwest::StatusCode::TOO_MANY_REQUESTS => LauncherError::new(
            ErrorKind::Http,
            "Слишком много попыток входа — подождите минуту",
        )
        .retryable(true),
        _ => LauncherError::new(ErrorKind::Auth, "Сервис Minecraft отклонил вход")
            .with_detail(format!("HTTP {status}\n{body}"))
            .retryable(status.is_server_error()),
    })
}

/// Fetches the Java Edition profile; a 404 means the account does not own it.
pub async fn fetch_profile(client: &reqwest::Client, access_token: &str) -> Result<Profile> {
    let response = client
        .get(PROFILE_URL)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|error| network_error("Не удалось загрузить профиль Minecraft", &error))?;

    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err(LauncherError::new(
            ErrorKind::Auth,
            "На этом аккаунте нет Minecraft: Java Edition. Если игра куплена через \
             Game Pass, запустите один раз официальный лаунчер, чтобы создать профиль",
        ));
    }
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(LauncherError::new(
            ErrorKind::Auth,
            "Токен Minecraft отклонён — войдите заново",
        ));
    }
    if !status.is_success() {
        return Err(
            LauncherError::new(ErrorKind::Auth, "Не удалось загрузить профиль Minecraft")
                .with_detail(format!("HTTP {status}"))
                .retryable(status.is_server_error()),
        );
    }

    response.json::<Profile>().await.map_err(|error| {
        LauncherError::new(ErrorKind::Parse, "Профиль Minecraft не разобрался")
            .with_detail(error.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xuid_is_read_from_the_jwt_payload() {
        let as_string = "eyJhbGciOiJIUzI1NiJ9.eyJ4dWlkIjogIjI1MzU0MDUyOTAiLCAic3ViIjogIngifQ.sig";
        let as_number = "eyJhbGciOiJIUzI1NiJ9.eyJ4dWlkIjogMjUzNTQwNTI5MH0.sig";
        assert_eq!(xuid_from_token(as_string).as_deref(), Some("2535405290"));
        assert_eq!(xuid_from_token(as_number).as_deref(), Some("2535405290"));
        assert_eq!(xuid_from_token("not-a-jwt"), None);
    }

    #[test]
    fn profile_uuids_are_dashed() {
        assert_eq!(
            dash_uuid("069a79f444e94726a5befca90e38aaf5"),
            "069a79f4-44e9-4726-a5be-fca90e38aaf5"
        );
        assert_eq!(dash_uuid("already-dashed"), "already-dashed");
    }

    #[test]
    fn the_active_skin_is_served_over_https() -> std::result::Result<(), serde_json::Error> {
        let profile: Profile = serde_json::from_str(
            r#"{"id":"069a79f444e94726a5befca90e38aaf5","name":"Notch","skins":[
                {"url":"http://textures.minecraft.net/texture/old","state":"INACTIVE"},
                {"url":"http://textures.minecraft.net/texture/abc","state":"ACTIVE","variant":"CLASSIC"}
            ]}"#,
        )?;
        assert_eq!(
            profile.active_skin_url().as_deref(),
            Some("https://textures.minecraft.net/texture/abc")
        );
        Ok(())
    }
}
