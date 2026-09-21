//! Forge-style installers, shared by Forge and NeoForge.
//!
//! Instead of running the official installer blindly, the launcher reads its
//! `install_profile.json` and does the work itself — the approach Prism uses.
//! Three generations exist in the wild, and one code path covers them:
//!
//! - **processors** (1.13+ Forge, all NeoForge): download libraries, then run
//!   the Java processors that deobfuscate and patch the client jar;
//! - **re-released legacy** (recent 1.12.2 builds): the same format with no
//!   processors, the Forge jar embedded under `maven/`;
//! - **versionInfo** (1.7.10 and friends): the profile sits inline and the
//!   universal jar is copied out of the installer.
//!
//! The version profile is written to the cache only after everything above
//! succeeded; its presence is what "installed" means.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Deserialize;

use crate::error::{ErrorKind, LauncherError, Result};
use crate::minecraft::version::{maven_path, Library};

#[derive(Debug, Deserialize)]
struct SidedValue {
    client: String,
}

#[derive(Debug, Clone, Deserialize)]
struct Processor {
    jar: String,
    #[serde(default)]
    classpath: Vec<String>,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    outputs: HashMap<String, String>,
    sides: Option<Vec<String>>,
}

impl Processor {
    fn runs_on_client(&self) -> bool {
        self.sides
            .as_ref()
            .is_none_or(|sides| sides.iter().any(|side| side == "client"))
    }

    /// `net.minecraftforge:binarypatcher:1.1.1` -> `binarypatcher`, for the UI.
    fn short_name(&self) -> &str {
        self.jar.split(':').nth(1).unwrap_or(&self.jar)
    }
}

#[derive(Debug, Deserialize)]
struct ModernProfile {
    json: Option<String>,
    #[serde(default)]
    data: HashMap<String, SidedValue>,
    #[serde(default)]
    processors: Vec<Processor>,
    #[serde(default)]
    libraries: Vec<Library>,
}

#[derive(Debug, Deserialize)]
struct LegacyInstall {
    /// Maven coordinates the universal jar must be installed under.
    path: String,
    /// Name of the universal jar inside the installer.
    #[serde(rename = "filePath")]
    file_path: String,
}

fn installer_error(message: impl Into<String>, detail: impl std::fmt::Display) -> LauncherError {
    LauncherError::new(ErrorKind::Loader, message).with_detail(detail.to_string())
}

fn open_zip(path: &Path) -> Result<zip::ZipArchive<std::fs::File>> {
    let file = std::fs::File::open(path)?;
    zip::ZipArchive::new(file)
        .map_err(|error| installer_error("Установщик повреждён — удалите его и повторите", error))
}

/// Reads one file from the installer jar.
fn read_entry(installer: &Path, name: &str) -> Result<Vec<u8>> {
    let mut archive = open_zip(installer)?;
    let mut entry = archive
        .by_name(name)
        .map_err(|error| installer_error(format!("В установщике нет {name}"), error))?;
    let mut bytes = Vec::new();
    entry.read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn write_file(dest: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(dest, bytes)?;
    Ok(())
}

/// Copies every `maven/…` file out of the installer into `libraries/`. Those
/// are the Forge jars the installer carries itself instead of downloading.
fn extract_embedded_maven(installer: &Path, libraries: &Path) -> Result<usize> {
    let mut archive = open_zip(installer)?;
    let mut extracted = 0;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| installer_error("Не удалось прочитать установщик", error))?;
        if entry.is_dir() {
            continue;
        }
        let Some(name) = entry.enclosed_name() else {
            continue;
        };
        let Ok(relative) = name.strip_prefix("maven") else {
            continue;
        };
        let dest = libraries.join(relative);
        // The embedded copy is authoritative, but rewriting an identical file
        // on every launch would be pointless churn.
        if std::fs::metadata(&dest).is_ok_and(|meta| meta.len() == entry.size()) {
            continue;
        }
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes)?;
        write_file(&dest, &bytes)?;
        extracted += 1;
    }
    Ok(extracted)
}

