//! Headless end-to-end check of the stage-2 core.
//!
//! Installs a vanilla version into a throwaway data directory, resolves a JVM
//! and either prints the exact launch command or runs it for a few seconds and
//! reports what the game logged.
//!
//! ```text
//! cargo run --example vanilla_smoke -- <version> <data-dir> [--run <seconds>]
//!     [--loader fabric|quilt|forge|neoforge <loader-version|latest>]
//! ```

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use firlauncher_lib::accounts;
use firlauncher_lib::config::settings::Settings;
use firlauncher_lib::error::Result;
use firlauncher_lib::instances::{InstanceJava, InstanceMeta, ModLoader};
use firlauncher_lib::minecraft::{install, session};
use firlauncher_lib::net::build_client;
use firlauncher_lib::net::download::ProgressSink;
use firlauncher_lib::paths::Paths;
use firlauncher_lib::tasks::Progress;
use tokio_util::sync::CancellationToken;

/// Prints what the task bar would show.
struct ConsoleProgress {
    bytes: AtomicU64,
    total: AtomicU64,
    token: CancellationToken,
}

impl ConsoleProgress {
    fn new() -> Self {
        Self {
            bytes: AtomicU64::new(0),
            total: AtomicU64::new(0),
            token: CancellationToken::new(),
        }
    }
}

impl ProgressSink for ConsoleProgress {
    fn add_bytes(&self, bytes: u64) {
        self.bytes.fetch_add(bytes, Ordering::Relaxed);
    }

    fn item_finished(&self, done: usize, total: usize) {
        if done == total || done % 250 == 0 {
            let mb = self.bytes.load(Ordering::Relaxed) / (1024 * 1024);
            let expected = self.total.load(Ordering::Relaxed) / (1024 * 1024);
            println!("    {done}/{total} файлов, {mb} МБ из {expected} МБ");
        }
    }
}

impl Progress for ConsoleProgress {
    fn set_stage(&self, stage: String) {
        println!("  {stage}");
    }

    fn begin_phase(&self, stage: String, bytes_total: Option<u64>) {
        self.bytes.store(0, Ordering::Relaxed);
        self.total.store(bytes_total.unwrap_or(0), Ordering::Relaxed);
        println!(
            "  {stage} — {} МБ",
            bytes_total.unwrap_or(0) / (1024 * 1024)
        );
    }

