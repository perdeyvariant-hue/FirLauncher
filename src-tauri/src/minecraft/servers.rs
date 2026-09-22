//! The multiplayer server list (`servers.dat`) and the Server List Ping.
//!
//! `servers.dat` is uncompressed NBT. It is read into a generic tag tree and
//! written back from it, so fields this launcher does not know about (newer
//! game versions add some) survive an edit.

use std::io::{Cursor, Read};
use std::path::Path;
use std::time::{Duration, Instant};

use base64::Engine;
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use crate::error::{ErrorKind, LauncherError, Result};

/* ——— NBT ——— */

#[derive(Debug, Clone, PartialEq)]
pub enum Tag {
    Byte(i8),
    Short(i16),
    Int(i32),
    Long(i64),
    Float(f32),
    Double(f64),
    ByteArray(Vec<i8>),
    String(String),
    /// Element type id, elements.
    List(u8, Vec<Tag>),
    Compound(Vec<(String, Tag)>),
    IntArray(Vec<i32>),
    LongArray(Vec<i64>),
}

fn nbt_error(message: &str) -> LauncherError {
    LauncherError::new(ErrorKind::Parse, "servers.dat повреждён").with_detail(message.to_owned())
}

impl Tag {
    fn id(&self) -> u8 {
        match self {
            Tag::Byte(_) => 1,
            Tag::Short(_) => 2,
            Tag::Int(_) => 3,
            Tag::Long(_) => 4,
            Tag::Float(_) => 5,
            Tag::Double(_) => 6,
            Tag::ByteArray(_) => 7,
            Tag::String(_) => 8,
            Tag::List(..) => 9,
            Tag::Compound(_) => 10,
            Tag::IntArray(_) => 11,
            Tag::LongArray(_) => 12,
        }
    }

    pub fn get(&self, key: &str) -> Option<&Tag> {
        match self {
            Tag::Compound(entries) => entries.iter().find(|(name, _)| name == key).map(|(_, tag)| tag),
            _ => None,
        }
    }

    fn as_str(&self) -> Option<&str> {
        match self {
            Tag::String(value) => Some(value),
            _ => None,
        }
    }
}

struct Reader<'a>(Cursor<&'a [u8]>);

impl Reader<'_> {
    fn fixed<const N: usize>(&mut self) -> Result<[u8; N]> {
        let mut buffer = [0_u8; N];
        Read::read_exact(&mut self.0, &mut buffer).map_err(|_| nbt_error("неожиданный конец файла"))?;
        Ok(buffer)
    }
    fn u8(&mut self) -> Result<u8> {
        Ok(self.fixed::<1>()?[0])
    }
    fn i16(&mut self) -> Result<i16> {
        Ok(i16::from_be_bytes(self.fixed()?))
    }
    fn i32(&mut self) -> Result<i32> {
        Ok(i32::from_be_bytes(self.fixed()?))
    }
    fn i64(&mut self) -> Result<i64> {
        Ok(i64::from_be_bytes(self.fixed()?))
    }
    fn len(&mut self) -> Result<usize> {
        usize::try_from(self.i32()?).map_err(|_| nbt_error("отрицательная длина"))
    }
    fn string(&mut self) -> Result<String> {
        let length = usize::from(u16::from_be_bytes(self.fixed()?));
        let mut buffer = vec![0_u8; length];
        Read::read_exact(&mut self.0, &mut buffer).map_err(|_| nbt_error("обрезанная строка"))?;
        // Java's "modified UTF-8" equals UTF-8 for everything a server name
        // or address realistically contains.
        Ok(String::from_utf8_lossy(&buffer).into_owned())
    }
    fn payload(&mut self, id: u8, depth: usize) -> Result<Tag> {
        if depth > 64 {
            return Err(nbt_error("слишком глубокая вложенность"));
        }
        Ok(match id {
            1 => Tag::Byte(i8::from_be_bytes(self.fixed()?)),
            2 => Tag::Short(self.i16()?),
            3 => Tag::Int(self.i32()?),
            4 => Tag::Long(self.i64()?),
            5 => Tag::Float(f32::from_be_bytes(self.fixed()?)),
            6 => Tag::Double(f64::from_be_bytes(self.fixed()?)),
            7 => {
                let length = self.len()?;
                (0..length).map(|_| self.fixed::<1>().map(i8::from_be_bytes)).collect::<Result<_>>().map(Tag::ByteArray)?
            }
            8 => Tag::String(self.string()?),
            9 => {
                let element = self.u8()?;
                let length = self.len()?;
                let items = (0..length).map(|_| self.payload(element, depth + 1)).collect::<Result<_>>()?;
                Tag::List(element, items)
            }
            10 => {
                let mut entries = Vec::new();
                loop {
                    let child = self.u8()?;
                    if child == 0 {
                        break;
                    }
                    let name = self.string()?;
                    entries.push((name, self.payload(child, depth + 1)?));
                }
                Tag::Compound(entries)
            }
            11 => {
                let length = self.len()?;
                (0..length).map(|_| self.i32()).collect::<Result<_>>().map(Tag::IntArray)?
            }
            12 => {
                let length = self.len()?;
                (0..length).map(|_| self.i64()).collect::<Result<_>>().map(Tag::LongArray)?
            }
            other => return Err(nbt_error(&format!("неизвестный тег {other}"))),
        })
    }
}

