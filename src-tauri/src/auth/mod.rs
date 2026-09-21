//! Microsoft account sign-in and game sessions.
//!
//! ```text
//! device code -> Microsoft token -> Xbox Live -> XSTS -> Minecraft token -> profile
//! ```
//!
//! The refresh token and the cached Minecraft token live in the OS keyring
//! (see `secrets`); `accounts.json` only records who the account is.

pub mod minecraft;
pub mod msa;
pub mod secrets;
pub mod skin;
pub mod xbox;

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::accounts::{Account, AccountKind, AccountStore};
use crate::config::settings::Settings;
use crate::error::{ErrorKind, LauncherError, Result};
use crate::paths::Paths;

use self::secrets::SecretStore;

pub const EVENT_DEVICE_CODE: &str = "auth://device-code";
pub const EVENT_ACCOUNTS_CHANGED: &str = "accounts://changed";

/// Refresh the Minecraft token this long before it actually expires, so a
/// launch never starts with a token that dies mid-handshake.
const EXPIRY_MARGIN_SECONDS: i64 = 5 * 60;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ExchangeStep {
    Xbox,
    Xsts,
    Minecraft,
    Profile,
}

/// Mirror of `DeviceCodeState` in `src/types/account.ts`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "phase", rename_all = "lowercase")]
pub enum DeviceCodeState {
    Requesting,
    #[serde(rename_all = "camelCase")]
    Waiting {
        user_code: String,
        verification_uri: String,
        expires_in_seconds: u64,
    },
    Exchanging {
        step: ExchangeStep,
    },
    #[serde(rename_all = "camelCase")]
    Done {
        account_id: String,
    },
    Failed {
        message: String,
    },
}

/// Minecraft token cached between launches, stored in the keyring.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedToken {
    access_token: String,
    /// Unix seconds.
    expires_at: i64,
    xuid: Option<String>,
}

impl CachedToken {
    fn is_fresh(&self) -> bool {
        self.expires_at - EXPIRY_MARGIN_SECONDS > chrono::Utc::now().timestamp()
    }
}

/// Everything the game's command line needs to know about the player.
#[derive(Debug, Clone)]
pub struct GameSession {
    pub username: String,
    pub uuid: String,
    pub access_token: String,
    pub xuid: String,
    pub user_type: String,
}

impl GameSession {
    /// Offline sessions use a placeholder token; the client accepts it as long
    /// as it never has to talk to the session servers.
    pub fn offline(account: &Account) -> Self {
        Self {
            username: account.username.clone(),
            uuid: account.uuid.clone(),
            access_token: String::from("0"),
            xuid: String::new(),
            user_type: String::from("legacy"),
        }
    }
}