/// `Main-Class` from a jar's manifest, honouring continuation lines.
fn main_class(jar: &Path) -> Result<String> {
    let bytes = read_entry(jar, "META-INF/MANIFEST.MF")?;
    let text = String::from_utf8_lossy(&bytes);
    let mut unfolded = String::new();
    for line in text.lines() {
        match line.strip_prefix(' ') {
            Some(continued) => unfolded.push_str(continued),
            None => {
                unfolded.push('\n');
                unfolded.push_str(line);
            }
        }
    }
    unfolded
        .lines()
        .find_map(|line| line.strip_prefix("Main-Class:"))
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            LauncherError::new(
                ErrorKind::Loader,
                format!("У процессора {} нет Main-Class", jar.display()),
            )
        })
}

fn artifact_path(libraries: &Path, coordinate: &str) -> Result<PathBuf> {
    maven_path(coordinate)
        .map(|relative| libraries.join(relative))
        .ok_or_else(|| {
            LauncherError::new(
                ErrorKind::Loader,
                format!("Непонятные координаты артефакта: {coordinate}"),
            )
        })
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Resolves one processor argument the way the official installer does:
///
/// - `[group:artifact:version:classifier@ext]` — a path in `libraries/`;
/// - `'text'` — a literal;
/// - anything else — `{KEY}` occurrences replaced from the data map.
pub fn substitute(
    token: &str,
    data: &HashMap<String, String>,
    libraries: &Path,
) -> Result<String> {
    if let Some(coordinate) = token.strip_prefix('[').and_then(|rest| rest.strip_suffix(']')) {
        return artifact_path(libraries, coordinate).map(|path| path_string(&path));
    }
    if let Some(literal) = token
        .strip_prefix('\'')
        .and_then(|rest| rest.strip_suffix('\''))
    {
        return Ok(literal.to_owned());
    }

    let mut out = String::with_capacity(token.len());
    let mut rest = token;
    while let Some(open) = rest.find('{') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        let Some(close) = after.find('}') else {
            // An unmatched brace is just text.
            out.push_str(&rest[open..]);
            return Ok(out);
        };
        let key = &after[..close];
        let value = data.get(key).ok_or_else(|| {
            LauncherError::new(
                ErrorKind::Loader,
                format!("Установщику нужны данные «{key}», которых нет в профиле"),
            )
        })?;
        out.push_str(value);
        rest = &after[close + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

/// Resolves the profile's `data` block for the client side. Values starting
/// with `/` name files inside the installer; those are extracted next to it.
/// Blocking — runs under `spawn_blocking`.
fn build_data(
    raw: &HashMap<String, SidedValue>,
    builtins: HashMap<String, String>,
    installer: &Path,
    extract_dir: &Path,
    libraries: &Path,
) -> Result<HashMap<String, String>> {
    let mut data = builtins;
    for (key, value) in raw {
        let value = value.client.as_str();
        let resolved = if let Some(inner) = value.strip_prefix('/') {
            let dest = extract_dir.join(inner);
            write_file(&dest, &read_entry(installer, inner)?)?;
            path_string(&dest)
        } else if value.starts_with('[') || value.starts_with('\'') {
            substitute(value, &HashMap::new(), libraries)?
        } else {
            value.to_owned()
        };
        data.insert(key.clone(), resolved);
    }
    Ok(data)
}

/// True when every declared output exists with the declared SHA1 — the
/// processor already ran and can be skipped. Processors without declared
/// outputs always run: there is nothing to check them against.
async fn outputs_valid(outputs: &HashMap<String, String>) -> bool {
    if outputs.is_empty() {
        return false;
    }
    for (path, expected) in outputs {
        match crate::net::download::sha1_of_file(Path::new(path)).await {
            Ok(actual) if actual.eq_ignore_ascii_case(expected) => {}
            _ => return false,
        }
    }
    true
}

/// How much processor output to keep for the error message.
const OUTPUT_TAIL_LINES: usize = 40;

fn tail(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(OUTPUT_TAIL_LINES);
    lines[start..].join("\n")
}

struct ProcessorRun<'a> {
    java: &'a Path,
    data: &'a HashMap<String, String>,
    libraries: &'a Path,
    token: tokio_util::sync::CancellationToken,
}

async fn run_processor(run: &ProcessorRun<'_>, processor: &Processor) -> Result<()> {
    let outputs: HashMap<String, String> = processor
        .outputs
        .iter()
        .map(|(path, sha)| {
            Ok((
                substitute(path, run.data, run.libraries)?,
                substitute(sha, run.data, run.libraries)?,
            ))
        })
        .collect::<Result<_>>()?;

    if outputs_valid(&outputs).await {
        return Ok(());
    }

    let jar = artifact_path(run.libraries, &processor.jar)?;
    let jar_for_manifest = jar.clone();
    let main = tokio::task::spawn_blocking(move || main_class(&jar_for_manifest))
        .await
        .map_err(|error| installer_error("Сбой чтения процессора", error))??;

    let mut classpath = vec![jar];
    for coordinate in &processor.classpath {
        classpath.push(artifact_path(run.libraries, coordinate)?);
    }
    let classpath = crate::minecraft::args::join_classpath(&classpath);

    let arguments: Vec<String> = processor
        .args
        .iter()
        .map(|arg| substitute(arg, run.data, run.libraries))
        .collect::<Result<_>>()?;

    let mut command = tokio::process::Command::new(run.java);
    command
        .arg("-cp")
        .arg(&classpath)
        .arg(&main)
        .args(&arguments)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        // Dropping the future on cancel must not leave a JVM behind.
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);

    let child = command
        .spawn()
        .map_err(|error| installer_error("Не удалось запустить Java для установщика", error))?;

    let output = tokio::select! {
        biased;
        () = run.token.cancelled() => {
            return Err(LauncherError::new(ErrorKind::Cancelled, "Установка отменена"));
        }
        output = child.wait_with_output() => output?,
    };

    if !output.status.success() {
        let mut log = tail(&output.stdout);
        let errors = tail(&output.stderr);
        if !errors.is_empty() {
            log.push_str("\n--- stderr ---\n");
            log.push_str(&errors);
        }
        return Err(installer_error(
            format!(
                "Шаг установки {} завершился с ошибкой (код {})",
                processor.short_name(),
                output.status.code().unwrap_or(-1)
            ),
            log,
        ));
    }

    // Outputs declared with hashes are checked after the fact too: a
    // processor that "succeeded" with the wrong bytes would crash the game.
    if !outputs.is_empty() && !outputs_valid(&outputs).await {
        return Err(LauncherError::new(
            ErrorKind::Hash,
            format!(
                "Шаг установки {} создал файл с неверной контрольной суммой",
                processor.short_name()
            ),
        ));
    }
    Ok(())
}

/// Maven publishes `<file>.sha1` next to every artifact; use it when present.
async fn published_sha1(client: &reqwest::Client, url: &str) -> Option<String> {
    let response = client.get(format!("{url}.sha1")).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let text = response.text().await.ok()?;
    let hash = text.split_whitespace().next()?.to_ascii_lowercase();
    (hash.len() == 40 && hash.chars().all(|c| c.is_ascii_hexdigit())).then_some(hash)
}

async fn blocking<T, F>(work: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T> + Send + 'static,
{
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| installer_error("Сбой фоновой операции установщика", error))?
}

/// Downloads (or reuses) the installer jar and runs whichever generation of
/// install profile it contains. Returns the version profile id.
pub async fn install(
    ctx: &super::LoaderContext<'_>,
    mc_version: &str,
    installer_url: &str,
    label: &str,
) -> Result<String> {
    use crate::net::download::{download_all, DownloadItem, ProgressSink};

    let file_name = installer_url
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or("installer.jar")
        .to_owned();
    let installer = ctx.paths.meta().join("installers").join(&file_name);

    ctx.progress
        .begin_phase(format!("Установщик {label}"), None);
    let sha1 = published_sha1(ctx.client, installer_url).await;
    download_all(
        ctx.client,
        vec![DownloadItem::new(installer_url, installer.clone()).with_sha1(sha1)],
        1,
        ctx.progress.token(),
        Arc::clone(&ctx.progress) as Arc<dyn ProgressSink>,
    )
    .await?;

    let profile_path = installer.clone();
    let raw: serde_json::Value = blocking(move || {
        let bytes = read_entry(&profile_path, "install_profile.json")?;
        serde_json::from_slice(&bytes)
            .map_err(|error| installer_error("install_profile.json не разобрался", error))
    })
    .await?;

    let version = if raw.get("versionInfo").is_some() {
        install_legacy(ctx, &installer, raw).await?
    } else {
        install_modern(ctx, mc_version, &installer, raw, label).await?
    };

    // Publishing the profile is the very last step: its presence in the cache
    // is what marks the loader as installed.
    crate::minecraft::manifest::store_version_json(ctx.paths, &version).await?;
    Ok(version.id)
}

/// Old installers: the profile is inline and the universal jar is copied out.
async fn install_legacy(
    ctx: &super::LoaderContext<'_>,
    installer: &Path,
    raw: serde_json::Value,
) -> Result<crate::minecraft::version::VersionJson> {
    let install: LegacyInstall = serde_json::from_value(raw["install"].clone())
        .map_err(|error| installer_error("Устаревший установщик не разобрался", error))?;
    let mut info = raw["versionInfo"].clone();

    // Old profiles still point at the long-retired HTTP host.
    if let Some(libraries) = info.get_mut("libraries").and_then(|v| v.as_array_mut()) {
        for library in libraries {
            if let Some(url) = library.get_mut("url") {
                if let Some(text) = url.as_str() {
                    let modern = text.replace(
                        "http://files.minecraftforge.net/maven",
                        "https://maven.minecraftforge.net",
                    );
                    *url = serde_json::Value::String(modern);
                }
            }
        }
    }

    let dest = artifact_path(&ctx.paths.libraries(), &install.path)?;
    let source = installer.to_path_buf();
    blocking(move || write_file(&dest, &read_entry(&source, &install.file_path)?)).await?;

    serde_json::from_value(info)
        .map_err(|error| installer_error("Профиль Forge не разобрался", error))
}

/// Modern installers: libraries, then the processors that patch the client.
async fn install_modern(
    ctx: &super::LoaderContext<'_>,
    mc_version: &str,
    installer: &Path,
    raw: serde_json::Value,
    label: &str,
) -> Result<crate::minecraft::version::VersionJson> {
    use crate::minecraft::rules::Features;
    use crate::minecraft::version::VersionJson;
    use crate::minecraft::{install, libraries, session};
    use crate::net::download::{dedupe_by_destination, download_all, total_bytes, ProgressSink};

    let profile: ModernProfile = serde_json::from_value(raw)
        .map_err(|error| installer_error("install_profile.json не разобрался", error))?;
    let libraries_root = ctx.paths.libraries();

    // Jars the installer carries itself, before anything tries to download them.
    let (source, target) = (installer.to_path_buf(), libraries_root.clone());
    blocking(move || extract_embedded_maven(&source, &target)).await?;

    let json_entry = profile
        .json
        .as_deref()
        .unwrap_or("/version.json")
        .trim_start_matches('/')
        .to_owned();
    let source = installer.to_path_buf();
    let version: VersionJson = blocking(move || {
        serde_json::from_slice(&read_entry(&source, &json_entry)?)
            .map_err(|error| installer_error("Профиль версии в установщике не разобрался", error))
    })
    .await?;

    // Libraries the processors themselves need.
    let tooling = VersionJson {
        libraries: profile.libraries.clone(),
        ..VersionJson::default()
    };
    let downloads = dedupe_by_destination(
        libraries::resolve(&tooling, &libraries_root, Features::default())?.downloads,
    );
    ctx.progress.begin_phase(
        format!("Инструменты {label} ({})", downloads.len()),
        Some(total_bytes(&downloads)),
    );
    download_all(
        ctx.client,
        downloads,
        ctx.concurrency,
        ctx.progress.token(),
        Arc::clone(&ctx.progress) as Arc<dyn ProgressSink>,
    )
    .await?;

    let processors: Vec<Processor> = profile
        .processors
        .iter()
        .filter(|processor| processor.runs_on_client())
        .cloned()
        .collect();
    if processors.is_empty() {
        return Ok(version);
    }

    // Processors read and patch the vanilla client jar, and need a JVM that
    // matches the game version.
    let vanilla = install::ensure_installed(
        ctx.client,
        ctx.paths,
        ctx.instance_id,
        mc_version,
        ctx.concurrency,
        Arc::clone(&ctx.progress),
    )
    .await?;
    let required = crate::java::major_for_declared(vanilla.version.required_java_major());
    let java = session::resolve_java(
        ctx.client,
        ctx.paths,
        None,
        required,
        Arc::clone(&ctx.progress),
    )
    .await?;

    let builtins = HashMap::from([
        (String::from("SIDE"), String::from("client")),
        (String::from("MINECRAFT_VERSION"), mc_version.to_owned()),
        (
            String::from("MINECRAFT_JAR"),
            path_string(&ctx.paths.client_jar(mc_version)),
        ),
        (String::from("ROOT"), path_string(ctx.paths.root())),
        (String::from("INSTALLER"), path_string(installer)),
        (String::from("LIBRARY_DIR"), path_string(&libraries_root)),
    ]);
    let extract_dir = installer.with_extension("data");
    let (source, target, raw_data) = (
        installer.to_path_buf(),
        libraries_root.clone(),
        profile.data,
    );
    let data = blocking(move || build_data(&raw_data, builtins, &source, &extract_dir, &target))
        .await?;

    let run = ProcessorRun {
        java: &java,
        data: &data,
        libraries: &libraries_root,
        token: ctx.progress.token(),
    };
    let total = processors.len();
    for (index, processor) in processors.iter().enumerate() {
        ctx.progress.check_cancelled()?;
        ctx.progress.set_stage(format!(
            "{label}: шаг {}/{total} — {}",
            index + 1,
            processor.short_name()
        ));
        run_processor(&run, processor).await?;
    }

    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data() -> HashMap<String, String> {
        HashMap::from([
            (String::from("SIDE"), String::from("client")),
            (String::from("ROOT"), String::from("/data")),
            (String::from("MC_SLIM"), String::from("/libs/slim.jar")),
        ])
    }

    #[test]
    fn artifact_tokens_become_library_paths() -> Result<()> {
        let path = substitute(
            "[net.minecraft:client:1.21.1-20240808.144430:slim]",
            &data(),
            Path::new("/libs"),
        )?;
        assert!(path.replace('\\', "/").ends_with(
            "net/minecraft/client/1.21.1-20240808.144430/client-1.21.1-20240808.144430-slim.jar"
        ));
        Ok(())
    }

    #[test]
    fn literals_and_embedded_keys_are_resolved() -> Result<()> {
        let libs = Path::new("/libs");
        assert_eq!(substitute("'20230612.114412'", &data(), libs)?, "20230612.114412");
        assert_eq!(substitute("{SIDE}", &data(), libs)?, "client");
        // Keys are replaced anywhere in the argument, not only whole tokens.
        assert_eq!(substitute("{ROOT}/libraries/", &data(), libs)?, "/data/libraries/");
        assert_eq!(substitute("--task", &data(), libs)?, "--task");
        Ok(())
    }

    #[test]
    fn an_unknown_key_is_an_error_not_a_silent_blank() {
        let error = substitute("{MISSING}", &data(), Path::new("/libs")).err();
        assert!(error.is_some_and(|e| e.message.contains("MISSING")));
    }

    #[test]
    fn server_only_processors_are_skipped() -> std::result::Result<(), serde_json::Error> {
        let server: Processor =
            serde_json::from_str(r#"{"jar":"a:b:1","args":[],"sides":["server"]}"#)?;
        let both: Processor = serde_json::from_str(r#"{"jar":"a:b:1","args":[]}"#)?;
        let client: Processor =
            serde_json::from_str(r#"{"jar":"a:jarsplitter:1","args":[],"sides":["client"]}"#)?;
        assert!(!server.runs_on_client());
        assert!(both.runs_on_client());
        assert!(client.runs_on_client());
        assert_eq!(client.short_name(), "jarsplitter");
        Ok(())
    }
}
