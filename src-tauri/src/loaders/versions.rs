//! Ordering loader version strings.
//!
//! Upstream lists are not reliably sorted (Quilt's meta and Forge's maven
//! metadata both mix orders), so the UI sorts them itself. Numbers compare as
//! numbers, and a release outranks its own pre-releases.

use std::cmp::Ordering;

#[derive(Debug, PartialEq, Eq)]
enum Part<'a> {
    Number(u64),
    Text(&'a str),
}

fn parts(version: &str) -> Vec<Part<'_>> {
    let mut out = Vec::new();
    let bytes = version.as_bytes();
    let mut start = 0;
    while start < bytes.len() {
        let is_digit = bytes[start].is_ascii_digit();
        let mut end = start;
        while end < bytes.len() && bytes[end].is_ascii_digit() == is_digit {
            end += 1;
        }
        let chunk = &version[start..end];
        if is_digit {
            out.push(Part::Number(chunk.parse().unwrap_or(u64::MAX)));
        } else {
            let trimmed = chunk.trim_matches(|c: char| c == '.' || c == '-' || c == '+');
            if !trimmed.is_empty() {
                out.push(Part::Text(trimmed));
            }
        }
        start = end;
    }
    out
}

/// Version-aware comparison: `0.16.10 > 0.16.9`, `1.0 > 1.0-beta.2`.
pub fn compare(left: &str, right: &str) -> Ordering {
    let (a, b) = (parts(left), parts(right));
    for (x, y) in a.iter().zip(b.iter()) {
        let order = match (x, y) {
            (Part::Number(x), Part::Number(y)) => x.cmp(y),
            // A number where the other side has a tag: the plain release wins.
            (Part::Number(_), Part::Text(_)) => Ordering::Greater,
            (Part::Text(_), Part::Number(_)) => Ordering::Less,
            (Part::Text(x), Part::Text(y)) => x.cmp(y),
        };
        if order != Ordering::Equal {
            return order;
        }
    }
    // `1.0` vs `1.0-beta`: the shorter one is the release, unless the longer
    // one simply continues with more numbers (`1.0` < `1.0.1`).
    match (a.get(b.len()), b.get(a.len())) {
        (Some(Part::Text(_)), None) => Ordering::Less,
        (None, Some(Part::Text(_))) => Ordering::Greater,
        _ => a.len().cmp(&b.len()),
    }
}

/// Newest first.
pub fn sort_descending(versions: &mut [String]) {
    versions.sort_by(|a, b| compare(b, a));
}

/// Pre-release markers used across Fabric, Quilt, Forge and NeoForge.
pub fn looks_unstable(version: &str) -> bool {
    let lower = version.to_ascii_lowercase();
    ["alpha", "beta", "pre", "rc", "snapshot"]
        .iter()
        .any(|marker| lower.contains(marker))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_compare_numerically() {
        assert_eq!(compare("0.16.10", "0.16.9"), Ordering::Greater);
        assert_eq!(compare("21.1.100", "21.1.99"), Ordering::Greater);
        assert_eq!(compare("14.23.5.2860", "14.23.5.2859"), Ordering::Greater);
    }

    #[test]
    fn releases_beat_their_prereleases() {
        assert_eq!(compare("0.27.1", "0.27.1-beta.3"), Ordering::Greater);
        assert_eq!(compare("26.1.0.0-alpha.1", "26.1.0.0"), Ordering::Less);
        assert_eq!(compare("1.0", "1.0.1"), Ordering::Less);
    }

    #[test]
    fn quilt_order_is_repaired() {
        let mut list = vec![
            String::from("0.20.0-beta.9"),
            String::from("0.27.1"),
            String::from("0.26.4"),
            String::from("0.27.1-beta.1"),
        ];
        sort_descending(&mut list);
        assert_eq!(list, vec!["0.27.1", "0.27.1-beta.1", "0.26.4", "0.20.0-beta.9"]);
    }

    #[test]
    fn prerelease_markers_are_recognised() {
        assert!(looks_unstable("26.3.0.4-beta"));
        assert!(looks_unstable("0.20.0-beta.9"));
        assert!(looks_unstable("26.1.0.0-alpha.1+snapshot-1"));
        assert!(!looks_unstable("21.1.77"));
    }
}
