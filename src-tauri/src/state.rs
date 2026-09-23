//! Process-wide state handed to every command.

use std::sync::Arc;

use parking_lot::{Mutex, RwLock};
use tauri::AppHandle;
use tokio_util::sync::CancellationToken;

use crate::auth::secrets::SecretStore;
use crate::config::settings::Settings;
use crate::error::Result;
use crate::minecraft::launch::GameRegistry;
use crate::net::build_client;
use crate::paths::Paths;
use crate::tasks::TaskManager;

pub struct AppState {
    pub paths: Paths,
    settings: RwLock<Settings>,
    /// Rebuilt when the contact e-mail changes, since it lives in the
    /// User-Agent that Modrinth and CurseForge ask for.
    http: RwLock<reqwest::Client>,
    pub tasks: Arc<TaskManager>,
    pub games: Arc<GameRegistry>,
    /// Discord Rich Presence while a game runs.
    pub presence: Arc<crate::presence::Presence>,
    /// OS keyring holding refresh and Minecraft tokens.
    pub secrets: SecretStore,
    /// The Microsoft sign-in in progress, if any; only one at a time.
    login: Mutex<Option<CancellationToken>>,
}

impl AppState {
    pub fn new(app: AppHandle, paths: Paths, settings: Settings) -> Result<Self> {
        let http = build_client(&settings.contact_email)?;
        Ok(Self {
            paths,
            settings: RwLock::new(settings),
            http: RwLock::new(http),
            tasks: Arc::new(TaskManager::new(app)),
            games: Arc::new(GameRegistry::default()),
            presence: Arc::new(crate::presence::Presence::default()),
            secrets: SecretStore::keyring(),
            login: Mutex::new(None),
        })
    }

    pub fn settings(&self) -> Settings {
        self.settings.read().clone()
    }

    /// Starts a sign-in, cancelling any previous one still waiting for a code.
    pub fn begin_login(&self) -> CancellationToken {
        let token = CancellationToken::new();
        if let Some(previous) = self.login.lock().replace(token.clone()) {
            previous.cancel();
        }
        token
    }

    pub fn cancel_login(&self) {
        if let Some(token) = self.login.lock().take() {
            token.cancel();
        }
    }

    pub fn client(&self) -> reqwest::Client {
        self.http.read().clone()
    }

    /// Stores new settings, rebuilding the HTTP client when the identity we
    /// present to third-party APIs changed.
    pub fn replace_settings(&self, next: Settings) -> Result<()> {
        let contact_changed = {
            let current = self.settings.read();
            current.contact_email != next.contact_email
        };
        if contact_changed {
            let client = build_client(&next.contact_email)?;
            *self.http.write() = client;
        }
        *self.settings.write() = next;
        Ok(())
    }
}
