//! Rounded window corners.
//!
//! The window is transparent and the interface draws its own rounded edge,
//! so the corners outside that edge must stay empty. On Windows two system
//! layers got in the way: the acrylic blur fills the whole rectangle, and
//! the frame of an undecorated window adds a light border and a shadow with
//! square corners. The system can round a window only at its own small
//! radius, and giving the window a custom shape makes Windows fall back to
//! drawing a classic frame over the interface. So the launcher turns those
//! layers off and lets the interface draw the corners itself, at any radius
//! and anti-aliased. The one cost: what shows through the window when it is
//! see-through is not blurred.

/// The radius the interface draws, px.
const RADIUS: u8 = 24;

/// How the window frames the interface, for the frontend to match.
#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub radius: u8,
    /// Whether the system blurs what shows through the window. Without it a
    /// see-through window shows the desktop sharp, which reads as noise.
    pub blur: bool,
}

pub fn frame() -> Frame {
    // Only macOS blurs a see-through window; Windows lost its acrylic above,
    // and Linux compositors vary too much to count on.
    Frame { radius: RADIUS, blur: cfg!(target_os = "macos") }
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
    /// The interface rounds itself; the system's own corners would show.
    const DWMWCP_DONOTROUND: u32 = 1;
    const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;

    fn set(hwnd: *mut c_void, attribute: u32, value: u32) {
        // SAFETY: `hwnd` is a live top-level window owned by this process and
        // `value` outlives the call, which only reads `size` bytes from it.
        // Windows 10 rejects these attributes; that is harmless.
        unsafe {
            DwmSetWindowAttribute(
                hwnd,
                attribute,
                std::ptr::from_ref(&value).cast::<c_void>(),
                u32::try_from(std::mem::size_of::<u32>()).unwrap_or(4),
            );
        }
    }

    pub fn plain(hwnd: *mut c_void) {
        set(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND);
        set(hwnd, DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE);
    }
}

/// Clears the system's frame, border, shadow and blur from the launcher
/// window so only the interface's own rounded edge is seen.
#[cfg(windows)]
pub fn apply(window: &tauri::WebviewWindow) {
    let _ = window.set_shadow(false);
    let _ = window.set_effects(None);
    if let Ok(hwnd) = window.hwnd() {
        dwm::plain(hwnd.0);
    }
}

#[cfg(not(windows))]
pub fn apply(_window: &tauri::WebviewWindow) {}
