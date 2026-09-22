//! Pings real servers the way the Servers tab does.
//!
//! ```text
//! cargo run --example servers_smoke -- [address ...]
//! ```

use firlauncher_lib::minecraft::servers;

#[tokio::main]
async fn main() {
    let mut addresses: Vec<String> = std::env::args().skip(1).collect();
    if addresses.is_empty() {
        addresses = ["mc.hypixel.net", "play.cubecraft.net", "2b2t.org", "no-such-server.invalid"]
            .map(String::from)
            .to_vec();
    }
    for address in addresses {
        match servers::ping(&address).await {
            Ok(status) => println!(
                "{address}: {}/{} игроков, {}, {} мс, иконка: {}\n    «{}»",
                status.online,
                status.max,
                status.version,
                status.latency_ms,
                status.favicon.is_some(),
                status.motd.replace('\n', " / ")
            ),
            Err(error) => println!("{address}: {} ({})", error.message, error.detail.unwrap_or_default()),
        }
    }
}
