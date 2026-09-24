//! Live check of modpack updates: installs an older version of a Modrinth
//! pack, makes the kind of changes a player makes, updates, and checks that
//! those changes survived.
//!
//! ```text
//! cargo run --example modpack_update_smoke -- <data-dir> [project]
//! ```

use std::sync::Arc;

use firlauncher_lib::config::settings::Settings;
use firlauncher_lib::error::{LauncherError, Result};
use firlauncher_lib::mods::{self, ProviderId, Target};
use firlauncher_lib::net::build_client;
use firlauncher_lib::net::download::{download_all, DownloadItem, ProgressSink};
use firlauncher_lib::packs::{self, update, PackContext};
use firlauncher_lib::paths::Paths;
use firlauncher_lib::tasks::Progress;
use tokio_util::sync::CancellationToken;

struct Quiet(CancellationToken);

impl ProgressSink for Quiet {
    fn add_bytes(&self, _bytes: u64) {}
    fn item_finished(&self, _done: usize, _total: usize) {}
}

impl Progress for Quiet {
    fn set_stage(&self, stage: String) {
        println!("  {stage}");
    }
    fn begin_phase(&self, stage: String, _bytes: Option<u64>) {
        println!("  {stage}");
    }
    fn token(&self) -> CancellationToken {
        self.0.clone()
    }
}

fn check(ok: bool, what: &str) -> Result<()> {
    if ok {
        println!("   ✓ {what}");
        Ok(())
    } else {
        Err(LauncherError::internal(format!("ПРОВАЛ: {what}")))
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let data_dir = args.get(1).cloned().unwrap_or_else(|| String::from("./smoke-data"));
    let project = args.get(2).cloned().unwrap_or_else(|| String::from("fabulously-optimized"));
    let paths = Paths::resolve(Some(&data_dir))?;
    let settings = Settings::default();
    let client = build_client("firlauncher-smoke@example.invalid")?;
    let modrinth = mods::provider(&client, ProviderId::Modrinth)?;
    let progress: Arc<dyn Progress> = Arc::new(Quiet(CancellationToken::new()));
    let ctx = PackContext { client: &client, paths: &paths, settings: &settings, progress: Arc::clone(&progress) };

    // An older release of the same Minecraft line, so the update is realistic.
    let versions = modrinth.versions(&project, &Target::any()).await?;
    let newest = versions.first().ok_or_else(|| LauncherError::internal("нет версий"))?;
    let older = versions
        .iter()
        .skip(1)
        .find(|v| v.game_versions == newest.game_versions)
        .or_else(|| versions.get(1))
        .ok_or_else(|| LauncherError::internal("нет старой версии"))?;
    println!("1. Ставлю {} (новейшая — {})", older.version_number, newest.version_number);
    let archive = paths.meta().join("packs").join(&older.file_name);
    download_all(
        &client,
        vec![DownloadItem::new(older.download_url.clone(), archive.clone()).with_sha1(older.sha1.clone())],
        1,
        CancellationToken::new(),
        Arc::clone(&progress) as Arc<dyn ProgressSink>,
    )
    .await?;
    let (meta, _) = packs::import(&ctx, &archive).await?;
    let state = update::load_state(&paths, &meta.id).await?.ok_or_else(|| LauncherError::internal("нет pack.json"))?;
    check(state.project_id.is_some(), "модпак опознан на Modrinth по хешу файла")?;
    check(state.version_id.as_deref() == Some(older.version_id.as_str()), "записана установленная версия")?;

    // What a player does.
    let game = paths.instance_game_dir(&meta.id);
    let pack_mods: Vec<String> = state.files.keys().filter(|p| p.starts_with("mods/")).cloned().collect();
    let (Some(switched_off), Some(deleted)) = (pack_mods.first(), pack_mods.get(1)) else {
        return Err(LauncherError::internal("в модпаке меньше двух модов"));
    };
    tokio::fs::rename(game.join(switched_off), game.join(format!("{switched_off}.disabled"))).await?;
    tokio::fs::remove_file(game.join(deleted)).await?;
    tokio::fs::write(game.join("mods/my-own-mod.jar"), b"not a real jar").await?;
    let config = state
        .files
        .keys()
        .find(|p| p.starts_with("config/") && !p.ends_with(".jar"))
        .cloned();
    if let Some(config) = &config {
        let mut text = tokio::fs::read(game.join(config)).await?;
        text.extend_from_slice(b"\n# edited by the player\n");
        tokio::fs::write(game.join(config), text).await?;
    }
    println!("2. Выключил {switched_off}, удалил {deleted}, добавил свой мод, правка: {config:?}");

    println!("3. Проверка обновления");
    let found = update::check(&paths, modrinth.as_ref(), &meta.id).await?;
    println!("   {found:?}");
    check(found.is_some(), "обновление найдено")?;

    println!("4. Обновление");
    let summary = update::apply(&ctx, modrinth.as_ref(), &meta).await?;
    println!("   обновлено файлов: {}, удалено: {}, оставлено изменённых: {:?}", summary.updated, summary.removed, summary.kept);

    let after = update::load_state(&paths, &meta.id).await?.ok_or_else(|| LauncherError::internal("нет pack.json"))?;
    check(after.version_id.as_deref() == Some(newest.version_id.as_str()), "записана новая версия")?;
    check(game.join("mods/my-own-mod.jar").exists(), "свой мод на месте")?;

    let old_project = |path: &str| state.files.get(path).and_then(|f| f.project_id.clone());
    let new_path_of = |project: &Option<String>| {
        after.files.iter().find(|(_, f)| &f.project_id == project).map(|(p, _)| p.clone())
    };
    if let Some(path) = new_path_of(&old_project(switched_off)) {
        check(game.join(format!("{path}.disabled")).exists(), "выключенный мод остался выключенным")?;
        check(!game.join(&path).exists(), "и не появился включённым")?;
    }
    if let Some(path) = new_path_of(&old_project(deleted)) {
        check(!game.join(&path).exists() && !game.join(format!("{path}.disabled")).exists(), "удалённый мод не вернулся")?;
    }
    if let Some(config) = &config {
        let text = tokio::fs::read_to_string(game.join(config)).await.unwrap_or_default();
        check(text.contains("edited by the player"), "правка конфига сохранилась")?;
    }
    check(update::check(&paths, modrinth.as_ref(), &meta.id).await?.is_none(), "больше обновлений нет")?;
    println!("\nВсё сходится.");
    Ok(())
}
