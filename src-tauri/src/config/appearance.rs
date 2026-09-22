//! Personalisation: accent colour, wallpaper, corner mascot and interface
//! tweaks. Stored inside `settings.json`; custom pictures live next to it in
//! `appearance/` (see `crate::appearance`).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Wallpaper {
    None,
    Mist,
    Dots,
    Forest,
    /// The user's own picture, `appearance/wallpaper.*`.
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mascot {
    None,
    /// The active account's skin, drawn full-length.
    Skin,
    /// One of the user's own pictures, by `mascot_custom_id`
    /// (`appearance/mascots/<id>.*`).
    Custom,
    /// A freely licensed picture shipped with the launcher, by
    /// `mascot_gallery_id` (see `public/mascots/CREDITS.md`).
    Gallery,
    /// Anything no longer offered (the drawn fir, cat and fox of earlier
    /// versions); `sanitized` turns it into `None` so old files still load.
    #[serde(other)]
    Retired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Left,
    Right,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Appearance {
    /// `#RRGGBB`; hover and pressed shades are derived from it.
    pub accent: String,
    pub wallpaper: Wallpaper,
    /// How much the wallpaper is dimmed towards the background, percent.
    pub wallpaper_dim: u8,
    pub wallpaper_blur: u8,
    /// Translucent, blurred panels so the wallpaper shows through.
    pub glass_panels: bool,
    pub mascot: Mascot,
    /// Which gallery picture, when `mascot` is `Gallery`.
    pub mascot_gallery_id: String,
    /// Which of the user's pictures, when `mascot` is `Custom`.
    pub mascot_custom_id: String,
    /// Height in CSS pixels.
    pub mascot_size: u16,
    /// Percent.
    pub mascot_opacity: u8,
    pub mascot_side: Side,
    /// Interface zoom, percent.
    pub ui_scale: u16,
    /// Corner radius of panels and buttons, px.
    pub radius: u8,
    pub reduce_motion: bool,
}

pub const DEFAULT_ACCENT: &str = "#8B5CF6";
pub const DEFAULT_GALLERY_ID: &str = "wikipe-tan-classic";

impl Default for Appearance {
    fn default() -> Self {
        Self {
            accent: String::from(DEFAULT_ACCENT),
            wallpaper: Wallpaper::None,
            wallpaper_dim: 55,
            wallpaper_blur: 0,
            glass_panels: true,
            mascot: Mascot::None,
            mascot_gallery_id: String::from(DEFAULT_GALLERY_ID),
            mascot_custom_id: String::new(),
            mascot_size: 150,
            mascot_opacity: 85,
            mascot_side: Side::Right,
            ui_scale: 100,
            radius: 10,
            reduce_motion: false,
        }
    }
}

/// Ids end up in file names and URLs; keep them to plain slugs.
fn is_slug(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 48
        && value.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn is_hex_colour(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value[1..].chars().all(|c| c.is_ascii_hexdigit())
}

impl Appearance {
    /// Brings a hand-edited or stale value back into the ranges the UI can
    /// render: a zoom of 900% or a colour of "banana" would lock people out.
    pub fn sanitized(mut self) -> Self {
        if !is_hex_colour(&self.accent) {
            self.accent = String::from(DEFAULT_ACCENT);
        }
        self.accent.make_ascii_uppercase();
        if !is_slug(&self.mascot_gallery_id) {
            self.mascot_gallery_id = String::from(DEFAULT_GALLERY_ID);
        }
        if !self.mascot_custom_id.is_empty() && !is_slug(&self.mascot_custom_id) {
            self.mascot_custom_id.clear();
        }
        if self.mascot == Mascot::Retired {
            self.mascot = Mascot::None;
        }
        self.wallpaper_dim = self.wallpaper_dim.min(90);
        self.wallpaper_blur = self.wallpaper_blur.min(24);
        self.mascot_size = self.mascot_size.clamp(64, 320);
        self.mascot_opacity = self.mascot_opacity.clamp(10, 100);
        self.ui_scale = self.ui_scale.clamp(80, 130);
        self.radius = self.radius.min(16);
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn out_of_range_values_are_pulled_back() {
        let wild = Appearance {
            accent: String::from("banana"),
            wallpaper_dim: 200,
            wallpaper_blur: 99,
            mascot_size: 5,
            mascot_opacity: 0,
            ui_scale: 900,
            radius: 80,
            mascot_gallery_id: String::from("../../etc/passwd"),
            ..Appearance::default()
        }
        .sanitized();
        assert_eq!(wild.mascot_gallery_id, DEFAULT_GALLERY_ID);
        assert_eq!(wild.accent, DEFAULT_ACCENT);
        assert_eq!(wild.wallpaper_dim, 90);
        assert_eq!(wild.wallpaper_blur, 24);
        assert_eq!(wild.mascot_size, 64);
        assert_eq!(wild.mascot_opacity, 10);
        assert_eq!(wild.ui_scale, 130);
        assert_eq!(wild.radius, 16);
    }

    #[test]
    fn a_valid_colour_is_kept_and_normalised() {
        let tidy = Appearance {
            accent: String::from("#14b8a6"),
            ..Appearance::default()
        }
        .sanitized();
        assert_eq!(tidy.accent, "#14B8A6");
    }

    #[test]
    fn retired_mascots_load_as_none() -> std::result::Result<(), serde_json::Error> {
        let old: Appearance = serde_json::from_str(r#"{"mascot": "fir"}"#)?;
        assert_eq!(old.mascot, Mascot::Retired);
        assert_eq!(old.sanitized().mascot, Mascot::None);
        Ok(())
    }

    #[test]
    fn older_settings_files_get_defaults() -> std::result::Result<(), serde_json::Error> {
        let partial: Appearance = serde_json::from_str(r##"{"accent": "#22C55E"}"##)?;
        assert_eq!(partial.accent, "#22C55E");
        assert_eq!(partial.ui_scale, 100);
        assert_eq!(partial.mascot, Mascot::None);
        Ok(())
    }
}
