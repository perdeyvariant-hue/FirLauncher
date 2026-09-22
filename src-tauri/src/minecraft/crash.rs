//! Reading a crash: the game's output, its crash report and the JVM's
//! hs_err file become plain-language diagnoses, each with a fix the launcher
//! can apply by itself when there is one.
//!
//! The rules match the messages of Fabric, Quilt, Forge, NeoForge and the JVM
//! as they are printed today. Everything here is pure text work, so it is
//! tested against real-world excerpts below.

use std::collections::BTreeSet;
use std::sync::OnceLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

/// Something the launcher can do about a diagnosis.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CrashFix {
    /// Install these mods (mod ids, which on Modrinth are usually the slug).
    #[serde(rename_all = "camelCase")]
    InstallMods { mod_ids: Vec<String> },
    /// Run this instance on the given Java major.
    #[serde(rename_all = "camelCase")]
    UseJava { major: u32 },
    /// Give the game this much memory.
    #[serde(rename_all = "camelCase")]
    SetMemory { memory_mb: u32 },
    /// Switch these mods off (by mod id; the launcher finds the files).
    #[serde(rename_all = "camelCase")]
    DisableMods { mod_ids: Vec<String> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnosis {
    /// Stable identifier of the rule, for tests and telemetry-free debugging.
    pub rule: &'static str,
    pub title: String,
    pub explanation: String,
    pub fix: Option<CrashFix>,
}

/// What the rules look at.
pub struct CrashInput<'a> {
    pub log: &'a str,
    pub crash_report: Option<&'a str>,
    pub hs_err: Option<&'a str>,
    pub exit_code: Option<i32>,
    /// The instance's current memory limit, to suggest a bigger one.
    pub memory_mb: u32,
    pub system_memory_mb: u64,
}

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).unwrap_or_else(|_| Regex::new("$^").unwrap_or_else(|_| unreachable!())))
}

macro_rules! regex {
    ($pattern:expr) => {{
        static CELL: OnceLock<Regex> = OnceLock::new();
        re(&CELL, $pattern)
    }};
}

fn join_ids(ids: &BTreeSet<String>) -> String {
    ids.iter().cloned().collect::<Vec<_>>().join(", ")
}

/// Java class file version → the Java release that introduced it.
fn java_for_class_version(class_version: u32) -> u32 {
    class_version.saturating_sub(44)
}

fn java_version(input: &CrashInput<'_>, out: &mut Vec<Diagnosis>) {
    let text = input.log;
    if let Some(caps) = regex!(r"class file version (\d+)\.\d+\), this version of the Java Runtime only recognizes class file versions up to (\d+)").captures(text) {
        let needed = caps[1].parse::<u32>().map(java_for_class_version).unwrap_or(21);
        let have = caps[2].parse::<u32>().map(java_for_class_version).unwrap_or(0);
        out.push(Diagnosis {
            rule: "java-too-old",
            title: format!("Нужна Java {needed}"),
            explanation: format!(
                "Мод или игра собраны под Java {needed}, а сборка запускалась на Java {have}. \
                 Лаунчер может скачать Java {needed} и запускать эту сборку на ней."
            ),
            fix: Some(CrashFix::UseJava { major: needed }),
        });
        return;
    }
    // Fabric: "Fabric Loader requires Java 17" / Forge: "requires java 21".
    if let Some(caps) = regex!(r"(?i)(?:requires|needs) (?:at least )?java (\d{1,2})\b").captures(text) {
        let needed = caps[1].parse::<u32>().unwrap_or(21);
        out.push(Diagnosis {
            rule: "java-required",
            title: format!("Нужна Java {needed}"),
            explanation: format!("Загрузчик сообщил, что ему нужна Java {needed}."),
            fix: Some(CrashFix::UseJava { major: needed }),
        });
    }
}

