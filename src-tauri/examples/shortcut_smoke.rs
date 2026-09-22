//! Creates an instance shortcut in a folder and prints where it points.
//!
//! ```text
//! cargo run --example shortcut_smoke -- <folder> <instance-id> <name>
//! ```

use firlauncher_lib::error::{LauncherError, Result};

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let (Some(folder), Some(id), Some(name)) = (args.get(1), args.get(2), args.get(3)) else {
        return Err(LauncherError::internal("usage: shortcut_smoke <folder> <id> <name>"));
    };
    let path = firlauncher_lib::shortcuts::create_in(std::path::Path::new(folder), id, name).await?;
    println!("{}", path.display());
    Ok(())
}