pub fn read_nbt(bytes: &[u8]) -> Result<Tag> {
    let mut reader = Reader(Cursor::new(bytes));
    if reader.u8()? != 10 {
        return Err(nbt_error("корень не compound"));
    }
    let _root_name = reader.string()?;
    reader.payload(10, 0)
}

fn write_string(out: &mut Vec<u8>, value: &str) {
    let bytes = value.as_bytes();
    let length = u16::try_from(bytes.len()).unwrap_or(u16::MAX);
    out.extend_from_slice(&length.to_be_bytes());
    out.extend_from_slice(&bytes[..usize::from(length)]);
}

fn write_payload(out: &mut Vec<u8>, tag: &Tag) {
    let len = |n: usize| i32::try_from(n).unwrap_or(i32::MAX).to_be_bytes();
    match tag {
        Tag::Byte(v) => out.extend_from_slice(&v.to_be_bytes()),
        Tag::Short(v) => out.extend_from_slice(&v.to_be_bytes()),
        Tag::Int(v) => out.extend_from_slice(&v.to_be_bytes()),
        Tag::Long(v) => out.extend_from_slice(&v.to_be_bytes()),
        Tag::Float(v) => out.extend_from_slice(&v.to_be_bytes()),
        Tag::Double(v) => out.extend_from_slice(&v.to_be_bytes()),
        Tag::ByteArray(values) => {
            out.extend_from_slice(&len(values.len()));
            out.extend(values.iter().map(|v| v.to_be_bytes()[0]));
        }
        Tag::String(value) => write_string(out, value),
        Tag::List(element, items) => {
            out.push(if items.is_empty() { *element } else { items[0].id() });
            out.extend_from_slice(&len(items.len()));
            for item in items {
                write_payload(out, item);
            }
        }
        Tag::Compound(entries) => {
            for (name, child) in entries {
                out.push(child.id());
                write_string(out, name);
                write_payload(out, child);
            }
            out.push(0);
        }
        Tag::IntArray(values) => {
            out.extend_from_slice(&len(values.len()));
            for v in values {
                out.extend_from_slice(&v.to_be_bytes());
            }
        }
        Tag::LongArray(values) => {
            out.extend_from_slice(&len(values.len()));
            for v in values {
                out.extend_from_slice(&v.to_be_bytes());
            }
        }
    }
}

pub fn write_nbt(root: &Tag) -> Vec<u8> {
    let mut out = vec![10];
    write_string(&mut out, "");
    write_payload(&mut out, root);
    out
}

/* ——— servers.dat ——— */

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServerEntry {
    pub name: String,
    pub address: String,
    /// The icon the game cached, as a data URL.
    pub icon: Option<String>,
}