fn missing_dependencies(input: &CrashInput<'_>, out: &mut Vec<Diagnosis>) {
    let text = input.log;
    let mut missing: BTreeSet<String> = BTreeSet::new();
    let mut wrong: Vec<String> = Vec::new();

    // Fabric / Quilt: "- Mod 'Sodium Extra' (sodium-extra) 0.5.4 requires any version of
    // sodium, which is missing!" and "... requires version 0.5 or later of mod 'Sodium'
    // (sodium), which is missing!"
    for caps in regex!(r"requires (?:any version|version [^\n]*?) of (?:mod '[^']*' \()?([a-z0-9_\-]+)\)?,? which is missing").captures_iter(text) {
        missing.insert(caps[1].to_owned());
    }
    // Fabric: "... requires version X of mod 'Y' (y), but only the wrong version is present: Z!"
    for caps in regex!(r"Mod '([^']+)' \([^)]*\) [^\n]*? requires ([^\n]*?) of mod '([^']+)' \([^)]*\), but only the wrong version is present: ([^!\n]+)").captures_iter(text) {
        wrong.push(format!("«{}» требует {} {}, а стоит {}", &caps[1], &caps[3], &caps[2], caps[4].trim()));
    }
    // Forge / NeoForge: "Mod ID: 'geckolib', Requested by: 'mowziesmobs', Expected range:
    // '[4.4.2,)', Actual version: '[MISSING]'"
    for caps in regex!(r"Mod ID: '([^']+)', Requested by: '([^']+)', Expected range: '([^']*)', Actual version: '([^']*)'").captures_iter(text) {
        if caps[4].contains("MISSING") {
            missing.insert(caps[1].to_owned());
        } else {
            wrong.push(format!("«{}» требует {} {}, а стоит {}", &caps[2], &caps[1], &caps[3], &caps[4]));
        }
    }
    // The most common one, seen without a resolver message at all.
    if regex!(r"NoClassDefFoundError: net/fabricmc/fabric/api").is_match(text) {
        missing.insert(String::from("fabric-api"));
    }
    // Loader ids that are not mods on Modrinth.
    for builtin in ["minecraft", "java", "fabricloader", "fabric-loader", "forge", "neoforge", "quilt_loader"] {
        missing.remove(builtin);
    }

    if !missing.is_empty() {
        out.push(Diagnosis {
            rule: "missing-dependency",
            title: format!("Не хватает модов: {}", join_ids(&missing)),
            explanation: String::from(
                "Одному из модов нужны другие, а их нет в папке mods. Лаунчер найдёт их на Modrinth \
                 под версию и лоадер этой сборки.",
            ),
            fix: Some(CrashFix::InstallMods { mod_ids: missing.into_iter().collect() }),
        });
    }
    if !wrong.is_empty() {
        out.push(Diagnosis {
            rule: "wrong-dependency-version",
            title: String::from("Неподходящие версии модов"),
            explanation: format!(
                "{}. Обновите моды во вкладке «Моды» → «Проверить обновления».",
                wrong.join("; ")
            ),
            fix: None,
        });
    }
}

fn incompatible_mods(input: &CrashInput<'_>, out: &mut Vec<Diagnosis>) {
    // Fabric: "- Mod 'A' (a) 1.0 is incompatible with any version of mod 'B' (b), but
    // B is present!"
    let mut pairs = Vec::new();
    let mut ids = BTreeSet::new();
    for caps in regex!(r"Mod '([^']+)' \(([a-z0-9_\-]+)\)[^\n]*? is incompatible with [^\n]*?mod '([^']+)' \(([a-z0-9_\-]+)\)").captures_iter(input.log) {
        pairs.push(format!("«{}» и «{}»", &caps[1], &caps[3]));
        ids.insert(caps[4].to_owned());
    }
    if !pairs.is_empty() {
        out.push(Diagnosis {
            rule: "incompatible-mods",
            title: String::from("Несовместимые моды"),
            explanation: format!(
                "Не работают вместе: {}. Выключите один из каждой пары.",
                pairs.join(", ")
            ),
            fix: Some(CrashFix::DisableMods { mod_ids: ids.into_iter().collect() }),
        });
    }
}

fn duplicate_mods(input: &CrashInput<'_>, out: &mut Vec<Diagnosis>) {
    let mut ids = BTreeSet::new();
    // Forge / NeoForge: "Mod ID: 'jei' from mod files: jei-1.jar, jei-2.jar"
    for caps in regex!(r"Mod ID: '([^']+)' from mod files: ").captures_iter(input.log) {
        ids.insert(caps[1].to_owned());
    }
    // Fabric: "Mod 'Sodium' (sodium) ... duplicates" / "found duplicate mods: sodium"
    for caps in regex!(r"(?i)duplicate mod(?:s)?(?: found)?[:\s]+(?:mod )?'?([a-z0-9_\-]+)").captures_iter(input.log) {
        ids.insert(caps[1].to_owned());
    }
    if !ids.is_empty() {
        out.push(Diagnosis {
            rule: "duplicate-mods",
            title: format!("Один мод установлен дважды: {}", join_ids(&ids)),
            explanation: String::from(
                "В папке mods лежат две версии одного мода. Удалите старую во вкладке «Моды».",
            ),
            fix: None,
        });
    }
}

