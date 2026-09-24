//! Headless check of the CurseForge side of the mod pipeline: search,
//! project details, versions, dependency plan and a real install.
//!
//! Needs the key the launcher is built with (`FIRLAUNCHER_CURSEFORGE_KEY`);
//! without it the provider is not in the list and the example says so.
//!
//! ```text
//! cargo run --example curseforge_smoke -- <data-dir> [query]
//! ```

use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

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
    fn begin_phase(&self, _stage: String, _total: Option<u64>) {}
    fn set_stage(&self, _stage: String) {}
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
    let text = args.get(2).cloned().unwrap_or_else(|| String::from("jei"));

    println!(
        "Ключ CurseForge в сборке: {}",
        if mods::builtin_curseforge_key().is_some() { "есть" } else { "нет" }
    );

    let paths = Paths::resolve(Some(&data_dir))?;
    let client = build_client("firlauncher-smoke@example.invalid")?;
    let provider = match mods::provider(&client, ProviderId::CurseForge) {
        Ok(provider) => provider,
        Err(error) => {
            println!("{}", error.message);
            println!("Соберите с FIRLAUNCHER_CURSEFORGE_KEY=<ключ> и повторите.");
            return Ok(());
        }
    };

    let target = Target::for_instance("1.21.1", ModLoader::Fabric);
    let progress: Arc<dyn Progress> = Arc::new(Quiet {
        bytes: AtomicU64::new(0),
        token: CancellationToken::new(),
    });

    let mods_dir = paths.instance_game_dir("cf-smoke").join("mods");
    let _ = tokio::fs::remove_dir_all(&mods_dir).await;
    let _ = tokio::fs::remove_file(paths.instance("cf-smoke").join("mods.json")).await;

    println!("1. Поиск «{text}» (Fabric 1.21.1)");
    let found = provider
        .search(&SearchQuery {
            provider: ProviderId::CurseForge,
            text,
            kind: ProjectKind::Mod,
            game_version: Some(String::from("1.21.1")),
            loader: Some(ModLoader::Fabric),
            categories: Vec::new(),
            sort: SortOrder::Downloads,
            offset: 0,
            limit: 5,
        })
        .await?;
    println!("   найдено {}", found.total_hits);
    for hit in &found.hits {
        println!("   - {} ({})", hit.name, hit.project_id);
    }
    let Some(first) = found.hits.first() else {
        println!("   ничего не найдено");
        return Ok(());
    };

    println!("2. Страница проекта {}", first.name);
    let details = provider.details(&first.project_id).await?;
    let body = details.body;
    println!("   описание: {} символов, ссылок {}", body.len(), details.links.len());

    println!("3. Версии");
    let versions = provider.versions(&first.project_id, &target).await?;
    println!("   подходящих версий: {}", versions.iter().filter(|v| target.accepts(v)).count());
    for version in versions.iter().filter(|v| target.accepts(v)).take(3) {
        println!("   - {} ({})", version.version_number, version.file_name);
    }

    println!("4. План установки");
    let plan =
        resolve::plan(provider.as_ref(), &target, ProjectKind::Mod, &first.project_id, None, &HashSet::new()).await?;
    println!("   {} {}", plan.primary.name, plan.primary.version_number);
    for dep in &plan.dependencies {
        println!("   + зависимость {} {}", dep.name, dep.version_number);
    }
    for dep in &plan.unresolved {
        println!("   ! не найдено {}", dep.name.clone().unwrap_or_else(|| dep.project_id.clone()));
    }

    println!("5. Установка");
    let mut to_install = vec![plan.primary.clone()];
    to_install.extend(plan.dependencies.clone());
    install::install_versions(&client, &paths, "cf-smoke", ProjectKind::Mod, &to_install, 8, Arc::clone(&progress))
        .await?;
    println!("   mods/: {:?}", list_mods(&mods_dir).await);

    println!("6. Проверка обновлений");
    let providers = mods::providers(&client);
    let updates = install::check_updates(&providers, &paths, "cf-smoke", ProjectKind::Mod, &target).await?;
    println!("   обновлений: {}", updates.len());

    let _ = tokio::fs::remove_dir_all(paths.instance("cf-smoke")).await;
    println!("Готово.");
    Ok(())
}
