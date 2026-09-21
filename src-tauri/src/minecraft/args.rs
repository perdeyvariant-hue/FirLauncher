//! Building the JVM and game argument lists, including placeholder
//! substitution (`${auth_player_name}`, `${classpath}`, ...).

use std::collections::HashMap;
use std::path::Path;

use super::rules::{rules_allow, Features};
use super::version::{Argument, VersionJson};

/// Everything the placeholders can refer to.
#[derive(Debug, Clone)]
pub struct LaunchContext {
    pub player_name: String,
    pub player_uuid: String,
    pub access_token: String,
    pub user_type: String,
    pub xuid: String,
    pub client_id: String,
    pub version_name: String,
    pub version_type: String,
    pub game_dir: String,
    pub assets_dir: String,
    pub assets_index_name: String,
    pub natives_dir: String,
    pub libraries_dir: String,
    pub classpath: String,
    pub resolution: Option<(u32, u32)>,
}

impl LaunchContext {
    fn placeholders(&self) -> HashMap<&'static str, String> {
        let mut map = HashMap::new();
        map.insert("auth_player_name", self.player_name.clone());
        map.insert("auth_uuid", self.player_uuid.clone());
        map.insert("auth_access_token", self.access_token.clone());
        map.insert("auth_session", format!("token:{}", self.access_token));
        map.insert("auth_xuid", self.xuid.clone());
        map.insert("clientid", self.client_id.clone());
        map.insert("user_type", self.user_type.clone());
        map.insert("user_properties", String::from("{}"));
        map.insert("version_name", self.version_name.clone());
        map.insert("version_type", self.version_type.clone());
        map.insert("game_directory", self.game_dir.clone());
        map.insert("assets_root", self.assets_dir.clone());
        map.insert("game_assets", self.assets_dir.clone());
        map.insert("assets_index_name", self.assets_index_name.clone());
        map.insert("natives_directory", self.natives_dir.clone());
        map.insert("library_directory", self.libraries_dir.clone());
        map.insert("classpath", self.classpath.clone());
        map.insert("classpath_separator", String::from(CLASSPATH_SEPARATOR));
        map.insert("launcher_name", String::from("FirLauncher"));
        map.insert(
            "launcher_version",
            String::from(env!("CARGO_PKG_VERSION")),
        );
        if let Some((width, height)) = self.resolution {
            map.insert("resolution_width", width.to_string());
            map.insert("resolution_height", height.to_string());
        }
        map
    }

    pub fn features(&self) -> Features {
        Features {
            has_custom_resolution: self.resolution.is_some(),
            ..Features::default()
        }
    }
}

pub const CLASSPATH_SEPARATOR: &str = if cfg!(windows) { ";" } else { ":" };

pub fn join_classpath(entries: &[std::path::PathBuf]) -> String {
    entries
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join(CLASSPATH_SEPARATOR)
}

fn substitute(template: &str, values: &HashMap<&'static str, String>) -> String {
    let mut result = template.to_owned();
    for (key, value) in values {
        let needle = format!("${{{key}}}");
        if result.contains(&needle) {
            result = result.replace(&needle, value);
        }
    }
    result
}

/// Expands one argument entry, dropping anything whose rules do not apply or
/// whose placeholders we cannot fill.
fn expand(
    argument: &Argument,
    values: &HashMap<&'static str, String>,
    features: Features,
    out: &mut Vec<String>,
) {
    let raw = match argument {
        Argument::Plain(value) => vec![value.clone()],
        Argument::Conditional { rules, value } => {
            if !rules_allow(rules, features) {
                return;
            }
            value.clone().into_vec()
        }
    };

    for item in raw {
        let expanded = substitute(&item, values);
        // An unresolved placeholder means the game would receive a literal
        // "${...}"; dropping the argument is safer than passing garbage.
        if expanded.contains("${") {
            continue;
        }
        out.push(expanded);
    }
}

fn fallback_jvm_args() -> Vec<Argument> {
    vec![
        Argument::Plain(String::from("-Djava.library.path=${natives_directory}")),
        Argument::Plain(String::from("-cp")),
        Argument::Plain(String::from("${classpath}")),
    ]
}

pub fn build_jvm_args(version: &VersionJson, context: &LaunchContext) -> Vec<String> {
    let values = context.placeholders();
    let features = context.features();
    let mut out = Vec::new();

    match version.arguments.as_ref() {
        Some(arguments) if !arguments.jvm.is_empty() => {
            for argument in &arguments.jvm {
                expand(argument, &values, features, &mut out);
            }
        }
        // Pre-1.13 profiles have no jvm section at all.
        _ => {
            for argument in fallback_jvm_args() {
                expand(&argument, &values, features, &mut out);
            }
        }
    }

    out
}

pub fn build_game_args(version: &VersionJson, context: &LaunchContext) -> Vec<String> {
    let values = context.placeholders();
    let features = context.features();
    let mut out = Vec::new();

    if let Some(arguments) = version.arguments.as_ref() {
        for argument in &arguments.game {
            expand(argument, &values, features, &mut out);
        }
    } else if let Some(legacy) = version.minecraft_arguments.as_ref() {
        for token in legacy.split_whitespace() {
            expand(&Argument::Plain(token.to_owned()), &values, features, &mut out);
        }
    }

    out
}