fn servers_of(root: &Tag) -> Vec<Tag> {
    match root.get("servers") {
        Some(Tag::List(_, items)) => items.clone(),
        _ => Vec::new(),
    }
}

pub async fn load(path: &Path) -> Result<(Tag, Vec<ServerEntry>)> {
    let root = match tokio::fs::read(path).await {
        Ok(bytes) => read_nbt(&bytes)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Tag::Compound(Vec::new()),
        Err(error) => return Err(LauncherError::io("Не удалось прочитать servers.dat").with_detail(error.to_string())),
    };
    let entries = servers_of(&root)
        .iter()
        .map(|server| ServerEntry {
            name: server.get("name").and_then(Tag::as_str).unwrap_or("Сервер Minecraft").to_owned(),
            address: server.get("ip").and_then(Tag::as_str).unwrap_or_default().to_owned(),
            icon: server
                .get("icon")
                .and_then(Tag::as_str)
                .filter(|icon| !icon.is_empty())
                .map(|icon| format!("data:image/png;base64,{icon}")),
        })
        .collect();
    Ok((root, entries))
}

async fn save(path: &Path, mut root: Tag, servers: Vec<Tag>) -> Result<()> {
    if let Tag::Compound(entries) = &mut root {
        entries.retain(|(name, _)| name != "servers");
        entries.push((String::from("servers"), Tag::List(10, servers)));
    }
    let tmp = path.with_extension("dat.part");
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::write(&tmp, write_nbt(&root)).await?;
    tokio::fs::rename(&tmp, path).await?;
    Ok(())
}

pub async fn add(path: &Path, name: &str, address: &str) -> Result<()> {
    let (root, _) = load(path).await?;
    let mut servers = servers_of(&root);
    servers.push(Tag::Compound(vec![
        (String::from("name"), Tag::String(name.to_owned())),
        (String::from("ip"), Tag::String(address.to_owned())),
    ]));
    save(path, root, servers).await
}

pub async fn remove(path: &Path, index: usize) -> Result<()> {
    let (root, _) = load(path).await?;
    let mut servers = servers_of(&root);
    if index >= servers.len() {
        return Err(LauncherError::new(ErrorKind::Instance, "Такого сервера нет в списке"));
    }
    servers.remove(index);
    save(path, root, servers).await
}

/* ——— Server List Ping ——— */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub online: u32,
    pub max: u32,
    pub version: String,
    /// The message of the day with formatting codes removed.
    pub motd: String,
    pub latency_ms: u32,
    pub favicon: Option<String>,
}

/// `host`, `host:port`, `[v6]:port`. `None` for the port means "look up SRV".
pub fn split_address(address: &str) -> (String, Option<u16>) {
    let address = address.trim();
    if let Some(rest) = address.strip_prefix('[') {
        if let Some((host, port)) = rest.split_once("]:") {
            return (host.to_owned(), port.parse().ok());
        }
        return (rest.trim_end_matches(']').to_owned(), None);
    }
    match address.rsplit_once(':') {
        Some((host, port)) if !host.contains(':') => (host.to_owned(), port.parse().ok()),
        _ => (address.to_owned(), None),
    }
}

/// Where to actually connect: an explicit port wins, otherwise the SRV
/// record `_minecraft._tcp.<host>`, otherwise 25565.
async fn resolve(address: &str) -> (String, u16) {
    let (host, port) = split_address(address);
    if let Some(port) = port {
        return (host, port);
    }
    if let Ok(resolver) = hickory_resolver::Resolver::builder_tokio().map(|builder| builder.build()) {
        // A slow or filtering DNS must not eat the whole ping budget.
        let lookup = resolver.srv_lookup(format!("_minecraft._tcp.{host}."));
        if let Ok(Ok(records)) = tokio::time::timeout(Duration::from_secs(2), lookup).await {
            if let Some(record) = records.iter().next() {
                return (record.target().to_utf8().trim_end_matches('.').to_owned(), record.port());
            }
        }
    }
    (host, 25565)
}

