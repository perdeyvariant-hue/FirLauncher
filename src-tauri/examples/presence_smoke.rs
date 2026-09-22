//! Shows a test Discord status for a while, the way a running game does.
//!
//! ```text
//! cargo run --example presence_smoke -- [seconds]
//! ```

use firlauncher_lib::config::settings::Settings;
use firlauncher_lib::presence::{self, Playing, Presence};

fn main() {
    let seconds: u64 = std::env::args().nth(1).and_then(|s| s.parse().ok()).unwrap_or(20);
    let Some(app_id) = presence::app_id(&Settings::default()) else {
        println!("Нет ID приложения Discord (FIRLAUNCHER_DISCORD_APP_ID)");
        return;
    };
    println!("ID приложения: {app_id}");
    // The same connection the launcher makes, but with errors printed.
    {
        use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
        let mut client = DiscordIpcClient::new(&app_id);
        match client.connect() {
            Ok(()) => {
                let sent = client.set_activity(activity::Activity::new().details("Проверка связи"));
                println!("Подключение к Discord: ок, статус: {}", if sent.is_ok() { "принят" } else { "отклонён" });
                let _ = client.clear_activity();
                let _ = client.close();
            }
            Err(error) => println!("Подключение к Discord не удалось: {error}"),
        }
    }
    let presence = Presence::default();
    presence.play(Playing {
        app_id,
        instance_name: String::from("Проверка FirLauncher"),
        detail: String::from("Minecraft 1.21.1 Fabric"),
        started_at: chrono::Utc::now().timestamp_millis(),
    });
    println!("Статус отправлен, держу {seconds} с…");
    std::thread::sleep(std::time::Duration::from_secs(seconds));
    presence.stop();
    std::thread::sleep(std::time::Duration::from_millis(500));
    println!("Статус снят.");
}