fn memory(input: &CrashInput<'_>, out: &mut Vec<Diagnosis>) {
    let text = format!("{}\n{}", input.log, input.hs_err.unwrap_or_default());
    if regex!(r"OutOfMemoryError|GC overhead limit exceeded|Java heap space").is_match(&text) {
        // One notch up, but never more than half of the machine.
        let cap = u32::try_from(input.system_memory_mb / 2).unwrap_or(u32::MAX).max(2048);
        let suggested = (input.memory_mb + 2048).min(cap);
        let fix = (suggested > input.memory_mb).then_some(CrashFix::SetMemory { memory_mb: suggested });
        out.push(Diagnosis {
            rule: "out-of-memory",
            title: String::from("Игре не хватило памяти"),
            explanation: if fix.is_some() {
                format!(
                    "Сейчас выделено {} МБ. Можно выделить {} МБ — больше половины памяти компьютера \
                     лаунчер не предлагает.",
                    input.memory_mb, suggested
                )
            } else {
                String::from(
                    "Памяти уже выделено столько, сколько разумно. Уберите тяжёлые моды или шейдеры.",
                )
            },
            fix,
        });
        return;
    }
    if regex!(r"Could not reserve enough space for (?:object heap|\d+KB object heap)|Invalid maximum heap size|Initial heap size set to a larger value").is_match(&text) {
        let suggested = (input.memory_mb / 2).max(1024);
        out.push(Diagnosis {
            rule: "heap-too-big",
            title: String::from("Java не смогла выделить столько памяти"),
            explanation: format!(
                "Запрошено {} МБ, но система их не дала (часто это 32-битная Java или мало \
                 свободной памяти). Попробуйте {} МБ.",
                input.memory_mb, suggested
            ),
            fix: Some(CrashFix::SetMemory { memory_mb: suggested }),
        });
    }
}

fn mixin_failures(input: &CrashInput<'_>, out: &mut Vec<Diagnosis>) {
    let text = format!("{}\n{}", input.log, input.crash_report.unwrap_or_default());
    let mut ids = BTreeSet::new();
    for caps in regex!(r"Mixin apply for mod ([a-z0-9_\-]+) failed").captures_iter(&text) {
        ids.insert(caps[1].to_owned());
    }
    for caps in regex!(r"in config \[([a-z0-9_\-]+)\.[a-z0-9_.\-]*mixins?\.json\] FAILED").captures_iter(&text) {
        ids.insert(caps[1].to_owned());
    }
    if !ids.is_empty() {
        out.push(Diagnosis {
            rule: "mixin-failure",
            title: format!("Мод сломался при загрузке: {}", join_ids(&ids)),
            explanation: String::from(
                "Мод не смог встроиться в игру — обычно он собран под другую версию Minecraft или \
                 конфликтует с другим модом. Обновите его или выключите.",
            ),
            fix: Some(CrashFix::DisableMods { mod_ids: ids.into_iter().collect() }),
        });
    }
}

fn suspected_mods(input: &CrashInput<'_>, out: &mut Vec<Diagnosis>) {
    let Some(report) = input.crash_report else { return };
    // Fabric crash reports: "Suspected Mods: Sodium (sodium), Version: 0.5.8"
    let mut ids = BTreeSet::new();
    let mut names = Vec::new();
    if let Some(line) = regex!(r"Suspected Mods?: ([^\n]+)").captures(report) {
        for caps in regex!(r"([^,()]+?) \(([a-z0-9_\-]+)\)").captures_iter(&line[1]) {
            let id = caps[2].to_owned();
            if ["minecraft", "java", "fabricloader", "forge", "neoforge"].contains(&id.as_str()) {
                continue;
            }
            names.push(caps[1].trim().to_owned());
            ids.insert(id);
        }
    }
    if !ids.is_empty() && !out.iter().any(|d| d.rule == "mixin-failure") {
        out.push(Diagnosis {
            rule: "suspected-mod",
            title: format!("Под подозрением: {}", names.join(", ")),
            explanation: String::from(
                "Игра упала внутри этого мода. Проверьте, есть ли для него обновление, или \
                 выключите его и запустите снова.",
            ),
            fix: Some(CrashFix::DisableMods { mod_ids: ids.into_iter().collect() }),
        });
    }
}

