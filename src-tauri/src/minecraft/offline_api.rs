//! A local stand-in for Mojang's player-services API, for offline accounts.
//!
//! Since 1.16.4 the client asks `api.minecraftservices.com/privileges`
//! whether this account may play online and chat. An offline account has no
//! token, the request fails, and the client greys out "Multiplayer" and
//! "Realms" entirely — so an offline player cannot even reach the server
//! list, let alone a LAN or `online-mode=false` server.
//!
//! The answer is about the *account*, not about any server, so the launcher
//! answers it itself on loopback and points the client at it through
//! `minecraft.api.services.host`. Nothing else changes: the session and
//! authentication hosts stay Mojang's, so a server that verifies its players
//! still rejects an offline one, exactly as before.

use std::net::{Ipv4Addr, SocketAddr};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use crate::error::{LauncherError, Result};

/// Everything allowed; this account is nobody's but the player's own.
const PRIVILEGES: &str = r#"{"privileges":{"onlineChat":{"enabled":true},"multiplayerServer":{"enabled":true},"multiplayerRealms":{"enabled":true},"telemetry":{"enabled":false}}}"#;

/// What 1.19.1 and newer ask for instead, in their own shape.
const ATTRIBUTES: &str = r#"{"privileges":{"onlineChat":{"enabled":true},"multiplayerServer":{"enabled":true},"multiplayerRealms":{"enabled":true},"telemetry":{"enabled":false}},"profanityFilterPreferences":{"profanityFilterOn":false},"banStatus":{"bannedScopes":{}}}"#;

const BLOCKLIST: &str = r#"{"blockedProfiles":[]}"#;

fn response(status: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

/// The body for a path, or `None` for anything this stand-in does not know.
fn answer(path: &str) -> Option<&'static str> {
    // Query strings and API versions are not part of the decision.
    let path = path.split('?').next().unwrap_or(path).trim_end_matches('/');
    match path {
        "/privileges" => Some(PRIVILEGES),
        "/player/attributes" => Some(ATTRIBUTES),
        "/privacy/blocklist" => Some(BLOCKLIST),
        _ => None,
    }
}

async fn serve(mut stream: TcpStream) {
    let mut buffer = [0_u8; 2048];
    let Ok(read) = stream.read(&mut buffer).await else { return };
    let request = String::from_utf8_lossy(&buffer[..read]);
    let path = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("/");

    let reply = match answer(path) {
        Some(body) => response("200 OK", body),
        // A 404 is what the client handles gracefully; anything it does not
        // know about here it simply does without.
        None => response("404 Not Found", "{}"),
    };
    let _ = stream.write_all(reply.as_bytes()).await;
    let _ = stream.flush().await;
}

/// Starts the stand-in on a port the system picks and answers until the
/// launcher exits. Returns the port to point the game at.
pub async fn start() -> Result<u16> {
    let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
        .await
        .map_err(|error| {
            LauncherError::io("Не удалось открыть локальный сервис для оффлайн-аккаунта")
                .with_detail(error.to_string())
        })?;
    let port = listener.local_addr().map(|address| address.port()).map_err(|error| {
        LauncherError::io("Не удалось узнать порт локального сервиса").with_detail(error.to_string())
    })?;

    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            tokio::spawn(serve(stream));
        }
    });
    Ok(port)
}

/// The JVM arguments that send the client to the stand-in. Only the services
/// host moves; authentication, accounts and sessions stay with Mojang.
pub fn jvm_arguments(port: u16) -> Vec<String> {
    let local = format!("http://127.0.0.1:{port}");
    vec![
        String::from("-Dminecraft.api.env=custom"),
        String::from("-Dminecraft.api.auth.host=https://authserver.mojang.com"),
        String::from("-Dminecraft.api.account.host=https://api.mojang.com"),
        String::from("-Dminecraft.api.session.host=https://sessionserver.mojang.com"),
        format!("-Dminecraft.api.services.host={local}"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_paths_the_client_asks_for_are_answered() {
        assert!(answer("/privileges").is_some());
        assert!(answer("/player/attributes").is_some());
        assert!(answer("/privacy/blocklist").is_some());
        // Versions differ in the trailing slash and add query strings.
        assert!(answer("/privileges/").is_some());
        assert!(answer("/player/attributes?v=2").is_some());
        assert!(answer("/player/certificates").is_none());
    }

    #[test]
    fn only_the_services_host_is_taken_over() {
        let args = jvm_arguments(51234);
        assert!(args.iter().any(|a| a == "-Dminecraft.api.services.host=http://127.0.0.1:51234"));
        // A server still checks its players with the real Mojang session API.
        assert!(args
            .iter()
            .any(|a| a == "-Dminecraft.api.session.host=https://sessionserver.mojang.com"));
    }

    #[tokio::test]
    async fn it_answers_the_privileges_question() {
        let port = match start().await {
            Ok(port) => port,
            Err(error) => panic!("start: {error:?}"),
        };
        let mut stream = match TcpStream::connect(("127.0.0.1", port)).await {
            Ok(stream) => stream,
            Err(error) => panic!("connect: {error:?}"),
        };
        let request = "GET /privileges HTTP/1.1\r\nHost: localhost\r\n\r\n";
        if let Err(error) = stream.write_all(request.as_bytes()).await {
            panic!("write: {error:?}");
        }
        let mut reply = String::new();
        if let Err(error) = stream.read_to_string(&mut reply).await {
            panic!("read: {error:?}");
        }
        assert!(reply.starts_with("HTTP/1.1 200 OK"), "{reply}");
        assert!(reply.contains("\"multiplayerServer\":{\"enabled\":true}"), "{reply}");
    }
}
