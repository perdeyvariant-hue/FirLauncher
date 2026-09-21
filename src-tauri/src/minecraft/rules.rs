//! Mojang's `rules` blocks — the mechanism that decides which libraries,
//! natives and arguments apply to this machine.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsRule {
    pub name: Option<String>,
    /// A regex over the OS version. We deliberately do not evaluate it: the
    /// only real-world uses are old macOS carve-outs, and treating them as a
    /// match is the permissive choice that keeps launches working.
    pub version: Option<String>,
    pub arch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rule {
    pub action: String,
    pub os: Option<OsRule>,
    pub features: Option<HashMap<String, bool>>,
}

/// Feature flags the launcher can turn on; they gate conditional arguments.
#[derive(Debug, Clone, Copy, Default)]
pub struct Features {
    pub is_demo_user: bool,
    pub has_custom_resolution: bool,
    pub has_quick_plays_support: bool,
    pub is_quick_play_singleplayer: bool,
    pub is_quick_play_multiplayer: bool,
    pub is_quick_play_realms: bool,
}

impl Features {
    fn get(self, name: &str) -> bool {
        match name {
            "is_demo_user" => self.is_demo_user,
            "has_custom_resolution" => self.has_custom_resolution,
            "has_quick_plays_support" => self.has_quick_plays_support,
            "is_quick_play_singleplayer" => self.is_quick_play_singleplayer,
            "is_quick_play_multiplayer" => self.is_quick_play_multiplayer,
            "is_quick_play_realms" => self.is_quick_play_realms,
            // Unknown features are off; Mojang adds them faster than launchers.
            _ => false,
        }
    }
}

/// Mojang's name for the current platform.
pub fn current_os() -> &'static str {
    match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "osx",
        _ => "linux",
    }
}

/// Mojang's name for the current architecture.
pub fn current_arch() -> &'static str {
    match std::env::consts::ARCH {
        "x86" => "x86",
        "aarch64" => "arm64",
        "arm" => "arm32",
        _ => "x86_64",
    }
}

fn os_matches(os: &OsRule) -> bool {
    if let Some(name) = &os.name {
        if name != current_os() {
            return false;
        }
    }
    if let Some(arch) = &os.arch {
        if arch != current_arch() {
            return false;
        }
    }
    true
}

fn rule_matches(rule: &Rule, features: Features) -> bool {
    if let Some(os) = &rule.os {
        if !os_matches(os) {
            return false;
        }
    }
    if let Some(required) = &rule.features {
        for (name, expected) in required {
            if features.get(name) != *expected {
                return false;
            }
        }
    }
    true
}

/// Evaluates a rule list the way the vanilla launcher does: no rules means
/// allowed, otherwise the last matching rule wins.
pub fn rules_allow(rules: &[Rule], features: Features) -> bool {
    if rules.is_empty() {
        return true;
    }
    let mut allowed = false;
    for rule in rules {
        if rule_matches(rule, features) {
            allowed = rule.action == "allow";
        }
    }
    allowed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(action: &str, os: Option<&str>) -> Rule {
        Rule {
            action: action.to_owned(),
            os: os.map(|name| OsRule {
                name: Some(name.to_owned()),
                version: None,
                arch: None,
            }),
            features: None,
        }
    }

    #[test]
    fn no_rules_means_allowed() {
        assert!(rules_allow(&[], Features::default()));
    }

    #[test]
    fn the_last_matching_rule_wins() {
        // Mojang's usual shape: allow everywhere, then carve out one OS.
        let rules = vec![rule("allow", None), rule("disallow", Some(current_os()))];
        assert!(!rules_allow(&rules, Features::default()));

        let other = if current_os() == "windows" { "linux" } else { "windows" };
        let rules = vec![rule("allow", None), rule("disallow", Some(other))];
        assert!(rules_allow(&rules, Features::default()));
    }

    #[test]
    fn an_os_only_allow_excludes_other_platforms() {
        assert!(rules_allow(&[rule("allow", Some(current_os()))], Features::default()));
        let other = if current_os() == "linux" { "osx" } else { "linux" };
        assert!(!rules_allow(&[rule("allow", Some(other))], Features::default()));
    }

    #[test]
    fn unknown_features_are_treated_as_off() {
        let rules = vec![Rule {
            action: String::from("allow"),
            os: None,
            features: Some([(String::from("is_time_traveller"), true)].into_iter().collect()),
        }];
        assert!(!rules_allow(&rules, Features::default()));
    }
}