/// The Azure application id: a per-user override from settings wins over the
/// one baked in at build time. Neither is ever committed to the repository.
pub fn client_id(settings: &Settings) -> Option<String> {
    let configured = settings.msa_client_id.trim();
    if !configured.is_empty() {
        return Some(configured.to_owned());
    }
    option_env!("FIRLAUNCHER_MSA_CLIENT_ID")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn require_client_id(settings: &Settings) -> Result<String> {
    client_id(settings).ok_or_else(|| {
        LauncherError::new(
            ErrorKind::Auth,
            "Не задан Client ID приложения Azure. Укажите его в «Настройки → Вход через \
             Microsoft» — как получить, описано в README",
        )
    })
}

fn refresh_key(account_id: &str) -> String {
    format!("{account_id}:refresh")
}

fn token_key(account_id: &str) -> String {
    format!("{account_id}:minecraft")
}

/// Keyring calls may block (D-Bus on Linux), so they leave the async runtime.
async fn blocking<T, F>(work: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T> + Send + 'static,
{
    tokio::task::spawn_blocking(work).await.map_err(|error| {
        LauncherError::internal("Сбой обращения к хранилищу паролей").with_detail(error.to_string())
    })?
}

struct Exchanged {
    token: minecraft::MinecraftToken,
    profile: minecraft::Profile,
}

/// Microsoft access token -> Minecraft token and profile, reporting each hop.
async fn exchange(
    client: &reqwest::Client,
    msa_access_token: &str,
    report: &(dyn Fn(ExchangeStep) + Send + Sync),
) -> Result<Exchanged> {
    report(ExchangeStep::Xbox);
    let user = xbox::authenticate(client, msa_access_token).await?;

    report(ExchangeStep::Xsts);
    let xsts = xbox::authorize(client, &user.token).await?;

    report(ExchangeStep::Minecraft);
    let token = minecraft::login_with_xbox(client, &xsts).await?;

    report(ExchangeStep::Profile);
    let profile = minecraft::fetch_profile(client, &token.access_token).await?;

    Ok(Exchanged { token, profile })
}

fn cached_from(token: &minecraft::MinecraftToken) -> CachedToken {
    let lifetime = i64::try_from(token.expires_in).unwrap_or(i64::MAX / 2);
    CachedToken {
        access_token: token.access_token.clone(),
        expires_at: chrono::Utc::now().timestamp().saturating_add(lifetime),
        xuid: minecraft::xuid_from_token(&token.access_token),
    }
}

/// Writes both secrets for an account.
async fn persist_secrets(
    store: &SecretStore,
    account_id: &str,
    refresh_token: &str,
    cached: &CachedToken,
) -> Result<()> {
    let store = store.clone();
    let refresh = (refresh_key(account_id), refresh_token.to_owned());
    let token = (token_key(account_id), serde_json::to_string(cached)?);
    blocking(move || {
        store.put(&refresh.0, &refresh.1)?;
        store.put(&token.0, &token.1)
    })
    .await
}

async fn read_secret(store: &SecretStore, key: String) -> Result<Option<String>> {
    let store = store.clone();
    blocking(move || store.get(&key)).await
}

/// Deletes an account's tokens from the keyring.
pub async fn forget(store: &SecretStore, account_id: &str) -> Result<()> {
    let store = store.clone();
    let keys = [refresh_key(account_id), token_key(account_id)];
    blocking(move || {
        for key in &keys {
            store.remove(key)?;
        }
        Ok(())
    })
    .await
}

/// Applies a fresh profile to an account record. A head that failed to
/// render keeps the previous picture rather than falling back to initials.
fn apply_profile(account: &mut Account, profile: &minecraft::Profile, head: Option<String>) {
    account.username = profile.name.clone();
    account.uuid = profile.dashed_uuid();
    account.skin_url = profile.active_skin_url();
    if head.is_some() {
        account.avatar_url = head;
    }
    account.expired = false;
}

async fn render_head(client: &reqwest::Client, profile: &minecraft::Profile) -> Option<String> {
    let url = profile.active_skin_url()?;
    skin::fetch_head(client, &url).await
}

/// The interactive sign-in. `emit` receives every state change for the
/// dialog; the caller reports failures.
pub async fn login(
    client: &reqwest::Client,
    paths: &Paths,
    store: &SecretStore,
    settings: &Settings,
    cancel: &CancellationToken,
    emit: &(dyn Fn(DeviceCodeState) + Send + Sync),
) -> Result<Account> {
    let client_id = require_client_id(settings)?;

    emit(DeviceCodeState::Requesting);
    let code = msa::request_device_code(client, &client_id).await?;
    emit(DeviceCodeState::Waiting {
        user_code: code.user_code.clone(),
        verification_uri: code.verification_uri.clone(),
        expires_in_seconds: code.expires_in,
    });

    let tokens = msa::poll_for_token(client, &client_id, &code, cancel).await?;
    let refresh_token = tokens.refresh_token.clone().ok_or_else(|| {
        LauncherError::new(
            ErrorKind::Auth,
            "Microsoft не выдал refresh-токен — проверьте, что приложению разрешён offline_access",
        )
    })?;

    let exchanged = exchange(client, &tokens.access_token, &|step| {
        emit(DeviceCodeState::Exchanging { step });
    })
    .await?;

    let head = render_head(client, &exchanged.profile).await;
    let mut accounts = AccountStore::load(paths).await?;
    let uuid = exchanged.profile.dashed_uuid();

    // Signing in with the same Minecraft profile again refreshes that row
    // instead of adding a duplicate.
    let existing = accounts
        .accounts
        .iter_mut()
        .find(|account| account.kind == AccountKind::Microsoft && account.uuid == uuid);

    let account = match existing {
        Some(account) => {
            apply_profile(account, &exchanged.profile, head);
            account.clone()
        }
        None => {
            let mut account = Account {
                id: uuid::Uuid::new_v4().to_string(),
                kind: AccountKind::Microsoft,
                username: String::new(),
                uuid: String::new(),
                avatar_url: None,
                skin_url: None,
                expired: false,
                added_at: chrono::Utc::now().to_rfc3339(),
            };
            apply_profile(&mut account, &exchanged.profile, head);
            accounts.accounts.push(account.clone());
            account
        }
    };

    // Secrets first: an account row without tokens would be a dead entry.
    persist_secrets(store, &account.id, &refresh_token, &cached_from(&exchanged.token)).await?;
    accounts.save(paths).await?;

    emit(DeviceCodeState::Done {
        account_id: account.id.clone(),
    });
    Ok(account)
}

fn session_expired_error() -> LauncherError {
    LauncherError::new(ErrorKind::Auth, "Сессия Microsoft истекла — войдите в аккаунт заново")
}

/// Flags the account so the UI can offer "sign in again".
async fn mark_expired(paths: &Paths, account_id: &str) -> Result<()> {
    let mut accounts = AccountStore::load(paths).await?;
    if let Some(account) = accounts.accounts.iter_mut().find(|a| a.id == account_id) {
        account.expired = true;
        accounts.save(paths).await?;
    }
    Ok(())
}

/// Runs the refresh chain for a Microsoft account, updating its tokens and
/// profile. A revoked grant marks the account expired instead of failing
/// silently on the next launch.
pub async fn refresh(
    client: &reqwest::Client,
    paths: &Paths,
    store: &SecretStore,
    settings: &Settings,
    account_id: &str,
) -> Result<(Account, String, Option<String>)> {
    let client_id = require_client_id(settings)?;

    let Some(refresh_token) = read_secret(store, refresh_key(account_id)).await? else {
        // Tokens wiped from the keyring by hand, or a different machine.
        mark_expired(paths, account_id).await?;
        return Err(session_expired_error());
    };

    let tokens = match msa::refresh(client, &client_id, &refresh_token).await {
        Ok(tokens) => tokens,
        Err(msa::RefreshError::SessionExpired) => {
            mark_expired(paths, account_id).await?;
            return Err(session_expired_error());
        }
        Err(msa::RefreshError::Other(error)) => return Err(error),
    };

    let exchanged = exchange(client, &tokens.access_token, &|_| {}).await?;
    let cached = cached_from(&exchanged.token);
    // Microsoft may rotate the refresh token; keep the old one if it did not.
    let next_refresh = tokens.refresh_token.unwrap_or(refresh_token);
    persist_secrets(store, account_id, &next_refresh, &cached).await?;

    let head = render_head(client, &exchanged.profile).await;
    let mut accounts = AccountStore::load(paths).await?;
    let account = accounts
        .accounts
        .iter_mut()
        .find(|account| account.id == account_id)
        .ok_or_else(|| LauncherError::new(ErrorKind::Auth, "Аккаунт не найден"))?;
    apply_profile(account, &exchanged.profile, head);
    let account = account.clone();
    accounts.save(paths).await?;

    Ok((account, cached.access_token, cached.xuid))
}

/// The session to launch with, refreshing tokens only when they are about to
/// expire — a warm launch costs one keyring read and no network.
pub async fn session_for(
    client: &reqwest::Client,
    paths: &Paths,
    store: &SecretStore,
    settings: &Settings,
    account: &Account,
) -> Result<GameSession> {
    if account.kind == AccountKind::Offline {
        return Ok(GameSession::offline(account));
    }

    let cached = read_secret(store, token_key(&account.id))
        .await?
        .and_then(|raw| serde_json::from_str::<CachedToken>(&raw).ok());

    if let Some(cached) = cached.filter(CachedToken::is_fresh) {
        return Ok(GameSession {
            username: account.username.clone(),
            uuid: account.uuid.clone(),
            access_token: cached.access_token,
            xuid: cached.xuid.unwrap_or_default(),
            user_type: String::from("msa"),
        });
    }

    let (account, access_token, xuid) = refresh(client, paths, store, settings, &account.id).await?;
    Ok(GameSession {
        username: account.username,
        uuid: account.uuid,
        access_token,
        xuid: xuid.unwrap_or_default(),
        user_type: String::from("msa"),
    })
}

/// Background pass at start-up: renews Microsoft accounts whose cached token
/// is stale, so skins and names are current and the first launch is instant.
/// Returns whether anything changed.
pub async fn refresh_stale_accounts(
    client: &reqwest::Client,
    paths: &Paths,
    store: &SecretStore,
    settings: &Settings,
) -> bool {
    if client_id(settings).is_none() {
        return false;
    }
    let Ok(accounts) = AccountStore::load(paths).await else {
        return false;
    };

    let mut changed = false;
    for account in accounts
        .accounts
        .iter()
        .filter(|account| account.kind == AccountKind::Microsoft && !account.expired)
    {
        let fresh = read_secret(store, token_key(&account.id))
            .await
            .ok()
            .flatten()
            .and_then(|raw| serde_json::from_str::<CachedToken>(&raw).ok())
            .is_some_and(|cached| cached.is_fresh());
        if fresh {
            continue;
        }
        // Failures are recorded on the account (expired) or retried at launch;
        // a start-up pass must never surface an error on its own.
        let _ = refresh(client, paths, store, settings, &account.id).await;
        changed = true;
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_refreshed_ahead_of_expiry() {
        let now = chrono::Utc::now().timestamp();
        let token = |expires_at| CachedToken {
            access_token: String::from("t"),
            expires_at,
            xuid: None,
        };
        assert!(token(now + 3600).is_fresh());
        // Inside the safety margin counts as stale.
        assert!(!token(now + 60).is_fresh());
        assert!(!token(now - 1).is_fresh());
    }

    #[test]
    fn the_settings_client_id_wins() {
        let settings = Settings {
            msa_client_id: String::from("  from-settings  "),
            ..Settings::default()
        };
        assert_eq!(client_id(&settings).as_deref(), Some("from-settings"));
    }

    #[test]
    fn device_code_states_match_the_front_end_contract() -> std::result::Result<(), serde_json::Error> {
        let waiting = serde_json::to_value(DeviceCodeState::Waiting {
            user_code: String::from("ABCD-1234"),
            verification_uri: String::from("https://microsoft.com/link"),
            expires_in_seconds: 900,
        })?;
        assert_eq!(waiting["phase"], "waiting");
        assert_eq!(waiting["userCode"], "ABCD-1234");
        assert_eq!(waiting["expiresInSeconds"], 900);

        let step = serde_json::to_value(DeviceCodeState::Exchanging {
            step: ExchangeStep::Xsts,
        })?;
        assert_eq!(step["phase"], "exchanging");
        assert_eq!(step["step"], "xsts");

        let done = serde_json::to_value(DeviceCodeState::Done {
            account_id: String::from("a1"),
        })?;
        assert_eq!(done["accountId"], "a1");
        Ok(())
    }
}
