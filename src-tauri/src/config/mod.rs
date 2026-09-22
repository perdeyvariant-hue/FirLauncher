//! On-disk configuration: the global settings file and small JSON helpers
//! shared with the instance metadata.

pub mod appearance;
pub mod settings;

use std::path::Path;

use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::error::{LauncherError, Result};

/// Reads JSON, returning `None` when the file simply is not there yet.
pub async fn read_json_opt<T: DeserializeOwned>(path: &Path) -> Result<Option<T>> {
    let bytes = match tokio::fs::read(path).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(
                LauncherError::io(format!("Не удалось прочитать {}", path.display()))
                    .with_detail(error.to_string()),
            )
        }
    };

    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|error| {
            LauncherError::new(
                crate::error::ErrorKind::Parse,
                format!("Повреждён файл {}", path.display()),
            )
            .with_detail(error.to_string())
        })
}

/// Writes JSON through a temporary file so a crash mid-write cannot leave a
/// truncated config behind.
pub async fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|error| {
            LauncherError::io(format!("Не удалось создать папку {}", parent.display()))
                .with_detail(error.to_string())
        })?;
    }

    let bytes = serde_json::to_vec_pretty(value)?;
    let mut temp = path.as_os_str().to_os_string();
    temp.push(".tmp");
    let temp = std::path::PathBuf::from(temp);

    tokio::fs::write(&temp, &bytes).await.map_err(|error| {
        LauncherError::io(format!("Не удалось записать {}", temp.display()))
            .with_detail(error.to_string())
    })?;

    tokio::fs::rename(&temp, path).await.map_err(|error| {
        LauncherError::io(format!("Не удалось сохранить {}", path.display()))
            .with_detail(error.to_string())
    })
}
