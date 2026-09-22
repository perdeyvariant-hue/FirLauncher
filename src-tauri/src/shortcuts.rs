//! Desktop shortcuts that start an instance directly, and the
//! `--launch <instance-id>` command line that they use.

use std::path::{Path, PathBuf};

use crate::error::{ErrorKind, LauncherError, Result};

pub const LAUNCH_FLAG: &str = "--launch";
/// Emitted when a shortcut is used while the launcher is already open.
pub const EVENT_LAUNCH_REQUEST: &str = "launch://request";

/// The instance id after `--launch`, if the arguments carry one.
pub fn launch_target(args: &[String]) -> Option<String> {
    let position = args.iter().position(|arg| arg == LAUNCH_FLAG)?;
    args.get(position + 1).filter(|id| !id.starts_with('-')).cloned()
}

fn shortcut_error(message: &str, detail: impl std::fmt::Display) -> LauncherError {
    LauncherError::new(ErrorKind::Io, message.to_owned()).with_detail(detail.to_string())
}

/// A file name that every desktop accepts.
fn file_stem(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { c })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').to_owned();
    if cleaned.is_empty() { String::from("Minecraft") } else { cleaned }
}

fn desktop() -> Result<PathBuf> {
    dirs::desktop_dir().ok_or_else(|| shortcut_error("Не найден рабочий стол", "desktop_dir"))
}

/// Creates a shortcut on the desktop; returns its path.
pub async fn create(instance_id: &str, instance_name: &str) -> Result<PathBuf> {
    create_in(&desktop()?, instance_id, instance_name).await
}

/// Creates the shortcut in a given folder (the desktop, or a test folder).
pub async fn create_in(folder: &Path, instance_id: &str, instance_name: &str) -> Result<PathBuf> {
    let exe = std::env::current_exe().map_err(|error| shortcut_error("Не найден файл лаунчера", error))?;
    let stem = file_stem(&format!("{instance_name} — FirLauncher"));
    create_for(&exe, folder, &stem, instance_id).await
}

#[cfg(windows)]
async fn create_for(exe: &Path, desktop: &Path, stem: &str, instance_id: &str) -> Result<PathBuf> {
    let link = desktop.join(format!("{stem}.lnk"));
    // WScript.Shell is the standard way to write a .lnk without extra crates.
    // Values go in through environment variables, so no quoting can break
    // out of the script.
    let script = "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:FIR_LINK); \
                  $s.TargetPath = $env:FIR_EXE; $s.Arguments = $env:FIR_ARGS; \
                  $s.WorkingDirectory = $env:FIR_DIR; $s.IconLocation = $env:FIR_EXE + ',0'; $s.Save()";
    let mut command = tokio::process::Command::new("powershell");
    command
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .env("FIR_LINK", &link)
        .env("FIR_EXE", exe)
        .env("FIR_ARGS", format!("{LAUNCH_FLAG} {instance_id}"))
        .env("FIR_DIR", exe.parent().unwrap_or(exe));
    command.creation_flags(0x0800_0000);
    let output = command.output().await.map_err(|error| shortcut_error("Не удалось создать ярлык", error))?;
    if !output.status.success() || !link.exists() {
        return Err(shortcut_error("Не удалось создать ярлык", String::from_utf8_lossy(&output.stderr)));
    }
    Ok(link)
}

#[cfg(target_os = "macos")]
async fn create_for(exe: &Path, desktop: &Path, stem: &str, instance_id: &str) -> Result<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    // …/FirLauncher.app/Contents/MacOS/firlauncher → the .app bundle.
    let app = exe
        .ancestors()
        .find(|path| path.extension().is_some_and(|ext| ext == "app"))
        .unwrap_or(exe);
    let script_path = desktop.join(format!("{stem}.command"));
    let script = format!(
        "#!/bin/sh\nopen -a '{}' --args {LAUNCH_FLAG} '{}'\n",
        app.display().to_string().replace('\'', "'\\''"),
        instance_id.replace('\'', "'\\''"),
    );
    tokio::fs::write(&script_path, script).await.map_err(|error| shortcut_error("Не удалось создать ярлык", error))?;
    tokio::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o755))
        .await
        .map_err(|error| shortcut_error("Не удалось создать ярлык", error))?;
    Ok(script_path)
}

#[cfg(all(unix, not(target_os = "macos")))]
async fn create_for(exe: &Path, desktop: &Path, stem: &str, instance_id: &str) -> Result<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    let entry = desktop.join(format!("{stem}.desktop"));
    let quote = |value: &str| format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""));
    let contents = format!(
        "[Desktop Entry]\nType=Application\nName={stem}\nExec={} {LAUNCH_FLAG} {}\nIcon=firlauncher\nTerminal=false\nCategories=Game;\n",
        quote(&exe.display().to_string()),
        quote(instance_id),
    );
    tokio::fs::write(&entry, contents).await.map_err(|error| shortcut_error("Не удалось создать ярлык", error))?;
    tokio::fs::set_permissions(&entry, std::fs::Permissions::from_mode(0o755))
        .await
        .map_err(|error| shortcut_error("Не удалось создать ярлык", error))?;
    Ok(entry)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_launch_target_is_read_from_arguments() {
        let args = |list: &[&str]| list.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
        assert_eq!(launch_target(&args(&["fir.exe", "--launch", "my-pack"])), Some(String::from("my-pack")));
        assert_eq!(launch_target(&args(&["fir.exe"])), None);
        assert_eq!(launch_target(&args(&["fir.exe", "--launch"])), None);
        assert_eq!(launch_target(&args(&["fir.exe", "--launch", "--other"])), None);
    }

    #[test]
    fn shortcut_names_are_safe() {
        assert_eq!(file_stem("Fabric: 1.20/4 — FirLauncher"), "Fabric_ 1.20_4 — FirLauncher");
        assert_eq!(file_stem("..."), "Minecraft");
    }
}
