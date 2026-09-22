//! Global settings — the mirror of `src/types/settings.ts`.

use serde::{Deserialize, Serialize};

use crate::config::appearance::Appearance;
use crate::config::{read_json_opt, write_json_atomic};
use crate::error::Result;
use crate::paths::Paths;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    Dark,
    Light,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub theme: ThemeMode,
    pub default_memory_mb: u32,
    pub default_jvm_args: String,
    pub max_concurrent_downloads: usize,
    /// Empty means CurseForge stays hidden in the UI.
    pub curseforge_api_key: String,
    /// Goes into the User-Agent, as Modrinth and CurseForge require.
    pub contact_email: String,
    pub close_launcher_on_launch: bool,
    pub show_snapshots: bool,
    pub data_dir_override: String,
    /// Azure application id for Microsoft sign-in. Empty falls back to the id
    /// baked in at build time via FIRLAUNCHER_MSA_CLIENT_ID.
    pub msa_client_id: String,
    /// Colours, wallpaper, mascot and interface tweaks.
    pub appearance: Appearance,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: ThemeMode::Dark,
            default_memory_mb: 4096,
            default_jvm_args: String::from(
                "-XX:+UseG1GC -XX:+UnlockExperimentalVMOptions -XX:G1NewSizePercent=20",
            ),
            max_concurrent_downloads: 16,
            curseforge_api_key: String::new(),
            contact_email: String::new(),
            close_launcher_on_launch: false,
            show_snapshots: false,
            data_dir_override: String::new(),
            msa_client_id: String::new(),
            appearance: Appearance::default(),
        }
    }
}

impl Settings {
    pub async fn load(paths: &Paths) -> Result<Self> {
        let loaded: Option<Self> = read_json_opt(&paths.settings_file()).await?;
        let mut settings = loaded.unwrap_or_default();
        settings.appearance = settings.appearance.sanitized();
        Ok(settings)
    }

    pub async fn save(&self, paths: &Paths) -> Result<()> {
        write_json_atomic(&paths.settings_file(), self).await
    }

    /// Bounded so a hand-edited file cannot open 5000 sockets.
    pub fn download_concurrency(&self) -> usize {
        self.max_concurrent_downloads.clamp(1, 32)
    }
}