fn graphics(input: &CrashInput<'_>, out: &mut Vec<Diagnosis>) {
    let text = format!("{}\n{}", input.log, input.hs_err.unwrap_or_default());
    let driver = regex!(r"(?i)(atio6axx|atioglxx|amdxx|nvoglv(?:32|64)|ig[0-9a-z]+icd(?:32|64)|libnvidia|radeonsi)").find(&text);
    let opengl = regex!(r"GLFW error (?:65542|65543)|WGL: The driver does not appear to support OpenGL|Pixel format not accelerated|OpenGL 3\.2 is not supported|Failed to create window").is_match(&text);
    if opengl || driver.is_some() {
        let which = match driver.map(|m| m.as_str().to_ascii_lowercase()) {
            Some(name) if name.starts_with("nv") || name.contains("nvidia") => "NVIDIA",
            Some(name) if name.starts_with("ati") || name.starts_with("amd") || name.contains("radeon") => "AMD",
            Some(name) if name.starts_with("ig") => "Intel",
            _ => "видеокарты",
        };
        out.push(Diagnosis {
            rule: "graphics-driver",
            title: String::from("Проблема с видеодрайвером"),
            explanation: format!(
                "Игра упала в драйвере {which} или не смогла создать окно OpenGL. Обновите драйвер \
                 с сайта производителя; на ноутбуках запустите игру на дискретной видеокарте. \
                 Если стоят шейдеры — попробуйте без них."
            ),
            fix: None,
        });
    }
}

fn exit_codes(input: &CrashInput<'_>, out: &mut Vec<Diagnosis>) {
    // 0xC0000005, access violation in native code — drivers, overlays, antivirus.
    if input.exit_code == Some(-1_073_741_819) && out.is_empty() {
        out.push(Diagnosis {
            rule: "access-violation",
            title: String::from("Сбой в нативном коде"),
            explanation: String::from(
                "Процесс Java упал с ошибкой доступа к памяти. Чаще всего виноваты видеодрайвер, \
                 оверлеи (Discord, MSI Afterburner, RivaTuner) или антивирус.",
            ),
            fix: None,
        });
    }
}

/// The first meaningful error lines, shown when no rule matched.
pub fn error_excerpt(log: &str, crash_report: Option<&str>) -> Vec<String> {
    let source = crash_report.unwrap_or(log);
    let mut lines: Vec<String> = source
        .lines()
        .filter(|line| {
            let trimmed = line.trim_start();
            trimmed.contains("Exception")
                || trimmed.contains("Error:")
                || trimmed.starts_with("Caused by:")
                || trimmed.starts_with("Description:")
        })
        .map(|line| line.trim().chars().take(300).collect())
        .collect();
    lines.dedup();
    lines.truncate(8);
    lines
}

