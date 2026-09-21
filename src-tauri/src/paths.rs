//! Where the launcher keeps its data on each platform.
//!
//! ```text
//! <data>/instances/<id>/{instance.json, .minecraft/}
//! <data>/meta/       manifest caches
//! <data>/assets/     shared Minecraft assets
//! <data>/libraries/  shared libraries
//! <data>/java/       downloaded JDKs
//! <data>/accounts.json, settings.json
//! ```

use std::path::{Path, PathBuf};

use crate::error::{LauncherError, Result};

pub const APP_DIR_NAME: &str = "FirLauncher";

#[derive(Debug, Clone)]
pub struct Paths {
    root: PathBuf,
}

impl Paths {
    /// Resolves the data root, honouring an explicit override from settings.
    pub fn resolve(override_dir: Option<&str>) -> Result<Self> {
        let root = match override_dir {
            Some(value) if !value.trim().is_empty() => PathBuf::from(value.trim()),
            _ => dirs::data_dir()
                .ok_or_else(|| {
                    LauncherError::io("Не удалось определить папку данных пользователя")
                })?
                .join(APP_DIR_NAME),
        };
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn instances(&self) -> PathBuf {
        self.root.join("instances")
    }

    pub fn instance(&self, id: &str) -> PathBuf {
        self.instances().join(id)
    }

    /// The game directory of an instance — fully isolated per instance.
    pub fn instance_game_dir(&self, id: &str) -> PathBuf {
        self.instance(id).join(".minecraft")
    }

    pub fn meta(&self) -> PathBuf {
        self.root.join("meta")
    }

    pub fn assets(&self) -> PathBuf {
        self.root.join("assets")
    }

    pub fn libraries(&self) -> PathBuf {
        self.root.join("libraries")
    }

    pub fn versions(&self) -> PathBuf {
        self.root.join("versions")
    }

    /// Client jars are shared between instances that use the same version.
    pub fn client_jar(&self, version_id: &str) -> PathBuf {
        self.versions()
            .join(version_id)
            .join(format!("{version_id}.jar"))
    }

    /// Unpacked natives live inside the instance so nothing is shared that a
    /// mod could overwrite for everyone.
    pub fn instance_natives(&self, id: &str) -> PathBuf {
        self.instance(id).join("natives")
    }

    pub fn instance_meta_file(&self, id: &str) -> PathBuf {
        self.instance(id).join("instance.json")
    }

    pub fn java(&self) -> PathBuf {
        self.root.join("java")
    }

    pub fn settings_file(&self) -> PathBuf {
        self.root.join("settings.json")
    }

    pub fn accounts_file(&self) -> PathBuf {
        self.root.join("accounts.json")
    }

    /// Creates the directory skeleton. Safe to call on every start.
    pub fn ensure(&self) -> Result<()> {
        for dir in [
            self.root.clone(),
            self.instances(),
            self.meta(),
            self.assets(),
            self.libraries(),
            self.java(),
            self.versions(),
        ] {
            std::fs::create_dir_all(&dir).map_err(|error| {
                LauncherError::io(format!("Не удалось создать папку {}", dir.display()))
                    .with_detail(error.to_string())
            })?;
        }
        Ok(())
    }
}
