//! What the launcher reads out of the jars in an instance: the name, the
//! version, the author and whether the jar carries an icon.
//!
//! ```text
//! cargo run --example mod_meta_smoke -- <data-dir> <instance-id>
//! ```

use firlauncher_lib::error::Result;
use firlauncher_lib::instances::contents;
use firlauncher_lib::paths::Paths;

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let data_dir = args.get(1).cloned().unwrap_or_default();
    let instance = args.get(2).cloned().unwrap_or_default();

    let paths = Paths::resolve(if data_dir.is_empty() { None } else { Some(&data_dir) })?;
    let mods = contents::list_mods(&paths, &instance).await?;
    println!("Модов: {}", mods.len());
    for entry in &mods {
        let icon = contents::mod_icon(&paths, &instance, &entry.file_name).await?;
        println!(
            "  {} | версия {} | автор {} | иконка {}",
            entry.name,
            entry.version.clone().unwrap_or_else(|| String::from("—")),
            entry.author.clone().unwrap_or_else(|| String::from("—")),
            match icon {
                Some(url) => format!("{} символов", url.len()),
                None => String::from("нет"),
            }
        );
        println!("     файл: {}", entry.file_name);
    }
    Ok(())
}