/// Every diagnosis that applies, most actionable first.
pub fn diagnose(input: &CrashInput<'_>) -> Vec<Diagnosis> {
    let mut out = Vec::new();
    java_version(input, &mut out);
    missing_dependencies(input, &mut out);
    incompatible_mods(input, &mut out);
    duplicate_mods(input, &mut out);
    memory(input, &mut out);
    mixin_failures(input, &mut out);
    suspected_mods(input, &mut out);
    graphics(input, &mut out);
    exit_codes(input, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(log: &str) -> Vec<Diagnosis> {
        diagnose(&CrashInput {
            log,
            crash_report: None,
            hs_err: None,
            exit_code: Some(1),
            memory_mb: 4096,
            system_memory_mb: 16_384,
        })
    }

    #[test]
    fn a_too_old_java_is_named() {
        let found = run("java.lang.UnsupportedClassVersionError: net/minecraft/client/main/Main has been \
            compiled by a more recent version of the Java Runtime (class file version 65.0), this \
            version of the Java Runtime only recognizes class file versions up to 61.0");
        assert_eq!(found[0].fix, Some(CrashFix::UseJava { major: 21 }));
        assert!(found[0].explanation.contains("Java 17"));
    }

    #[test]
    fn fabric_missing_dependencies_are_collected() {
        let found = run("Mod resolution encountered an incompatible mod set!\n\
            A potential solution has been determined:\n\
            \t - Install fabric-api, any version.\n\
            Unmet dependency listing:\n\
            \t - Mod 'Sodium Extra' (sodium-extra) 0.5.4+mc1.20.4 requires any version of sodium, which is missing!\n\
            \t - Mod 'Mod Menu' (modmenu) 9.0.0 requires version 0.95 or later of mod 'Fabric API' (fabric-api), which is missing!\n\
            \t - Mod 'Something' (something) 1.0 requires any version of minecraft, which is missing!");
        let missing = found.iter().find(|d| d.rule == "missing-dependency");
        assert_eq!(
            missing.and_then(|d| d.fix.clone()),
            Some(CrashFix::InstallMods {
                mod_ids: vec![String::from("fabric-api"), String::from("sodium")]
            })
        );
    }

    #[test]
    fn forge_missing_and_wrong_versions_are_told_apart() {
        let found = run("Missing or unsupported mandatory dependencies:\n\
            \tMod ID: 'geckolib', Requested by: 'mowziesmobs', Expected range: '[4.4.2,)', Actual version: '[MISSING]'\n\
            \tMod ID: 'forge', Requested by: 'jei', Expected range: '[47.2,)', Actual version: '47.1.0'");
        assert!(found.iter().any(|d| d.fix == Some(CrashFix::InstallMods { mod_ids: vec![String::from("geckolib")] })));
        assert!(found.iter().any(|d| d.rule == "wrong-dependency-version" && d.explanation.contains("47.1.0")));
    }

    #[test]
    fn fabric_incompatibilities_point_at_a_mod() {
        let found = run("\t - Mod 'Sodium' (sodium) 0.5.8 is incompatible with any version of mod 'OptiFabric' (optifabric), but OptiFabric is present!");
        assert_eq!(
            found[0].fix,
            Some(CrashFix::DisableMods { mod_ids: vec![String::from("optifabric")] })
        );
    }

    #[test]
    fn running_out_of_memory_suggests_more_but_not_everything() {
        let found = run("java.lang.OutOfMemoryError: Java heap space");
        assert_eq!(found[0].fix, Some(CrashFix::SetMemory { memory_mb: 6144 }));

        let big = diagnose(&CrashInput {
            log: "java.lang.OutOfMemoryError: Java heap space",
            crash_report: None,
            hs_err: None,
            exit_code: Some(1),
            memory_mb: 8192,
            system_memory_mb: 16_384,
        });
        assert_eq!(big[0].fix, None, "already at half of the machine");
    }

    #[test]
    fn mixin_failures_and_suspects_name_the_mod() {
        let found = diagnose(&CrashInput {
            log: "org.spongepowered.asm.mixin.transformer.throwables.MixinTransformerError: An unexpected critical error was encountered\n\
                  Caused by: org.spongepowered.asm.mixin.throwables.MixinApplyError: Mixin [foo.mixin.Bar] from phase [DEFAULT] in config [badmod.mixins.json] FAILED during APPLY",
            crash_report: Some("Suspected Mods: Bad Mod (badmod), Version: 1.0\n"),
            hs_err: None,
            exit_code: Some(1),
            memory_mb: 4096,
            system_memory_mb: 16_384,
        });
        assert_eq!(found.len(), 1, "the suspect is the same mod: {found:?}");
        assert_eq!(found[0].fix, Some(CrashFix::DisableMods { mod_ids: vec![String::from("badmod")] }));
    }

    #[test]
    fn a_driver_crash_names_the_vendor() {
        let found = diagnose(&CrashInput {
            log: "",
            crash_report: None,
            hs_err: Some("# Problematic frame:\n# C  [atio6axx.dll+0x1a2b3c]"),
            exit_code: Some(-1_073_741_819),
            memory_mb: 4096,
            system_memory_mb: 16_384,
        });
        assert_eq!(found[0].rule, "graphics-driver");
        assert!(found[0].explanation.contains("AMD"));
        assert_eq!(found.len(), 1, "the access-violation note is redundant then");
    }

    #[test]
    fn unknown_crashes_yield_an_excerpt() {
        assert!(run("[main/INFO]: all fine").is_empty());
        let excerpt = error_excerpt(
            "[main/INFO]: loading\njava.lang.IllegalStateException: boom\n\tat a.b.C\nCaused by: java.io.IOException: disk",
            None,
        );
        assert_eq!(excerpt, vec!["java.lang.IllegalStateException: boom", "Caused by: java.io.IOException: disk"]);
    }
}
