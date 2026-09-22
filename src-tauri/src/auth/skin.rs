//! Rendering an account's head from its skin, the way the game does.
//!
//! Cropping the face in CSS is not enough: legacy 64x32 skins often fill the
//! hat region with a solid colour, and the client treats such a fully opaque
//! hat as absent ("Notch transparency"). Drawing it naively paints a black
//! square over the face. So the head is composed here, once, and stored as a
//! tiny data URL — which also means the webview never fetches textures.

use base64::Engine;

use crate::error::{ErrorKind, LauncherError, Result};

const ALPHA_THRESHOLD: u8 = 128;

/// An RGBA8 image.
struct Rgba {
    width: u32,
    height: u32,
    pixels: Vec<u8>,
}

impl Rgba {
    fn pixel(&self, x: u32, y: u32) -> [u8; 4] {
        let index = ((y * self.width + x) * 4) as usize;
        [
            self.pixels[index],
            self.pixels[index + 1],
            self.pixels[index + 2],
            self.pixels[index + 3],
        ]
    }
}

fn decode_error(error: impl std::fmt::Display) -> LauncherError {
    LauncherError::new(ErrorKind::Parse, "Не удалось прочитать скин").with_detail(error.to_string())
}

/// Decodes any PNG colour type into RGBA8.
fn decode(bytes: &[u8]) -> Result<Rgba> {
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = decoder.read_info().map_err(decode_error)?;

    let size = reader
        .output_buffer_size()
        .ok_or_else(|| decode_error("изображение слишком большое"))?;
    let mut buffer = vec![0_u8; size];
    let info = reader.next_frame(&mut buffer).map_err(decode_error)?;
    buffer.truncate(info.buffer_size());

    let pixels = match info.color_type {
        png::ColorType::Rgba => buffer,
        png::ColorType::Rgb => buffer
            .chunks_exact(3)
            .flat_map(|p| [p[0], p[1], p[2], 255])
            .collect(),
        png::ColorType::GrayscaleAlpha => buffer
            .chunks_exact(2)
            .flat_map(|p| [p[0], p[0], p[0], p[1]])
            .collect(),
        png::ColorType::Grayscale => buffer.iter().flat_map(|&g| [g, g, g, 255]).collect(),
        png::ColorType::Indexed => {
            return Err(decode_error("палитра не развернулась"));
        }
    };

    Ok(Rgba {
        width: info.width,
        height: info.height,
        pixels,
    })
}

fn encode(width: u32, height: u32, pixels: &[u8]) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(decode_error)?;
        writer.write_image_data(pixels).map_err(decode_error)?;
    }
    Ok(out)
}

/// Composes the head (face + hat overlay) from a skin PNG and returns it as a
/// PNG at the skin's native resolution (8x8 for standard skins).
pub fn render_head(skin_png: &[u8]) -> Result<Vec<u8>> {
    let skin = decode(skin_png)?;
    // Standard skins are 64x64 or legacy 64x32; HD skins are integer multiples.
    let (scale, legacy) = layout(&skin)?;

    let side = 8 * scale;
    let (face_x, hat_x, top) = (8 * scale, 40 * scale, 8 * scale);

    // The client's rule for legacy skins: a hat region with no translucent
    // pixel at all is treated as absent rather than drawn as a solid block.
    let hat_is_real = !legacy
        || (0..side).any(|y| {
            (0..side).any(|x| skin.pixel(hat_x + x, top + y)[3] < ALPHA_THRESHOLD)
        });

    let mut pixels = Vec::with_capacity((side * side * 4) as usize);
    for y in 0..side {
        for x in 0..side {
            // The face base layer is always drawn fully opaque.
            let face = skin.pixel(face_x + x, top + y);
            let mut out = [face[0], face[1], face[2], 255];

            if hat_is_real {
                let hat = skin.pixel(hat_x + x, top + y);
                let alpha = u16::from(hat[3]);
                for channel in 0..3 {
                    let blended = (u16::from(hat[channel]) * alpha
                        + u16::from(out[channel]) * (255 - alpha))
                        / 255;
                    out[channel] = u8::try_from(blended).unwrap_or(u8::MAX);
                }
            }
            pixels.extend_from_slice(&out);
        }
    }

    encode(side, side, &pixels)
}

