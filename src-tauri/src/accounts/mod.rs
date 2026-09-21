//! Accounts and their on-disk store.
//!
//! Stage 2 only needs offline accounts; the Microsoft device-code flow lands
//! in stage 3 and will add its tokens to the system keyring, never to this
//! file.

use serde::{Deserialize, Serialize};

use crate::config::{read_json_opt, write_json_atomic};
use crate::error::{ErrorKind, LauncherError, Result};
use crate::paths::Paths;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AccountKind {
    Microsoft,
    Offline,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub kind: AccountKind,
    pub username: String,
    pub uuid: String,
    pub avatar_url: Option<String>,
    pub skin_url: Option<String>,
    #[serde(default)]
    pub expired: bool,
    pub added_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AccountStore {
    #[serde(default)]
    pub accounts: Vec<Account>,
}

impl AccountStore {
    pub async fn load(paths: &Paths) -> Result<Self> {
        Ok(read_json_opt::<Self>(&paths.accounts_file())
            .await?
            .unwrap_or_default())
    }

    pub async fn save(&self, paths: &Paths) -> Result<()> {
        write_json_atomic(&paths.accounts_file(), self).await
    }

    pub fn find(&self, id: &str) -> Option<&Account> {
        self.accounts.iter().find(|account| account.id == id)
    }
}

/// Minecraft's own offline UUID: an MD5 name-based UUID over
/// `OfflinePlayer:<name>`, with no namespace — exactly what
/// `UUID.nameUUIDFromBytes` produces in the vanilla client.
pub fn offline_uuid(username: &str) -> String {
    use md5::{Digest, Md5};

    let mut hasher = Md5::new();
    hasher.update(format!("OfflinePlayer:{username}").as_bytes());
    let mut bytes: [u8; 16] = hasher.finalize().into();

    bytes[6] = (bytes[6] & 0x0f) | 0x30; // version 3
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant

    uuid::Uuid::from_bytes(bytes).to_string()
}

const USERNAME_MAX: usize = 16;
const USERNAME_MIN: usize = 3;

pub fn validate_username(username: &str) -> Result<String> {
    let trimmed = username.trim();
    let valid_length = (USERNAME_MIN..=USERNAME_MAX).contains(&trimmed.chars().count());
    let valid_chars = trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_');

    if !valid_length || !valid_chars {
        return Err(LauncherError::new(
            ErrorKind::Auth,
            "Ник: от 3 до 16 символов, латиница, цифры и «_»",
        ));
    }
    Ok(trimmed.to_owned())
}

pub fn new_offline(username: &str) -> Result<Account> {
    let username = validate_username(username)?;
    Ok(Account {
        id: uuid::Uuid::new_v4().to_string(),
        kind: AccountKind::Offline,
        uuid: offline_uuid(&username),
        username,
        avatar_url: None,
        skin_url: None,
        expired: false,
        added_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offline_uuid_matches_vanilla_algorithm() {
        // Values produced by Java's UUID.nameUUIDFromBytes("OfflinePlayer:<name>").
        assert_eq!(offline_uuid("Notch"), "b50ad385-829d-3141-a216-7e7d7539ba7f");
        assert_eq!(
            offline_uuid("SmokeTester"),
            "c0331953-99bf-361a-b929-38d6e6ae6ba4"
        );
    }

    #[test]
    fn username_rules_match_mojang() {
        assert!(validate_username("Steve").is_ok());
        assert!(validate_username("  Steve_99 ").is_ok());
        assert!(validate_username("ab").is_err());
        assert!(validate_username("seventeen_chars77").is_err());
        assert!(validate_username("bad name").is_err());
        assert!(validate_username("плохо").is_err());
    }
}
