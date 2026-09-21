//! Terminal sign-in through the exact code path the app uses.
//!
//! Handy for checking an Azure app registration before wiring it into the
//! launcher: it prints the device code, waits for you to confirm it, walks the
//! Xbox -> XSTS -> Minecraft chain and prints the profile. Tokens are kept in
//! memory only; nothing touches the OS keyring or your real accounts.json.
//!
//! ```text
//! cargo run --example msa_login -- <azure-client-id>
//! ```

use std::sync::Arc;

use firlauncher_lib::auth::secrets::{MemoryBackend, SecretStore};
use firlauncher_lib::auth::{self, DeviceCodeState};
use firlauncher_lib::config::settings::Settings;
use firlauncher_lib::error::Result;
use firlauncher_lib::net::build_client;
use firlauncher_lib::paths::Paths;
use tokio_util::sync::CancellationToken;

#[tokio::main]
async fn main() -> Result<()> {
    let client_id = std::env::args().nth(1).unwrap_or_default();
    let settings = Settings {
        msa_client_id: client_id,
        ..Settings::default()
    };

    let scratch = std::env::temp_dir().join("firlauncher-msa-probe");
    let paths = Paths::resolve(Some(&scratch.to_string_lossy()))?;
    paths.ensure()?;

    let client = build_client("")?;
    let store = SecretStore::new(Arc::new(MemoryBackend::default()));
    let cancel = CancellationToken::new();

    let emit = |state: DeviceCodeState| match state {
        DeviceCodeState::Requesting => println!("Запрос кода у Microsoft..."),
        DeviceCodeState::Waiting {
            user_code,
            verification_uri,
            expires_in_seconds,
        } => {
            println!("\n  Откройте {verification_uri}");
            println!("  и введите код  {user_code}");
            println!("  (действителен {} мин)\n", expires_in_seconds / 60);
        }
        DeviceCodeState::Exchanging { step } => println!("  шаг: {step:?}"),
        DeviceCodeState::Done { account_id } => println!("Готово, аккаунт {account_id}"),
        DeviceCodeState::Failed { message } => println!("Ошибка: {message}"),
    };

    match auth::login(&client, &paths, &store, &settings, &cancel, &emit).await {
        Ok(account) => {
            println!("\nИгрок:  {}", account.username);
            println!("UUID:   {}", account.uuid);
            println!("Скин:   {}", account.skin_url.unwrap_or_default());
        }
        Err(error) => {
            println!("\n{}", error.message);
            if let Some(detail) = error.detail {
                println!("  {detail}");
            }
        }
    }

    let _ = std::fs::remove_dir_all(&scratch);
    Ok(())
}