/// Checks the size of a skin and returns its scale (1 for 64 px wide skins)
/// and whether it is the legacy 64x32 layout.
fn layout(skin: &Rgba) -> Result<(u32, bool)> {
    let scale = skin.width / 64;
    let legacy = skin.height * 2 == skin.width;
    if scale == 0 || skin.width % 64 != 0 || !(legacy || skin.height == skin.width) {
        return Err(decode_error(format!(
            "неожиданный размер скина {}x{}",
            skin.width, skin.height
        )));
    }
    Ok((scale, legacy))
}

/// Slim ("Alex") arms are three pixels wide: the fourth column of the right
/// arm's back face stays empty. Legacy skins predate slim arms.
fn is_slim(skin: &Rgba, scale: u32, legacy: bool) -> bool {
    !legacy
        && (20 * scale..32 * scale)
            .all(|y| (54 * scale..56 * scale).all(|x| skin.pixel(x, y)[3] == 0))
}

/// One rectangle copied from the skin onto the canvas.
struct Part {
    /// Source rectangle in skin pixels (unscaled).
    src: (u32, u32, u32, u32),
    /// Destination top-left on the 16x32 figure (unscaled).
    dst: (u32, u32),
    mirror: bool,
    overlay: bool,
}

/// Renders the front view of the whole player (16x32 at the skin's scale):
/// head, body, arms and legs with their outer layer, the way the skin shows
/// on the title screen. Legacy skins mirror the right limbs, as the game does.
pub fn render_body(skin_png: &[u8]) -> Result<Vec<u8>> {
    let skin = decode(skin_png)?;
    let (scale, legacy) = layout(&skin)?;
    let arm = if is_slim(&skin, scale, legacy) { 3 } else { 4 };

    let part = |src, dst, mirror, overlay| Part { src, dst, mirror, overlay };
    let mut parts = vec![
        part((8, 8, 8, 8), (4, 0), false, false),
        part((20, 20, 8, 12), (4, 8), false, false),
        part((44, 20, arm, 12), (4 - arm, 8), false, false),
        part((4, 20, 4, 12), (4, 20), false, false),
    ];
    if legacy {
        parts.push(part((44, 20, arm, 12), (12, 8), true, false));
        parts.push(part((4, 20, 4, 12), (8, 20), true, false));
    } else {
        parts.push(part((36, 52, arm, 12), (12, 8), false, false));
        parts.push(part((20, 52, 4, 12), (8, 20), false, false));
        parts.push(part((20, 36, 8, 12), (4, 8), false, true));
        parts.push(part((44, 36, arm, 12), (4 - arm, 8), false, true));
        parts.push(part((52, 52, arm, 12), (12, 8), false, true));
        parts.push(part((4, 36, 4, 12), (4, 20), false, true));
        parts.push(part((4, 52, 4, 12), (8, 20), false, true));
    }

    let (width, height) = (16 * scale, 32 * scale);
    let mut canvas = vec![0_u8; (width * height * 4) as usize];
    let mut blend = |x: u32, y: u32, color: [u8; 4], opaque: bool| {
        let index = ((y * width + x) * 4) as usize;
        let alpha = if opaque { 255 } else { u16::from(color[3]) };
        if alpha == 0 {
            return;
        }
        for channel in 0..3 {
            let under = u16::from(canvas[index + channel]);
            let blended = (u16::from(color[channel]) * alpha + under * (255 - alpha)) / 255;
            canvas[index + channel] = u8::try_from(blended).unwrap_or(u8::MAX);
        }
        canvas[index + 3] = canvas[index + 3].max(u8::try_from(alpha).unwrap_or(u8::MAX));
    };

    for piece in &parts {
        let (sx, sy, sw, sh) = piece.src;
        for y in 0..sh * scale {
            for x in 0..sw * scale {
                let from_x = if piece.mirror { sw * scale - 1 - x } else { x };
                let color = skin.pixel(sx * scale + from_x, sy * scale + y);
                // Base layers are opaque in game; only overlays blend.
                blend(piece.dst.0 * scale + x, piece.dst.1 * scale + y, color, !piece.overlay);
            }
        }
    }

    // The hat goes on last, under the same rule as `render_head`.
    let side = 8 * scale;
    let hat_is_real = !legacy
        || (0..side).any(|y| (0..side).any(|x| skin.pixel(40 * scale + x, 8 * scale + y)[3] < ALPHA_THRESHOLD));
    if hat_is_real {
        for y in 0..side {
            for x in 0..side {
                let color = skin.pixel(40 * scale + x, 8 * scale + y);
                blend(4 * scale + x, y, color, false);
            }
        }
    }

    encode(width, height, &canvas)
}

