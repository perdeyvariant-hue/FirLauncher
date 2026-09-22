//! Headless check of version picking and selective updates against the live
//! Modrinth API, for mods, resource packs and shaders:
//! install a pinned older version, switch versions (a disabled mod stays
//! disabled), find updates, apply only some of them, then the rest.
//!
//! ```text
//! cargo run --example versions_smoke -- <data-dir>
//! ```

use std::collections::HashSet;
use std::sync::Arc;

use firlauncher_lib::config::settings::Settings;
use firlauncher_lib::error::{LauncherError, Result};
use firlauncher_lib::instances::ModLoader;
use firlauncher_lib::mods::{self, install, resolve, ModProvider, ModVersion, ProjectKind, Target};
use firlauncher_lib::net::build_client;
use firlauncher_lib::net::download::ProgressSink;
use firlauncher_lib::paths::Paths;
use firlauncher_lib::tasks::Progress;
use tokio_util::sync::CancellationToken;

const INSTANCE: &str = "versions-smoke";

struct Quiet(CancellationToken);

impl ProgressSink for Quiet {
    fn add_bytes(&self, _bytes: u64) {}
    fn item_finished(&self, _done: usize, _total: usize) {}
}

impl Progress for Quiet {
    fn set_stage(&self, _stage: String) {}
    fn begin_phase(&self, _stage: String, _bytes: Option<u64>) {}
    fn token(&self) -> CancellationToken {
        self.0.clone()
    }
}

struct Ctx {
    paths: Paths,
    client: reqwest::Client,
    provider: Arc<dyn ModProvider>,
    providers: Vec<Arc<dyn ModProvider>>,
    progress: Arc<dyn Progress>,
}

fn check(ok: bool, what: &str) -> Result<()> {
    if ok {
        println!("   ✓ {what}");
        Ok(())
    } else {
        Err(LauncherError::internal(format!("ПРОВАЛ: {what}")))
    }
}

async fn files(ctx: &Ctx, kind: ProjectKind) -> Vec<String> {
    let dir = ctx.paths.instance_game_dir(INSTANCE).join(kind.folder());
    let mut names = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            names.push(entry.file_name().to_string_lossy().into_owned());
        }
    }
    names.sort();
    names
}

/// Installs exactly `version` of a project, the way the version picker does.
async fn install_pinned(ctx: &Ctx, kind: ProjectKind, target: &Target, version: &ModVersion) -> Result<()> {
    let plan = resolve::plan(
        ctx.provider.as_ref(),
        target,
        kind,
        &version.project_id,
        Some(&version.version_id),
        &HashSet::new(),
    )
    .await?;
    let mut versions = vec![plan.primary];
    versions.extend(plan.dependencies);
    install::install_versions(&ctx.client, &ctx.paths, INSTANCE, kind, &versions, 8, Arc::clone(&ctx.progress)).await
}

/// Versions that fit, newest first, with distinct files.
async fn versions(ctx: &Ctx, slug: &str, target: &Target) -> Result<Vec<ModVersion>> {
    let all = ctx.provider.versions(slug, target).await?;
    Ok(all.into_iter().filter(|v| target.accepts(v)).collect())
}

