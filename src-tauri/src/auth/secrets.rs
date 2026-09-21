//! Token storage in the operating system's credential store.
//!
//! Tokens never touch `accounts.json`: that file only names the account. The
//! secrets live in Windows Credential Manager, the macOS Keychain or the
//! Secret Service on Linux.
//!
//! Windows caps one credential at 2560 bytes, and Microsoft refresh tokens
//! plus a Minecraft JWT can get close to that, so values are split into
//! chunks behind a small header entry.

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;

use crate::error::{ErrorKind, LauncherError, Result};

pub const SERVICE: &str = "FirLauncher";

/// Well below the Windows limit, leaving room for the backend's own framing.
const CHUNK_BYTES: usize = 1800;
const HEADER_PREFIX: &str = "chunks:";

/// One flat key/value namespace. Implementations must be thread-safe; calls
/// may block, so async callers go through `spawn_blocking`.
pub trait SecretBackend: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>>;
    fn set(&self, key: &str, value: &[u8]) -> Result<()>;
    fn delete(&self, key: &str) -> Result<()>;
}

fn keyring_error(action: &str, error: &keyring::Error) -> LauncherError {
    let hint = if cfg!(target_os = "linux") {
        "\nНа Linux нужна служба Secret Service (gnome-keyring или KWallet)."
    } else {
        ""
    };
    LauncherError::new(
        ErrorKind::Auth,
        format!("Системное хранилище паролей недоступно: не удалось {action}"),
    )
    .with_detail(format!("{error}{hint}"))
}

/// The real, OS-backed store.
pub struct KeyringBackend;

impl SecretBackend for KeyringBackend {
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>> {
        let entry =
            keyring::Entry::new(SERVICE, key).map_err(|error| keyring_error("открыть запись", &error))?;
        match entry.get_secret() {
            Ok(bytes) => Ok(Some(bytes)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(keyring_error("прочитать токен", &error)),
        }
    }

    fn set(&self, key: &str, value: &[u8]) -> Result<()> {
        let entry =
            keyring::Entry::new(SERVICE, key).map_err(|error| keyring_error("открыть запись", &error))?;
        entry
            .set_secret(value)
            .map_err(|error| keyring_error("сохранить токен", &error))
    }

    fn delete(&self, key: &str) -> Result<()> {
        let entry =
            keyring::Entry::new(SERVICE, key).map_err(|error| keyring_error("открыть запись", &error))?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(keyring_error("удалить токен", &error)),
        }
    }
}

/// In-process store for tests and for platforms without a keyring daemon.
#[derive(Default)]
pub struct MemoryBackend {
    values: Mutex<HashMap<String, Vec<u8>>>,
}

impl SecretBackend for MemoryBackend {
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>> {
        Ok(self.values.lock().get(key).cloned())
    }

    fn set(&self, key: &str, value: &[u8]) -> Result<()> {
        self.values.lock().insert(key.to_owned(), value.to_vec());
        Ok(())
    }

    fn delete(&self, key: &str) -> Result<()> {
        self.values.lock().remove(key);
        Ok(())
    }
}

/// Chunked string storage on top of any backend.
#[derive(Clone)]
pub struct SecretStore {
    backend: Arc<dyn SecretBackend>,
}

fn chunk_key(key: &str, index: usize) -> String {
    format!("{key}#{index}")
}

impl SecretStore {
    pub fn new(backend: Arc<dyn SecretBackend>) -> Self {
        Self { backend }
    }

    pub fn keyring() -> Self {
        Self::new(Arc::new(KeyringBackend))
    }

    fn chunk_count(&self, key: &str) -> Result<Option<usize>> {
        let Some(header) = self.backend.get(key)? else {
            return Ok(None);
        };
        let header = String::from_utf8(header).map_err(|_| {
            LauncherError::new(ErrorKind::Auth, "Запись в хранилище паролей повреждена")
        })?;
        let count = header
            .strip_prefix(HEADER_PREFIX)
            .and_then(|value| value.parse::<usize>().ok())
            .ok_or_else(|| {
                LauncherError::new(ErrorKind::Auth, "Запись в хранилище паролей повреждена")
            })?;
        Ok(Some(count))
    }