/// Downloads a skin and returns the whole figure as a `data:` URL.
pub async fn fetch_body(client: &reqwest::Client, skin_url: &str) -> Option<String> {
    let response = client.get(skin_url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let bytes = response.bytes().await.ok()?;
    let body = render_body(&bytes).ok()?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(body);
    Some(format!("data:image/png;base64,{encoded}"))
}

/// Downloads a skin and returns its head as a `data:` URL. Best effort: a
/// missing or odd skin must never fail a sign-in, so errors become `None`.
pub async fn fetch_head(client: &reqwest::Client, skin_url: &str) -> Option<String> {
    let response = client.get(skin_url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let bytes = response.bytes().await.ok()?;
    let head = render_head(&bytes).ok()?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(head);
    Some(format!("data:image/png;base64,{encoded}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const RED: [u8; 4] = [200, 30, 30, 255];
    const BLACK: [u8; 4] = [0, 0, 0, 255];
    const CLEAR: [u8; 4] = [0, 0, 0, 0];
    const BLUE: [u8; 4] = [20, 40, 220, 255];

    /// Builds a skin with a uniform face and a hat painted by `hat(x, y)`.
    fn skin(height: u32, hat: impl Fn(u32, u32) -> [u8; 4]) -> Vec<u8> {
        let width = 64;
        let mut pixels = vec![0_u8; (width * height * 4) as usize];
        let mut put = |x: u32, y: u32, color: [u8; 4]| {
            let index = ((y * width + x) * 4) as usize;
            pixels[index..index + 4].copy_from_slice(&color);
        };
        for y in 0..8 {
            for x in 0..8 {
                put(8 + x, 8 + y, RED);
                put(40 + x, 8 + y, hat(x, y));
            }
        }
        match encode(width, height, &pixels) {
            Ok(bytes) => bytes,
            Err(error) => panic!("encode: {error}"),
        }
    }

    fn head_pixels(png: &[u8]) -> Rgba {
        match decode(png) {
            Ok(image) => image,
            Err(error) => panic!("decode: {error}"),
        }
    }

    #[test]
    fn a_solid_legacy_hat_is_ignored() -> Result<()> {
        // Exactly the case that painted a black square over the face.
        let head = head_pixels(&render_head(&skin(32, |_, _| BLACK))?);
        assert_eq!((head.width, head.height), (8, 8));
        assert_eq!(head.pixel(3, 3), RED);
        Ok(())
    }

    #[test]
    fn a_legacy_hat_with_transparency_is_drawn() -> Result<()> {
        // A hat covering only the top row: the rest must show the face.
        let head = head_pixels(&render_head(&skin(32, |_, y| if y == 0 { BLUE } else { CLEAR }))?);
        assert_eq!(head.pixel(0, 0), BLUE);
        assert_eq!(head.pixel(0, 5), RED);
        Ok(())
    }

    #[test]
    fn modern_skins_always_use_their_hat_layer() -> Result<()> {
        // In 64x64 skins even a fully opaque hat is intentional.
        let head = head_pixels(&render_head(&skin(64, |_, _| BLUE))?);
        assert_eq!(head.pixel(4, 4), BLUE);
        Ok(())
    }

    #[test]
    fn the_face_is_always_opaque() -> Result<()> {
        let head = head_pixels(&render_head(&skin(64, |_, _| CLEAR))?);
        assert_eq!(head.pixel(1, 1)[3], 255);
        Ok(())
    }

    const GREEN: [u8; 4] = [30, 180, 60, 255];
    const WHITE: [u8; 4] = [240, 240, 240, 255];

    /// A skin with each body part painted one colour; `slim` leaves the
    /// fourth column of the right arm empty, as slim skins do.
    fn figure(height: u32, slim: bool) -> Vec<u8> {
        let width = 64;
        let mut pixels = vec![0_u8; (width * height * 4) as usize];
        let mut fill = |x0: u32, y0: u32, w: u32, h: u32, color: [u8; 4]| {
            for y in y0..y0 + h {
                for x in x0..x0 + w {
                    let index = ((y * width + x) * 4) as usize;
                    pixels[index..index + 4].copy_from_slice(&color);
                }
            }
        };
        fill(8, 8, 8, 8, RED); // face
        fill(20, 20, 8, 12, BLUE); // body front
        fill(40, 20, if slim { 14 } else { 16 }, 12, GREEN); // right arm, all faces
        fill(4, 20, 4, 12, WHITE); // right leg front
        if height == 64 {
            fill(36, 52, 4, 12, BLACK); // left arm front
            fill(20, 52, 4, 12, BLACK); // left leg front
        }
        match encode(width, height, &pixels) {
            Ok(bytes) => bytes,
            Err(error) => panic!("encode: {error}"),
        }
    }

    #[test]
    fn the_whole_figure_is_laid_out_front_on() -> Result<()> {
        let body = head_pixels(&render_body(&figure(64, false))?);
        assert_eq!((body.width, body.height), (16, 32));
        assert_eq!(body.pixel(8, 4), RED, "head");
        assert_eq!(body.pixel(8, 12), BLUE, "body");
        assert_eq!(body.pixel(0, 12), GREEN, "right arm, full width");
        assert_eq!(body.pixel(14, 12), BLACK, "left arm from its own texture");
        assert_eq!(body.pixel(5, 25), WHITE, "right leg");
        assert_eq!(body.pixel(10, 25), BLACK, "left leg");
        assert_eq!(body.pixel(0, 0)[3], 0, "outside the figure stays clear");
        Ok(())
    }

    #[test]
    fn slim_arms_hug_the_body() -> Result<()> {
        let body = head_pixels(&render_body(&figure(64, true))?);
        assert_eq!(body.pixel(0, 12)[3], 0, "a slim arm is one pixel narrower");
        assert_eq!(body.pixel(1, 12), GREEN);
        Ok(())
    }

    #[test]
    fn legacy_skins_mirror_the_right_limbs() -> Result<()> {
        let body = head_pixels(&render_body(&figure(32, false))?);
        assert_eq!(body.pixel(14, 12), GREEN, "left arm copied from the right");
        assert_eq!(body.pixel(10, 25), WHITE, "left leg copied from the right");
        Ok(())
    }

    #[test]
    fn odd_sizes_and_garbage_are_rejected() {
        assert!(render_head(b"not a png").is_err());
        let odd = match encode(10, 10, &[0_u8; 400]) {
            Ok(bytes) => bytes,
            Err(error) => panic!("encode: {error}"),
        };
        assert!(render_head(&odd).is_err());
    }
}

