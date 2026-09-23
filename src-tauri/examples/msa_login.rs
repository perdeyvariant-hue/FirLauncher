//! Terminal sign-in through the exact code path the app uses.
//!
//! The app opens Microsoft's page in a window of its own and reads the code
//! out of the redirect; here you open the page in your browser and paste the
//! address it ends up at. Everything after that — Xbox, XSTS, Minecraft,
//! profile — is the same code. Tokens are kept in memory only; nothing
//! touches the OS keyring or your real accounts.json.
//!
//! ```text
//! cargo run --example msa_login
//! ```

use std::io::Write;
use std::sync::Arc;

use firlauncher_lib::auth::secrets::{MemoryBackend, SecretStore};
use firlauncher_lib::auth::{self, msa, LoginState};
use firlauncher_lib::error::{ErrorKind, LauncherError, Result};
use firlauncher_lib::net::build_client;
use firlauncher_lib::paths::Paths;

/// Stands in for the sign-in window: prints the page to open and waits for
/// the address it finished on.
async fn ask_code() -> Result<String> {
    println!("\n  1. Откройте в браузере:\n\n{}\n", msa::authorize_url());
    println!("  2. Войдите. Страница станет пустой — это и есть редирект.");
    println!("  3. Скопируйте её адрес целиком и вставьте сюда:\n");
    print!("  > ");
    let _ = std::io::stdout().flush();

    let mut line = String::new();
    std::io::stdin()
        .read_line(&mut line)
        .map_err(|error| LauncherError::internal("Не прочитать ввод").with_detail(error.to_string()))?;

    let url = url::Url::parse(line.trim()).map_err(|error| {
        LauncherError::new(ErrorKind::Auth, "Это не адрес").with_detail(error.to_string())
    })?;
    msa::code_from_redirect(&url).unwrap_or_else(|| {
        Err(LauncherError::new(
            ErrorKind::Auth,
            "В этом адресе нет кода — нужен тот, что начинается с oauth20_desktop.srf",
        ))
    })
}

#[tokio::main]
async fn main() -> Result<()> {
    let scratch = std::env::temp_dir().join("firlauncher-msa-probe");
    let paths = Paths::resolve(Some(&scratch.to_string_lossy()))?;
    paths.ensure()?;

    let client = build_client("")?;
    let store = SecretStore::new(Arc::new(MemoryBackend::default()));

    let emit = |state: LoginState| match state {
        LoginState::Waiting => println!("Ожидание входа..."),
        LoginState::Cancelled => println!("Вход отменён"),
        LoginState::Exchanging { step } => println!("  шаг: {step:?}"),
        LoginState::Done { account_id } => println!("Готово, аккаунт {account_id}"),
        LoginState::Failed { message } => println!("Ошибка: {message}"),
    };

    match auth::login(&client, &paths, &store, &emit, ask_code()).await {
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
