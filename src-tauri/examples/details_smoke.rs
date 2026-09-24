//! Fetches description pages from the live Modrinth API and prints what the
//! description view would show.
//!
//! ```text
//! cargo run --example details_smoke -- [project ...]
//! ```

use firlauncher_lib::error::Result;
use firlauncher_lib::mods::{self, ProviderId};
use firlauncher_lib::net::build_client;

#[tokio::main]
async fn main() -> Result<()> {
    let mut projects: Vec<String> = std::env::args().skip(1).collect();
    if projects.is_empty() {
        projects = ["sodium", "fresh-animations", "complementary-reimagined", "fabulously-optimized"]
            .map(String::from)
            .to_vec();
    }
    let client = build_client("firlauncher-smoke@example.invalid")?;
    let provider = mods::provider(&client, ProviderId::Modrinth)?;

    for id in &projects {
        let details = provider.details(id).await?;
        let project = &details.project;
        println!("\n{} ({:?}) — автор «{}»", project.name, project.kind, project.author);
        println!("  {}", project.summary);
        println!(
            "  загрузок {}, подписчиков {:?}, лицензия {:?}",
            project.downloads, project.followers, project.license
        );
        println!("  категории: {:?}", project.categories);
        println!(
            "  описание: {} символов ({:?}), галерея: {}, версий игры: {}, лоадеры: {:?}",
            details.body.chars().count(),
            details.body_format,
            details.gallery.len(),
            details.game_versions.len(),
            details.loaders
        );
        for link in &details.links {
            println!("  ссылка {:?} {} {}", link.kind, link.label, link.url);
        }
    }
    Ok(())
}
