//! Takes a snapshot of an instance, breaks the instance, and rolls it back.
//! Run it on a copy of the data folder: it deletes a mod on purpose.
//!
//! ```text
//! cargo run --example snapshot_smoke -- <data-dir> <instance-id>
//! ```

use firlauncher_lib::error::Result;
use firlauncher_lib::instances::snapshots;
use firlauncher_lib::paths::Paths;

fn mods(paths: &Paths, id: &str) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(paths.instance_game_dir(id).join("mods"))
        .map(|entries| entries.flatten().map(|entry| entry.file_name().to_string_lossy().into_owned()).collect())
        .unwrap_or_default();
    names.sort();
    names
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let paths = Paths::resolve(args.get(1).map(String::as_str))?;
    let id = args.get(2).cloned().unwrap_or_default();

    let before = mods(&paths, &id);
    let started = std::time::Instant::now();
    let snapshot = snapshots::take(&paths, &id, "smoke", false).await?;
    println!("snapshot {}: {} mods, {} bytes as copies, {:?}", snapshot.id, snapshot.mods, snapshot.bytes, started.elapsed());

    let victim = before.first().cloned().unwrap_or_default();
    std::fs::remove_file(paths.instance_game_dir(&id).join("mods").join(&victim))?;
    println!("removed {victim}; mods now {}", mods(&paths, &id).len());

    snapshots::restore(&paths, &id, &snapshot.id).await?;
    let after = mods(&paths, &id);
    println!("restored; mods now {}; identical: {}", after.len(), after == before);
    for item in snapshots::list(&paths, &id).await? {
        println!("  {} {} auto={}", item.id, item.reason, item.automatic);
    }
    Ok(())
}
