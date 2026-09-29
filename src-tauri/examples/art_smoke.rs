//! What the covers can use on this machine: each version's panorama, the
//! block textures from its client, and each instance's screenshot cover.
//!
//! ```text
//! cargo run --example art_smoke -- [data-dir] [version...]
//! ```

use firlauncher_lib::art;
use firlauncher_lib::error::Result;
use firlauncher_lib::paths::Paths;

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let data_dir = args.get(1).filter(|value| !value.is_empty()).map(String::as_str);
    let paths = Paths::resolve(data_dir)?;
    let client = reqwest::Client::builder()
        .user_agent("FirLauncher-smoke/0 (github.com/perdeyvariant-hue/FirLauncher)")
        .build()
        .map_err(|error| firlauncher_lib::error::LauncherError::internal(error.to_string()))?;

    let versions: Vec<String> = if args.len() > 2 { args[2..].to_vec() } else { vec![String::from("1.21.1")] };
    for version in versions {
        let started = std::time::Instant::now();
        let panorama = art::version_panorama(&client, &paths, &version).await?;
        let names = ["stone", "crafter_top", "cherry_log", "ancient_debris_side", "bee_nest_front"]
            .map(String::from)
            .to_vec();
        let textures = art::block_textures(&paths, Some(version.clone()), names).await?;
        let mut found: Vec<_> = textures.keys().collect();
        found.sort();
        println!(
            "{version}: panorama {} · textures {found:?} · {:?}",
            panorama.map_or(String::from("none"), |url| format!("{} bytes", url.len())),
            started.elapsed()
        );
    }

    for meta in firlauncher_lib::instances::list_metas(&paths).await? {
        let cover = art::instance_cover(&paths, &meta.id).await?;
        println!("cover {}: {}", meta.id, cover.map_or(String::from("none"), |url| format!("{} bytes", url.len())));
    }
    Ok(())
}
