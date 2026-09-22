//! Runs the crash analyser over a saved game log, the way the crash dialog
//! does after the game exits.
//!
//! ```text
//! cargo run --example crash_smoke -- <log-file> [crash-report]
//! ```

use firlauncher_lib::error::{LauncherError, Result};
use firlauncher_lib::minecraft::crash::{self, CrashInput};

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let Some(log_path) = args.get(1) else {
        return Err(LauncherError::internal("usage: crash_smoke <log-file> [crash-report]"));
    };
    let log = std::fs::read_to_string(log_path)?;
    let report = match args.get(2) {
        Some(path) => Some(std::fs::read_to_string(path)?),
        None => None,
    };
    let found = crash::diagnose(&CrashInput {
        log: &log,
        crash_report: report.as_deref(),
        hs_err: None,
        exit_code: Some(1),
        memory_mb: 4096,
        system_memory_mb: 16_384,
    });
    if found.is_empty() {
        println!("Причина не найдена. Первые ошибки:");
        for line in crash::error_excerpt(&log, report.as_deref()) {
            println!("  {line}");
        }
    }
    for diagnosis in found {
        println!("[{}] {}\n  {}\n  исправление: {:?}", diagnosis.rule, diagnosis.title, diagnosis.explanation, diagnosis.fix);
    }
    Ok(())
}