    /// Stores a secret, replacing any previous value under the same key.
    pub fn put(&self, key: &str, secret: &str) -> Result<()> {
        // Clear first: a shorter new value must not leave stale tail chunks.
        self.remove(key)?;

        let bytes = secret.as_bytes();
        let chunks: Vec<&[u8]> = if bytes.is_empty() {
            vec![&[][..]]
        } else {
            bytes.chunks(CHUNK_BYTES).collect()
        };
        for (index, chunk) in chunks.iter().enumerate() {
            self.backend.set(&chunk_key(key, index), chunk)?;
        }
        // The header goes last, so a reader never sees a half-written value.
        self.backend
            .set(key, format!("{HEADER_PREFIX}{}", chunks.len()).as_bytes())
    }

    pub fn get(&self, key: &str) -> Result<Option<String>> {
        let Some(count) = self.chunk_count(key)? else {
            return Ok(None);
        };

        let mut bytes = Vec::new();
        for index in 0..count {
            match self.backend.get(&chunk_key(key, index))? {
                Some(chunk) => bytes.extend_from_slice(&chunk),
                // Someone removed part of the value by hand; treat it as gone.
                None => return Ok(None),
            }
        }
        String::from_utf8(bytes).map(Some).map_err(|_| {
            LauncherError::new(ErrorKind::Auth, "Токен в хранилище паролей повреждён")
        })
    }

    pub fn remove(&self, key: &str) -> Result<()> {
        if let Some(count) = self.chunk_count(key).ok().flatten() {
            for index in 0..count {
                self.backend.delete(&chunk_key(key, index))?;
            }
        }
        self.backend.delete(key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> SecretStore {
        SecretStore::new(Arc::new(MemoryBackend::default()))
    }

    #[test]
    fn roundtrips_small_and_large_values() -> Result<()> {
        let store = store();
        store.put("a", "short")?;
        assert_eq!(store.get("a")?.as_deref(), Some("short"));

        // Larger than one Windows credential can hold.
        let big: String = "x".repeat(CHUNK_BYTES * 3 + 17);
        store.put("b", &big)?;
        assert_eq!(store.get("b")?, Some(big));
        Ok(())
    }

    #[test]
    fn a_shorter_value_leaves_no_stale_chunks() -> Result<()> {
        let backend = Arc::new(MemoryBackend::default());
        let store = SecretStore::new(Arc::clone(&backend) as Arc<dyn SecretBackend>);

        store.put("k", &"y".repeat(CHUNK_BYTES * 2 + 1))?;
        store.put("k", "tiny")?;

        assert_eq!(store.get("k")?.as_deref(), Some("tiny"));
        assert!(backend.get(&chunk_key("k", 1))?.is_none());
        assert!(backend.get(&chunk_key("k", 2))?.is_none());
        Ok(())
    }

    #[test]
    fn removal_is_complete_and_idempotent() -> Result<()> {
        let backend = Arc::new(MemoryBackend::default());
        let store = SecretStore::new(Arc::clone(&backend) as Arc<dyn SecretBackend>);

        store.put("k", &"z".repeat(CHUNK_BYTES + 5))?;
        store.remove("k")?;
        store.remove("k")?;

        assert!(store.get("k")?.is_none());
        assert!(backend.values.lock().is_empty());
        Ok(())
    }

    #[test]
    fn multibyte_text_survives_chunk_boundaries() -> Result<()> {
        // Chunks split bytes, not characters; reassembly must still be exact.
        let store = store();
        let text: String = "ключ".repeat(CHUNK_BYTES);
        store.put("u", &text)?;
        assert_eq!(store.get("u")?, Some(text));
        Ok(())
    }

    /// Touches the real OS credential store. Run explicitly:
    /// `cargo test --lib real_keyring -- --ignored`
    #[test]
    #[ignore = "writes to the real OS credential store"]
    fn real_keyring_roundtrip() -> Result<()> {
        let store = SecretStore::keyring();
        let key = "firlauncher-selftest";
        let value: String = "t".repeat(CHUNK_BYTES * 2 + 300);
        store.put(key, &value)?;
        let read = store.get(key)?;
        store.remove(key)?;
        assert_eq!(read, Some(value));
        assert!(store.get(key)?.is_none());
        Ok(())
    }
}