async fn mods(ctx: &Ctx) -> Result<()> {
    println!("\n== Моды (Fabric 1.20.4)");
    let kind = ProjectKind::Mod;
    let target = Target::for_instance("1.20.4", ModLoader::Fabric);
    let dir = ctx.paths.instance_game_dir(INSTANCE).join("mods");

    let sodium = versions(ctx, "sodium", &target).await?;
    let api = versions(ctx, "fabric-api", &target).await?;
    println!("   sodium: {} версий, fabric-api: {}", sodium.len(), api.len());
    let (Some(s_old), Some(s_mid), Some(l_old)) = (sodium.get(2), sodium.get(1), api.get(1)) else {
        return Err(LauncherError::internal("мало версий для проверки"));
    };

    println!("1. Ставлю закреплённые старые версии: sodium {}, fabric-api {}", s_old.version_number, l_old.version_number);
    install_pinned(ctx, kind, &target, s_old).await?;
    install_pinned(ctx, kind, &target, l_old).await?;
    let now = files(ctx, kind).await;
    check(now.contains(&s_old.file_name) && now.contains(&l_old.file_name), "обе старые версии на месте")?;

    println!("2. Выключаю sodium и меняю версию на {}", s_mid.version_number);
    tokio::fs::rename(dir.join(&s_old.file_name), dir.join(format!("{}.disabled", s_old.file_name))).await?;
    install_pinned(ctx, kind, &target, s_mid).await?;
    let now = files(ctx, kind).await;
    println!("   файлы: {now:?}");
    check(now.contains(&format!("{}.disabled", s_mid.file_name)), "новая версия осталась выключенной")?;
    check(!now.iter().any(|f| f.starts_with(&s_old.file_name)), "старый файл удалён")?;

    println!("3. Проверка обновлений");
    let updates = install::check_updates(&ctx.providers, &ctx.paths, INSTANCE, kind, &target).await?;
    for update in &updates {
        println!("   {} {:?} → {}", update.file_name, update.current_version, update.latest.version_number);
    }
    check(updates.len() == 2, "найдено 2 обновления")?;

    println!("4. Обновляю только fabric-api");
    let only: Vec<_> = updates.iter().filter(|u| u.file_name.starts_with("fabric-api")).cloned().collect();
    install::apply_updates(&ctx.client, &ctx.paths, INSTANCE, kind, &only, 8, Arc::clone(&ctx.progress)).await?;
    let again = install::check_updates(&ctx.providers, &ctx.paths, INSTANCE, kind, &target).await?;
    check(again.len() == 1 && again[0].file_name.ends_with(".disabled"), "осталось только обновление sodium (выключенного)")?;

    println!("5. Обновляю всё оставшееся");
    install::apply_updates(&ctx.client, &ctx.paths, INSTANCE, kind, &again, 8, Arc::clone(&ctx.progress)).await?;
    let done = install::check_updates(&ctx.providers, &ctx.paths, INSTANCE, kind, &target).await?;
    let now = files(ctx, kind).await;
    println!("   файлы: {now:?}");
    check(done.is_empty(), "обновлений больше нет")?;
    check(now.iter().any(|f| f.starts_with("sodium") && f.ends_with(".disabled")), "sodium после обновления всё ещё выключен")?;
    Ok(())
}

async fn pack(ctx: &Ctx, kind: ProjectKind, slug: &str, mc: &str) -> Result<()> {
    println!("\n== {} «{slug}» (Minecraft {mc})", kind.label());
    let target = Target::for_content(mc, ModLoader::Fabric, kind);
    let list = versions(ctx, slug, &target).await?;
    println!("   версий: {}", list.len());
    let Some(old) = list.get(1) else {
        return Err(LauncherError::internal("мало версий для проверки"));
    };

    println!("1. Ставлю старую версию {}", old.version_number);
    install_pinned(ctx, kind, &target, old).await?;
    check(files(ctx, kind).await.contains(&old.file_name), "файл на месте")?;

    println!("2. Проверка обновлений");
    let updates = install::check_updates(&ctx.providers, &ctx.paths, INSTANCE, kind, &target).await?;
    for update in &updates {
        println!("   {} {:?} → {}", update.file_name, update.current_version, update.latest.version_number);
    }
    check(updates.len() == 1, "найдено обновление")?;

    println!("3. Обновляю");
    install::apply_updates(&ctx.client, &ctx.paths, INSTANCE, kind, &updates, 8, Arc::clone(&ctx.progress)).await?;
    let now = files(ctx, kind).await;
    println!("   файлы: {now:?}");
    check(!now.contains(&old.file_name) && now.len() == 1, "старая версия заменена")?;
    let done = install::check_updates(&ctx.providers, &ctx.paths, INSTANCE, kind, &target).await?;
    check(done.is_empty(), "обновлений больше нет")?;
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let data_dir = std::env::args().nth(1).unwrap_or_else(|| String::from("./smoke-data"));
    let paths = Paths::resolve(Some(&data_dir))?;
    let _ = tokio::fs::remove_dir_all(paths.instance(INSTANCE)).await;

    let settings = Settings::default();
    let client = build_client("firlauncher-smoke@example.invalid")?;
    let ctx = Ctx {
        provider: mods::provider(&settings, &client, mods::ProviderId::Modrinth)?,
        providers: mods::providers(&settings, &client),
        paths,
        client,
        progress: Arc::new(Quiet(CancellationToken::new())),
    };

    mods(&ctx).await?;
    pack(&ctx, ProjectKind::ResourcePack, "fresh-animations", "1.20.4").await?;
    pack(&ctx, ProjectKind::Shader, "complementary-reimagined", "1.21.1").await?;
    println!("\nВсё сходится.");
    Ok(())
}
