//! Rounded window corners.
//!
//! The window is transparent and the interface draws its own rounded edge,
//! but on Windows the acrylic blur behind it fills the whole rectangle, so
//! square corners of blur showed outside the rounded interface. Windows 11
//! can round the window itself — blur, shadow and all — at its own fixed
//! radius, and the interface then follows that radius. Where it cannot
//! (Windows 10), the interface keeps square corners rather than showing
//! blur outside them.

use std::sync::atomic::{AtomicU8, Ordering};

/// The radius the interface should draw, px. macOS and Linux keep the
/// design's own; Windows replaces it in `apply`.
static RADIUS: AtomicU8 = AtomicU8::new(24);

pub fn radius() -> u8 {
    RADIUS.load(Ordering::Relaxed)
}

#[cfg(windows)]
mod dwm {
    use std::ffi::c_void;

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(hwnd: *mut c_void, attribute: u32, value: *const c_void, size: u32) -> i32;
    }

    const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
    const DWMWA_BORDER_COLOR: u32 = 34;
    const DWMWCP_ROUND: u32 = 2;
    /// No system border: the interface draws its own hairline edge.
    const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;

    fn set(hwnd: *mut c_void, attribute: u32, value: u32) -> bool {
        // SAFETY: `hwnd` is a live top-level window owned by this process and
        // `value` outlives the call; DwmSetWindowAttribute only reads
        // `size` bytes from it.
        let result = unsafe {
            DwmSetWindowAttribute(
                hwnd,
                attribute,
                std::ptr::from_ref(&value).cast::<c_void>(),
                u32::try_from(std::mem::size_of::<u32>()).unwrap_or(4),
            )
        };
        result == 0
    }

    /// Rounds the window; false where the system does not support it.
    pub fn round(hwnd: *mut c_void) -> bool {
        let rounded = set(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND);
        if rounded {
            set(hwnd, DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE);
        }
        rounded
    }
}

/// Rounds the launcher window where the system can, and records the radius
/// the interface should match.
#[cfg(windows)]
pub fn apply(window: &tauri::WebviewWindow) {
    /// What Windows 11 rounds top-level windows to, at 100% scale.
    const WINDOWS_RADIUS: u8 = 8;
    let rounded = window
        .hwnd()
        .map(|hwnd| dwm::round(hwnd.0))
        .unwrap_or(false);
    RADIUS.store(if rounded { WINDOWS_RADIUS } else { 0 }, Ordering::Relaxed);
}

#[cfg(not(windows))]
pub fn apply(_window: &tauri::WebviewWindow) {}
