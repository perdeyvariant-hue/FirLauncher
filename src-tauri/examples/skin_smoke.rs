//! Renders a player's skin the way the corner mascot shows it: the head and
//! the full-length figure, written as PNG files.
//!
//! ```text
//! cargo run --example skin_smoke -- <skin-url> <out-dir>
//! ```

use firlauncher_lib::auth::skin;
use firlauncher_lib::error::{LauncherError, Result};
use firlauncher_lib::net::build_client;

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let (Some(url), Some(out)) = (args.get(1), args.get(2)) else {
        return Err(LauncherError::internal("usage: skin_smoke <skin-url> <out-dir>"));
    };
    let client = build_client("firlauncher-smoke@example.invalid")?;
    let bytes = client
        .get(url)
        .send()
        .await
        .map_err(|error| LauncherError::internal(error.to_string()))?
        .bytes()
        .await
        .map_err(|error| LauncherError::internal(error.to_string()))?;

    let out = std::path::Path::new(out);
    tokio::fs::create_dir_all(out).await?;
    tokio::fs::write(out.join("head.png"), skin::render_head(&bytes)?).await?;
    tokio::fs::write(out.join("body.png"), skin::render_body(&bytes)?).await?;
    println!("записано в {}", out.display());
    Ok(())
}
