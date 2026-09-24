//! Headless check of the mod pipeline against the live Modrinth API:
//! search, dependency plan, install, downgrade, update check, update.
//!
//! ```text
//! cargo run --example mods_smoke -- <data-dir> [query]
//! ```

use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use firlauncher_lib::config::settings::Settings;
use firlauncher_lib::error::Result;
use firlauncher_lib::instances::ModLoader;
use firlauncher_lib::mods::{self, install, resolve, ProjectKind, ProviderId, SearchQuery, SortOrder, Target};
use firlauncher_lib::net::build_client;
use firlauncher_lib::net::download::ProgressSink;
use firlauncher_lib::paths::Paths;
use firlauncher_lib::tasks::Progress;
use tokio_util::sync::CancellationToken;

struct Quiet {
    bytes: AtomicU64,
    token: CancellationToken,
}

impl ProgressSink for Quiet {
    fn add_bytes(&self, bytes: u64) {
        self.bytes.fetch_add(bytes, Ordering::Relaxed);
    }
    fn item_finished(&self, _done: usize, _total: usize) {}
}

impl Progress for Quiet {
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

async fn list_mods(dir: &std::path::Path) -> Vec<String> {
    let mut names = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            names.push(entry.file_name().to_string_lossy().into_owned());
        }
    }
    names.sort();
    names
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let data_dir = args.get(1).cloned().unwrap_or_else(|| String::from("./smoke-data"));
    let text = args.get(2).cloned().unwrap_or_else(|| String::from("iris"));

    let kind = match args.iter().position(|a| a == "--kind").and_then(|i| args.get(i + 1)).map(String::as_str) {
        Some("resourcepack") => ProjectKind::ResourcePack,
        Some("shader") => ProjectKind::Shader,
        _ => ProjectKind::Mod,
    };
    let paths = Paths::resolve(Some(&data_dir))?;
    let settings = Settings::default();
    let client = build_client("firlauncher-smoke@example.invalid")?;
    let provider = mods::provider(&client, ProviderId::Modrinth)?;
    let target = Target::for_instance("1.20.4", ModLoader::Fabric);
    let progress: Arc<dyn Progress> = Arc::new(Quiet {
        bytes: AtomicU64::new(0),
        token: CancellationToken::new(),
    });

    if kind != ProjectKind::Mod {
        return packs(&paths, &settings, &client, provider.as_ref(), kind, &text, progress).await;
    }
    let mods_dir = paths.instance_game_dir("smoke").join("mods");
    let _ = tokio::fs::remove_dir_all(&mods_dir).await;
    let _ = tokio::fs::remove_file(paths.instance("smoke").join("mods.json")).await;

    println!("1. Поиск «{text}» (Fabric 1.20.4)");
    let found = provider
        .search(&SearchQuery {
            provider: ProviderId::Modrinth,
            text,
            kind: ProjectKind::Mod,
            game_version: Some(String::from("1.20.4")),
            loader: Some(ModLoader::Fabric),
            categories: Vec::new(),
            sort: SortOrder::Relevance,
            offset: 0,
            limit: 5,
        })
        .await?;
    println!("   найдено {}", found.total_hits);
    for hit in &found.hits {
        println!("   - {} ({}) {:?}", hit.name, hit.project_id, hit.categories);
    }
    let Some(first) = found.hits.first() else {
        println!("   ничего не найдено");
        return Ok(());
    };

    println!("2. План установки {}", first.name);
    let plan = resolve::plan(provider.as_ref(), &target, ProjectKind::Mod, &first.project_id, None, &HashSet::new()).await?;
    println!("   {} {}", plan.primary.name, plan.primary.version_number);
    for dep in &plan.dependencies {
        println!("   + зависимость {} {}", dep.name, dep.version_number);
    }
    for dep in &plan.unresolved {
        println!("   ! не найдено {}", dep.name.clone().unwrap_or_else(|| dep.project_id.clone()));
    }

    println!("3. Установка");
    let mut versions = vec![plan.primary.clone()];
    versions.extend(plan.dependencies.clone());
    install::install_versions(&client, &paths, "smoke", ProjectKind::Mod, &versions, 8, Arc::clone(&progress)).await?;
    println!("   mods/: {:?}", list_mods(&mods_dir).await);

    // Downgrade one installed project to an older build, then let the update
    // check find the way back.
    let victim = plan
        .dependencies
        .first()
        .unwrap_or(&plan.primary)
        .project_id
        .clone();
    println!("4. Откат {victim} на старую версию");
    let history = provider.versions(&victim, &target).await?;
    if let Some(older) = history.iter().filter(|v| target.accepts(v)).nth(1) {
        println!("   ставлю {}", older.version_number);
        install::install_versions(&client, &paths, "smoke", ProjectKind::Mod, std::slice::from_ref(older), 8, Arc::clone(&progress))
            .await?;
        println!("   mods/: {:?}", list_mods(&mods_dir).await);
    } else {
        println!("   у проекта одна версия — пропускаю откат");
    }

    println!("5. Проверка обновлений");
    let providers = mods::providers(&client);
    let updates = install::check_updates(&providers, &paths, "smoke", ProjectKind::Mod, &target).await?;
    for update in &updates {
        println!(
            "   {}: {} -> {}",
            update.file_name,
            update.current_version.clone().unwrap_or_else(|| String::from("?")),
            update.latest.version_number
        );
    }

    if !updates.is_empty() {
        println!("6. Обновление");
        install::apply_updates(&client, &paths, "smoke", ProjectKind::Mod, &updates, 8, Arc::clone(&progress)).await?;
        println!("   mods/: {:?}", list_mods(&mods_dir).await);
        let again = install::check_updates(&providers, &paths, "smoke", ProjectKind::Mod, &target).await?;
        println!("   повторная проверка: обновлений {}", again.len());
    }
    Ok(())
}

/// Resource packs and shaders: search, plan and install into their folder.
async fn packs(
    paths: &Paths,
    _settings: &Settings,
    client: &reqwest::Client,
    provider: &dyn mods::ModProvider,
    kind: ProjectKind,
    text: &str,
    progress: Arc<dyn Progress>,
) -> Result<()> {
    let target = Target::for_content("1.20.4", ModLoader::Fabric, kind);
    let dir = paths.instance_game_dir("smoke").join(kind.folder());
    let _ = tokio::fs::remove_dir_all(&dir).await;

    let found = provider
        .search(&SearchQuery {
            provider: ProviderId::Modrinth,
            text: text.to_owned(),
            kind,
            game_version: Some(String::from("1.20.4")),
            loader: Some(ModLoader::Fabric),
            categories: Vec::new(),
            sort: SortOrder::Relevance,
            offset: 0,
            limit: 3,
        })
        .await?;
    println!("Поиск {} «{text}»: {}", kind.label(), found.total_hits);
    for hit in &found.hits {
        println!("   - {} ({})", hit.name, hit.project_id);
    }
    let Some(first) = found.hits.first() else { return Ok(()) };
    let plan = resolve::plan(provider, &target, kind, &first.project_id, None, &HashSet::new()).await?;
    println!("План: {} {} ({} КБ)", plan.primary.name, plan.primary.file_name, plan.total_bytes / 1024);
    let mut versions = vec![plan.primary.clone()];
    versions.extend(plan.dependencies.clone());
    install::install_versions(client, paths, "smoke", kind, &versions, 8, progress).await?;
    println!("{}/: {:?}", kind.folder(), list_mods(&dir).await);
    Ok(())
}
