//! What the covers can use on this machine: block textures, panoramas and
//! each instance's screenshot cover.
//!
//! ```text
//! cargo run --example art_smoke -- [data-dir]
//! ```

use firlauncher_lib::art;
use firlauncher_lib::error::Result;
use firlauncher_lib::paths::Paths;

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let paths = Paths::resolve(args.get(1).map(String::as_str))?;

    let names = ["stone", "tnt_side", "grass_block_top", "amethyst_block", "nope"]
        .map(String::from)
        .to_vec();
    let started = std::time::Instant::now();
    let textures = art::block_textures(&paths, names).await?;
    let mut found: Vec<_> = textures.keys().collect();
    found.sort();
    println!("textures {found:?} in {:?}", started.elapsed());

    let started = std::time::Instant::now();
    let panoramas = art::panoramas(&paths).await?;
    let sizes: Vec<usize> = panoramas.iter().map(String::len).collect();
    println!("panoramas {} (data url sizes {sizes:?}) in {:?}", panoramas.len(), started.elapsed());

    for meta in firlauncher_lib::instances::list_metas(&paths).await? {
        let cover = art::instance_cover(&paths, &meta.id).await?;
        println!("cover {}: {}", meta.id, cover.map_or(String::from("none"), |url| format!("{} bytes", url.len())));
    }
    Ok(())
}
