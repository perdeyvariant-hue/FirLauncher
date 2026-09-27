//! "What's new" against the live APIs: pretends an older version is
//! installed and prints the notes of every version after it.
//!
//! ```text
//! cargo run --example changelog_smoke
//! ```

use firlauncher_lib::error::Result;
use firlauncher_lib::instances::ModLoader;
use firlauncher_lib::mods::{self, install, ProviderId, Target};
use firlauncher_lib::net::build_client;

async fn show(provider: ProviderId, project: &str) -> Result<()> {
    let client = build_client("firlauncher-smoke@example.invalid")?;
    let provider = match mods::provider(&client, provider) {
        Ok(provider) => provider,
        Err(error) => {
            println!("{}: {}", project, error.message);
            return Ok(());
        }
    };
    let target = Target::for_instance("1.21.1", ModLoader::Fabric);
    let versions = provider.versions(project, &target).await?;
    let fitting: Vec<_> = versions.iter().filter(|v| target.accepts(v)).collect();
    // Pretend the third newest is installed: two versions should come back.
    let Some(installed) = fitting.get(2) else {
        println!("{project}: слишком мало версий");
        return Ok(());
    };
    println!("\n{project}: установлена {}", installed.version_number);
    let notes = install::changelogs_since(provider.as_ref(), project, Some(&installed.version_id), &target, 8).await?;
    for entry in notes {
        let text = entry.text.unwrap_or_else(|| String::from("(пусто)"));
        let first_line = text.lines().find(|line| !line.trim().is_empty()).unwrap_or("");
        println!("  {} · {} · {} симв. · «{}»", entry.version_number, &entry.published_at[..10.min(entry.published_at.len())], text.len(), first_line.chars().take(70).collect::<String>());
    }
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    show(ProviderId::Modrinth, "sodium").await?;
    show(ProviderId::CurseForge, "238222").await?;
    Ok(())
}