/// Splits a user-provided JVM argument string, honouring simple quoting.
pub fn split_user_args(raw: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;

    for ch in raw.chars() {
        match (quote, ch) {
            (Some(open), c) if c == open => quote = None,
            (Some(_), c) => current.push(c),
            (None, '"') | (None, '\'') => quote = Some(ch),
            (None, c) if c.is_whitespace() => {
                if !current.is_empty() {
                    args.push(std::mem::take(&mut current));
                }
            }
            (None, c) => current.push(c),
        }
    }
    if !current.is_empty() {
        args.push(current);
    }
    args
}

/// `-Xmx` in megabytes, plus the matching `-Xms` the vanilla launcher uses.
pub fn memory_args(memory_mb: u32) -> Vec<String> {
    let min = (memory_mb / 2).max(512);
    vec![format!("-Xms{min}M"), format!("-Xmx{memory_mb}M")]
}

pub fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::minecraft::version::{Argument, ArgValue, Arguments, VersionJson};

    fn context() -> LaunchContext {
        LaunchContext {
            player_name: String::from("Steve"),
            player_uuid: String::from("0000-uuid"),
            access_token: String::from("token"),
            user_type: String::from("legacy"),
            xuid: String::new(),
            client_id: String::new(),
            version_name: String::from("1.20.4"),
            version_type: String::from("release"),
            game_dir: String::from("/games/one"),
            assets_dir: String::from("/data/assets"),
            assets_index_name: String::from("12"),
            natives_dir: String::from("/games/one/natives"),
            libraries_dir: String::from("/data/libraries"),
            classpath: String::from("a.jar:b.jar"),
            resolution: None,
        }
    }

    #[test]
    fn placeholders_are_substituted() {
        let version = VersionJson {
            arguments: Some(Arguments {
                game: vec![
                    Argument::Plain(String::from("--username")),
                    Argument::Plain(String::from("${auth_player_name}")),
                    Argument::Plain(String::from("--gameDir")),
                    Argument::Plain(String::from("${game_directory}")),
                ],
                jvm: vec![Argument::Plain(String::from(
                    "-Djava.library.path=${natives_directory}",
                ))],
            }),
            ..VersionJson::default()
        };

        let context = context();
        assert_eq!(
            build_game_args(&version, &context),
            vec!["--username", "Steve", "--gameDir", "/games/one"]
        );
        assert_eq!(
            build_jvm_args(&version, &context),
            vec!["-Djava.library.path=/games/one/natives"]
        );
    }

    #[test]
    fn unresolved_placeholders_are_dropped() {
        let version = VersionJson {
            arguments: Some(Arguments {
                game: vec![
                    Argument::Plain(String::from("--quickPlayPath")),
                    Argument::Plain(String::from("${quickPlayPath}")),
                ],
                jvm: Vec::new(),
            }),
            ..VersionJson::default()
        };
        // The flag survives but its unfillable value does not, so the game
        // never sees a literal "${...}".
        assert_eq!(build_game_args(&version, &context()), vec!["--quickPlayPath"]);
    }

    #[test]
    fn legacy_profiles_get_a_classpath_from_the_fallback_jvm_args() {
        let version = VersionJson {
            minecraft_arguments: Some(String::from("--username ${auth_player_name}")),
            ..VersionJson::default()
        };
        let jvm = build_jvm_args(&version, &context());
        assert!(jvm.contains(&String::from("-cp")));
        assert!(jvm.contains(&String::from("a.jar:b.jar")));
        assert_eq!(build_game_args(&version, &context()), vec!["--username", "Steve"]);
    }

    #[test]
    fn conditional_arguments_follow_feature_rules() {
        let version = VersionJson {
            arguments: Some(Arguments {
                game: vec![Argument::Conditional {
                    rules: vec![crate::minecraft::rules::Rule {
                        action: String::from("allow"),
                        os: None,
                        features: Some(
                            [(String::from("has_custom_resolution"), true)]
                                .into_iter()
                                .collect(),
                        ),
                    }],
                    value: ArgValue::Many(vec![
                        String::from("--width"),
                        String::from("${resolution_width}"),
                    ]),
                }],
                jvm: Vec::new(),
            }),
            ..VersionJson::default()
        };

        assert!(build_game_args(&version, &context()).is_empty());

        let mut with_resolution = context();
        with_resolution.resolution = Some((1280, 720));
        assert_eq!(
            build_game_args(&version, &with_resolution),
            vec!["--width", "1280"]
        );
    }

    #[test]
    fn user_arguments_respect_quotes() {
        assert_eq!(
            split_user_args("-Xss2M -Dpath=\"C:/Program Files/x\" -XX:+UseG1GC"),
            vec!["-Xss2M", "-Dpath=C:/Program Files/x", "-XX:+UseG1GC"]
        );
        assert!(split_user_args("   ").is_empty());
    }

    #[test]
    fn memory_args_pair_xms_with_xmx() {
        assert_eq!(memory_args(4096), vec!["-Xms2048M", "-Xmx4096M"]);
        // Never below a usable floor, however small the slider goes.
        assert_eq!(memory_args(512), vec!["-Xms512M", "-Xmx512M"]);
    }
}