fn write_varint(out: &mut Vec<u8>, value: i32) {
    let mut value = value as u32;
    loop {
        if value & !0x7F == 0 {
            out.push(value as u8);
            return;
        }
        out.push(((value & 0x7F) | 0x80) as u8);
        value >>= 7;
    }
}

async fn read_varint(stream: &mut TcpStream) -> Result<i32> {
    let mut value: u32 = 0;
    for shift in 0..5 {
        let byte = stream.read_u8().await.map_err(|error| ping_error(&error))?;
        value |= u32::from(byte & 0x7F) << (7 * shift);
        if byte & 0x80 == 0 {
            return Ok(value as i32);
        }
    }
    Err(LauncherError::new(ErrorKind::Http, "Сервер ответил неверно"))
}

fn ping_error(error: &std::io::Error) -> LauncherError {
    LauncherError::new(ErrorKind::Http, "Сервер не отвечает").with_detail(error.to_string()).retryable(true)
}

fn packet(id: i32, body: &[u8]) -> Vec<u8> {
    let mut inner = Vec::new();
    write_varint(&mut inner, id);
    inner.extend_from_slice(body);
    let mut out = Vec::new();
    write_varint(&mut out, i32::try_from(inner.len()).unwrap_or(i32::MAX));
    out.extend(inner);
    out
}

/// Flattens a chat component (string or object with text/extra) and drops
/// `§` formatting codes.
pub fn plain_text(value: &serde_json::Value) -> String {
    fn walk(value: &serde_json::Value, out: &mut String) {
        match value {
            serde_json::Value::String(text) => out.push_str(text),
            serde_json::Value::Array(items) => items.iter().for_each(|item| walk(item, out)),
            serde_json::Value::Object(map) => {
                if let Some(text) = map.get("text") {
                    walk(text, out);
                }
                if let Some(extra) = map.get("extra") {
                    walk(extra, out);
                }
            }
            _ => {}
        }
    }
    let mut raw = String::new();
    walk(value, &mut raw);
    let mut clean = String::with_capacity(raw.len());
    let mut chars = raw.chars();
    while let Some(c) = chars.next() {
        if c == '§' {
            chars.next();
        } else {
            clean.push(c);
        }
    }
    clean.trim().to_owned()
}

async fn exchange(address: &str) -> Result<ServerStatus> {
    let (host, port) = resolve(address).await;
    let started = Instant::now();
    let mut stream = TcpStream::connect((host.as_str(), port)).await.map_err(|error| ping_error(&error))?;
    let connect_ms = started.elapsed().as_millis();

    let mut handshake = Vec::new();
    write_varint(&mut handshake, -1); // "any protocol": status works regardless
    let host_bytes = host.as_bytes();
    write_varint(&mut handshake, i32::try_from(host_bytes.len()).unwrap_or(0));
    handshake.extend_from_slice(host_bytes);
    handshake.extend_from_slice(&port.to_be_bytes());
    write_varint(&mut handshake, 1);
    stream.write_all(&packet(0, &handshake)).await.map_err(|error| ping_error(&error))?;
    stream.write_all(&packet(0, &[])).await.map_err(|error| ping_error(&error))?;

    let length = read_varint(&mut stream).await?;
    if !(1..=1 << 21).contains(&length) {
        return Err(LauncherError::new(ErrorKind::Http, "Сервер ответил неверно"));
    }
    let _packet_id = read_varint(&mut stream).await?;
    let text_length = usize::try_from(read_varint(&mut stream).await?).unwrap_or(0);
    let mut buffer = vec![0_u8; text_length.min(1 << 21)];
    stream.read_exact(&mut buffer).await.map_err(|error| ping_error(&error))?;
    let json: serde_json::Value = serde_json::from_slice(&buffer)
        .map_err(|error| LauncherError::new(ErrorKind::Parse, "Сервер ответил неверно").with_detail(error.to_string()))?;

    let count = |key: &str| {
        json.get("players")
            .and_then(|players| players.get(key))
            .and_then(serde_json::Value::as_u64)
            .and_then(|value| u32::try_from(value).ok())
            .unwrap_or(0)
    };
    Ok(ServerStatus {
        online: count("online"),
        max: count("max"),
        version: json
            .get("version")
            .and_then(|version| version.get("name"))
            .and_then(serde_json::Value::as_str)
            .map(|name| plain_text(&serde_json::Value::String(name.to_owned())))
            .unwrap_or_default(),
        motd: json.get("description").map(plain_text).unwrap_or_default(),
        latency_ms: u32::try_from(connect_ms).unwrap_or(u32::MAX),
        favicon: json
            .get("favicon")
            .and_then(serde_json::Value::as_str)
            .filter(|icon| icon.starts_with("data:image/png;base64,"))
            // Validate the payload so the webview is only handed an image.
            .filter(|icon| {
                base64::engine::general_purpose::STANDARD
                    .decode(icon.trim_start_matches("data:image/png;base64,"))
                    .is_ok_and(|bytes| bytes.starts_with(b"\x89PNG"))
            })
            .map(str::to_owned),
    })
}