    fn token(&self) -> CancellationToken {
        self.token.clone()
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let version_id = args.get(1).cloned().unwrap_or_else(|| String::from("1.20.4"));
    let data_dir = args.get(2).cloned().unwrap_or_else(|| String::from("./smoke-data"));
    let run_seconds: Option<u64> = args
        .iter()
        .position(|arg| arg == "--run")
        .and_then(|index| args.get(index + 1))
        .and_then(|value| value.parse().ok());
    let loader_arg = args
        .iter()
        .position(|arg| arg == "--loader")
        .map(|index| (args.get(index + 1).cloned(), args.get(index + 2).cloned()));
    let loader = match loader_arg.as_ref().and_then(|(name, _)| name.as_deref()) {
        Some("fabric") => ModLoader::Fabric,
        Some("quilt") => ModLoader::Quilt,
        Some("forge") => ModLoader::Forge,
        Some("neoforge") => ModLoader::NeoForge,
        _ => ModLoader::Vanilla,
    };

    let paths = Paths::resolve(Some(&data_dir))?;
    paths.ensure()?;
    println!("Данные: {}", paths.root().display());

    let settings = Settings::default();
    let client = build_client(&settings.contact_email)?;
    let progress: Arc<dyn Progress> = Arc::new(ConsoleProgress::new());
    // `--instance <id>` launches an existing instance (e.g. an imported pack).
    let existing = args
        .iter()
        .position(|arg| arg == "--instance")
        .and_then(|index| args.get(index + 1))
        .cloned();
    let instance_id = existing.clone().unwrap_or_else(|| String::from("smoke"));
    firlauncher_lib::instances::ensure_layout(&paths, &instance_id).await?;

    // Same path as the Play button: pick a loader build, install its profile.
    let mut loader_version = loader_arg.and_then(|(_, version)| version);
    if loader != ModLoader::Vanilla && loader_version.as_deref().is_none_or(|v| v == "latest") {
        let builds = firlauncher_lib::loaders::list_versions(&client, loader, &version_id).await?;
        println!("{} для {version_id}: {} сборок", loader.label(), builds.len());
        loader_version = builds
            .iter()
            .find(|build| build.recommended)
            .or_else(|| builds.first())
            .map(|build| build.version.clone());
    }

    let meta = match &existing {
        Some(id) => firlauncher_lib::instances::read_meta(&paths, id).await?,
        None => InstanceMeta {
        id: String::from("smoke"),
        name: String::from("Smoke"),
        icon_file: None,
        mc_version: version_id.clone(),
        loader,
        loader_version: loader_version.clone(),
        profile_id: None,
        created_at: String::new(),
        last_played_at: None,
        total_play_seconds: 0,
        group: None,
        java: InstanceJava::default(),
    },
    };

    let started = std::time::Instant::now();
    let loader_ctx = firlauncher_lib::loaders::LoaderContext {
        client: &client,
        paths: &paths,
        concurrency: settings.download_concurrency(),
        progress: Arc::clone(&progress),
        instance_id: &instance_id,
    };
    let profile_id = firlauncher_lib::loaders::ensure_profile(&loader_ctx, &meta).await?;
    println!("Профиль: {profile_id}");

    println!("Установка {profile_id}...");
    let installed = install::ensure_installed(
        &client,
        &paths,
        &instance_id,
        &profile_id,
        settings.download_concurrency(),
        Arc::clone(&progress),
    )
    .await?;
    println!(
        "Готово за {:.1} с: classpath {} записей, нативы {}",
        started.elapsed().as_secs_f64(),
        installed.classpath.len(),
        installed.natives_dir.display()
    );

    let required = firlauncher_lib::java::major_for_declared(installed.version.required_java_major());
    println!("Требуется Java {required}");
    let java_binary =
        session::resolve_java(&client, &paths, None, required, Arc::clone(&progress)).await?;
    println!("Java: {}", java_binary.display());

    let account = accounts::new_offline("SmokeTester")?;

    let game_session = firlauncher_lib::auth::GameSession::offline(&account);
    let spec =
        session::build_spec(&paths, &meta, &game_session, &settings, &installed, java_binary)?;

    println!("\nКоманда запуска:");
    println!("  {}", spec.java_binary.display());
    for argument in &spec.arguments {
        // The classpath is thousands of characters; show only its size.
        if argument.len() > 200 {
            println!("    <{} символов>", argument.len());
        } else {
            println!("    {argument}");
        }
    }
    println!("  cwd: {}", spec.working_dir.display());

    let Some(seconds) = run_seconds else {
        return Ok(());
    };

    println!("\nЗапуск на {seconds} с...");
    let mut command = tokio::process::Command::new(&spec.java_binary);
    command
        .args(&spec.arguments)
        .current_dir(&spec.working_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = command.spawn().map_err(|error| {
        firlauncher_lib::error::LauncherError::new(
            firlauncher_lib::error::ErrorKind::Java,
            "Не удалось запустить Java",
        )
        .with_detail(error.to_string())
    })?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let printer = |label: &'static str, pipe: Option<tokio::process::ChildStdout>| {
        if let Some(pipe) = pipe {
            tokio::spawn(async move {
                use tokio::io::AsyncBufReadExt;
                let mut lines = tokio::io::BufReader::new(pipe).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    println!("[{label}] {line}");
                }
            });
        }
    };
    printer("out", stdout);
    if let Some(pipe) = stderr {
        tokio::spawn(async move {
            use tokio::io::AsyncBufReadExt;
            let mut lines = tokio::io::BufReader::new(pipe).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                println!("[err] {line}");
            }
        });
    }

    tokio::select! {
        status = child.wait() => {
            println!("Игра завершилась сама: {status:?}");
        }
        () = tokio::time::sleep(std::time::Duration::from_secs(seconds)) => {
            println!("Время вышло, останавливаю игру");
            let _ = child.kill().await;
        }
    }

    Ok(())
}
