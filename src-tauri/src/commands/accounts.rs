use tauri::{AppHandle, Emitter, State};

use crate::accounts::{self, Account, AccountKind, AccountStore};
use crate::auth::{self, DeviceCodeState, EVENT_DEVICE_CODE};
use crate::error::{ErrorKind, LauncherError, Result};
use crate::state::AppState;

#[tauri::command]
pub async fn list_accounts(state: State<'_, AppState>) -> Result<Vec<Account>> {
    Ok(AccountStore::load(&state.paths).await?.accounts)
}

#[tauri::command]
pub async fn add_offline_account(
    state: State<'_, AppState>,
    username: String,
) -> Result<Account> {
    let mut store = AccountStore::load(&state.paths).await?;
    let account = accounts::new_offline(&username)?;

    if store.accounts.iter().any(|existing| {
        existing.kind == AccountKind::Offline
            && existing.username.eq_ignore_ascii_case(&account.username)
    }) {
        return Err(LauncherError::new(
            ErrorKind::Auth,
            format!("Оффлайн-аккаунт «{}» уже добавлен", account.username),
        ));
    }

    store.accounts.push(account.clone());
    store.save(&state.paths).await?;
    Ok(account)
}

#[tauri::command]
pub async fn remove_account(state: State<'_, AppState>, id: String) -> Result<()> {
    let mut store = AccountStore::load(&state.paths).await?;
    let before = store.accounts.len();
    store.accounts.retain(|account| account.id != id);
    if store.accounts.len() == before {
        return Err(LauncherError::new(ErrorKind::Auth, "Аккаунт не найден"));
    }
    store.save(&state.paths).await?;

    // The row is gone either way; a keyring hiccup must not resurrect it, so
    // secret removal is best effort.
    let _ = auth::forget(&state.secrets, &id).await;
    Ok(())
}

#[tauri::command]
pub async fn refresh_account(state: State<'_, AppState>, id: String) -> Result<Account> {
    let store = AccountStore::load(&state.paths).await?;
    let account = store
        .find(&id)
        .cloned()
        .ok_or_else(|| LauncherError::new(ErrorKind::Auth, "Аккаунт не найден"))?;

    if account.kind == AccountKind::Offline {
        // Nothing to renew: offline accounts carry no tokens.
        return Ok(account);
    }

    let (account, _, _) = auth::refresh(
        &state.client(),
        &state.paths,
        &state.secrets,
        &state.settings(),
        &id,
    )
    .await?;
    Ok(account)
}

/// Starts the device-code flow in the background. Progress, the code to show
/// and the outcome all arrive through `auth://device-code`.
#[tauri::command]
pub async fn begin_microsoft_login(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    let settings = state.settings();
    // Fail fast on configuration, before the dialog starts spinning.
    if auth::client_id(&settings).is_none() {
        return Err(LauncherError::new(
            ErrorKind::Auth,
            "Не задан Client ID приложения Azure. Укажите его в «Настройки → Вход через \
             Microsoft» — как получить, описано в README",
        ));
    }

    let cancel = state.begin_login();
    let client = state.client();
    let paths = state.paths.clone();
    let secrets = state.secrets.clone();

    tokio::spawn(async move {
        let emitter = app.clone();
        let emit = move |event: DeviceCodeState| {
            let _ = emitter.emit(EVENT_DEVICE_CODE, event);
        };

        let outcome = auth::login(&client, &paths, &secrets, &settings, &cancel, &emit).await;
        if let Err(error) = outcome {
            // A cancelled dialog is already closed; nobody is waiting for news.
            if error.kind != ErrorKind::Cancelled {
                let message = match &error.detail {
                    Some(detail) => format!("{}\n\n{detail}", error.message),
                    None => error.message.clone(),
                };
                emit(DeviceCodeState::Failed { message });
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn cancel_microsoft_login(state: State<'_, AppState>) -> Result<()> {
    state.cancel_login();
    Ok(())
}