pub async fn ping(address: &str) -> Result<ServerStatus> {
    tokio::time::timeout(Duration::from_secs(6), exchange(address))
        .await
        .map_err(|_| LauncherError::new(ErrorKind::Http, "Сервер не ответил за 6 секунд").retryable(true))?
}

/// The game arguments that join a server on start: Quick Play where the
/// version supports it (1.20+), the old `--server/--port` elsewhere.
pub fn join_arguments(address: &str, quick_play: bool) -> Vec<String> {
    let (host, port) = split_address(address);
    if quick_play {
        let target = match port {
            Some(port) => format!("{host}:{port}"),
            None => host,
        };
        vec![String::from("--quickPlayMultiplayer"), target]
    } else {
        vec![
            String::from("--server"),
            host,
            String::from("--port"),
            port.unwrap_or(25565).to_string(),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nbt_round_trips_unknown_fields() -> Result<()> {
        let root = Tag::Compound(vec![
            (String::from("servers"), Tag::List(10, vec![Tag::Compound(vec![
                (String::from("name"), Tag::String(String::from("Мой сервер"))),
                (String::from("ip"), Tag::String(String::from("play.example.net:25570"))),
                (String::from("acceptTextures"), Tag::Byte(1)),
                (String::from("future"), Tag::LongArray(vec![1, -2])),
            ])])),
        ]);
        let bytes = write_nbt(&root);
        assert_eq!(read_nbt(&bytes)?, root);
        Ok(())
    }

    #[tokio::test]
    async fn servers_can_be_added_and_removed() -> Result<()> {
        let dir = std::env::temp_dir().join(format!("fir-servers-{}", std::process::id()));
        let path = dir.join("servers.dat");
        let _ = tokio::fs::remove_dir_all(&dir).await;
        add(&path, "A", "a.example").await?;
        add(&path, "B", "b.example:25566").await?;
        let (_, list) = load(&path).await?;
        assert_eq!(list.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), vec!["A", "B"]);
        remove(&path, 0).await?;
        let (_, list) = load(&path).await?;
        assert_eq!(list[0].address, "b.example:25566");
        let _ = tokio::fs::remove_dir_all(&dir).await;
        Ok(())
    }

    #[test]
    fn addresses_are_split() {
        assert_eq!(split_address("mc.example.net"), (String::from("mc.example.net"), None));
        assert_eq!(split_address("mc.example.net:25570"), (String::from("mc.example.net"), Some(25570)));
        assert_eq!(split_address("[::1]:25565"), (String::from("::1"), Some(25565)));
        assert_eq!(join_arguments("h:1", true), vec!["--quickPlayMultiplayer", "h:1"]);
        assert_eq!(join_arguments("h", false), vec!["--server", "h", "--port", "25565"]);
    }

    #[test]
    fn motd_components_become_plain_text() {
        let motd = serde_json::json!({"text": "§aHello ", "extra": [{"text": "§lworld"}, "!"]});
        assert_eq!(plain_text(&motd), "Hello world!");
    }
}
