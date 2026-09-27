//! Where the space goes, and what cleaning would take — without deleting.
//!
//! ```text
//! cargo run --example storage_smoke -- <data-dir> [--clean]
//! ```

use firlauncher_lib::error::Result;
use firlauncher_lib::paths::Paths;
use firlauncher_lib::storage;

fn mb(bytes: u64) -> String {
    format!("{:.1} МБ", bytes as f64 / 1024.0 / 1024.0)
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let data_dir = args.get(1).cloned().unwrap_or_default();
    let clean = args.iter().any(|arg| arg == "--clean");
    let paths = Paths::resolve(if data_dir.is_empty() { None } else { Some(&data_dir) })?;

    let usage = storage::usage(&paths).await?;
    println!("Всего: {}", mb(usage.total));
    println!("  библиотеки {} · ассеты {} · java {} · версии {}", mb(usage.libraries), mb(usage.assets), mb(usage.java), mb(usage.versions));
    for instance in &usage.instances {
        println!("  сборка «{}»: {}", instance.name, mb(instance.bytes));
    }

    let plan = storage::plan_cleanup(&paths).await?;
    match &plan.blocked {
        Some(reason) => println!("\nОчистка невозможна: {reason}"),
        None => println!("\nМожно удалить: {} файлов, {}", plan.files, mb(plan.bytes)),
    }
    for file in storage::unused_for_review(&paths).await? {
        println!("  - {file}");
    }

    if clean && plan.blocked.is_none() {
        let (files, bytes) = storage::clean(&paths).await?;
        println!("\nУдалено: {files} файлов, {}", mb(bytes));
    }
    Ok(())
}
