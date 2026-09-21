//! Headless round trip of pack import/export:
//! import a pack, export it as .mrpack and as zip, import both exports back,
//! and compare what ended up on disk.
//!
//! ```text
//! cargo run --example packs_smoke -- <data-dir> <pack-file-or-folder>
//! ```

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use firlauncher_lib::config::settings::Settings;
use firlauncher_lib::error::Result;
use firlauncher_lib::net::build_client;
use firlauncher_lib::net::download::ProgressSink;
use firlauncher_lib::packs::export::ExportFormat;
use firlauncher_lib::packs::{self, PackContext};
use firlauncher_lib::paths::Paths;
use firlauncher_lib::tasks::Progress;
use tokio_util::sync::CancellationToken;

struct Console {
    bytes: AtomicU64,
    token: CancellationToken,
}

impl ProgressSink for Console {
    fn add_bytes(&self, bytes: u64) {
        self.bytes.fetch_add(bytes, Ordering::Relaxed);
    }
    fn item_finished(&self, _done: usize, _total: usize) {}
}

impl Progress for Console {
    fn set_stage(&self, stage: String) {
        println!("  {stage}");
    }
    fn begin_phase(&self, stage: String, bytes: Option<u64>) {
        println!("  {stage} — {} КБ", bytes.unwrap_or(0) / 1024);
    }
    fn token(&self) -> CancellationToken {
        self.token.clone()
    }
}

fn count(dir: &std::path::Path) -> usize {
    std::fs::read_dir(dir).map(|entries| entries.count()).unwrap_or(0)
}

fn summary(paths: &Paths, id: &str) -> String {
    let game = paths.instance_game_dir(id);
    format!(
        "mods {}, resourcepacks {}, shaderpacks {}, config {}",
        count(&game.join("mods")),
        count(&game.join("resourcepacks")),
        count(&game.join("shaderpacks")),
        count(&game.join("config")),
    )
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let data_dir = args.get(1).cloned().unwrap_or_else(|| String::from("./smoke-data"));
    let source = std::path::PathBuf::from(args.get(2).cloned().unwrap_or_default());

    let paths = Paths::resolve(Some(&data_dir))?;
    paths.ensure()?;
    let settings = Settings::default();
    let client = build_client("firlauncher-smoke@example.invalid")?;
    let ctx = PackContext {
        client: &client,
        paths: &paths,
        settings: &settings,
        progress: Arc::new(Console { bytes: AtomicU64::new(0), token: CancellationToken::new() }),
    };

    // `modrinth:<project>` installs a modpack straight from Modrinth.
    let (meta, skipped) = match source.to_string_lossy().strip_prefix("modrinth:") {
        Some(project) => {
            println!("1. Установка модпака {project} с Modrinth");
            let provider = firlauncher_lib::mods::provider(
                &settings,
                &client,
                firlauncher_lib::mods::ProviderId::Modrinth,
            )?;
            packs::install_from_provider(&ctx, provider.as_ref(), project).await?
        }
        None => {
            println!("1. Импорт {}", source.display());
            packs::import(&ctx, &source).await?
        }
    };
    println!(
        "   сборка «{}» ({}): {} {:?} {}",
        meta.name,
        meta.id,
        meta.mc_version,
        meta.loader,
        meta.loader_version.clone().unwrap_or_default()
    );
    println!("   {}", summary(&paths, &meta.id));
    for file in &skipped {
        println!("   пропущено: {} — {}", file.name, file.reason);
    }

    let out_dir = paths.root().join("exports");
    std::fs::create_dir_all(&out_dir)?;
    for (format, name) in [(ExportFormat::Mrpack, "roundtrip.mrpack"), (ExportFormat::Zip, "roundtrip.zip")] {
        let dest = out_dir.join(name);
        println!("2. Экспорт {name}");
        let result = packs::export::export(&ctx, &meta, format, &dest).await?;
        println!(
            "   ссылками {}, внутри архива {}, {} КБ",
            result.linked,
            result.embedded,
            std::fs::metadata(&dest).map(|m| m.len() / 1024).unwrap_or(0)
        );

        println!("3. Повторный импорт {name}");
        let (again, skipped_again) = packs::import(&ctx, &dest).await?;
        println!("   «{}» ({}): {}", again.name, again.id, summary(&paths, &again.id));
        println!(
            "   лоадер {:?} {}, пропущено {}",
            again.loader,
            again.loader_version.clone().unwrap_or_default(),
            skipped_again.len()
        );
    }
    Ok(())
}
