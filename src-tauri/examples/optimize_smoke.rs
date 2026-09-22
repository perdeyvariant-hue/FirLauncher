//! Shows which performance mods "Оптимизировать" would offer.
//!
//! ```text
//! cargo run --example optimize_smoke
//! ```

use std::collections::HashSet;

use firlauncher_lib::config::settings::Settings;
use firlauncher_lib::error::Result;
use firlauncher_lib::instances::ModLoader;
use firlauncher_lib::mods::{self, optimize, ProviderId};
use firlauncher_lib::net::build_client;

#[tokio::main]
async fn main() -> Result<()> {
    let client = build_client("firlauncher-smoke@example.invalid")?;
    let modrinth = mods::provider(&Settings::default(), &client, ProviderId::Modrinth)?;
    for (mc, loader) in [("1.21.1", ModLoader::Fabric), ("1.20.1", ModLoader::Forge), ("1.21.1", ModLoader::NeoForge)] {
        println!("\n{} {mc}:", loader.label());
        for m in optimize::plan_mods(modrinth.as_ref(), mc, loader, &HashSet::new()).await {
            println!("  {:16} {}", m.name, m.version_number.unwrap_or_else(|| String::from("— нет версии")));
        }
    }
    Ok(())
}
