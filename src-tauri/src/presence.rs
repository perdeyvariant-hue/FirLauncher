//! Discord Rich Presence: "Играет в <сборка> · 1.21.1 Fabric" while the game
//! runs. It needs a Discord application id — built in via
//! `FIRLAUNCHER_DISCORD_APP_ID` or entered in settings — and silently does
//! nothing when Discord is not running.

use std::sync::mpsc::{self, Receiver, Sender};

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};

use crate::config::settings::Settings;

/// The application id baked in at build time, if any.
pub fn builtin_app_id() -> Option<&'static str> {
    option_env!("FIRLAUNCHER_DISCORD_APP_ID")
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

/// The id to use: settings win so a user can point it at their own app.
pub fn app_id(settings: &Settings) -> Option<String> {
    let configured = settings.discord_app_id.trim();
    if !configured.is_empty() {
        return Some(configured.to_owned());
    }
    builtin_app_id().map(str::to_owned)
}

pub struct Playing {
    pub app_id: String,
    pub instance_name: String,
    pub detail: String,
    /// Unix time in milliseconds.
    pub started_at: i64,
}

enum Command {
    Play(Playing),
    Stop,
}

/// Talks to Discord on its own thread: the IPC client is blocking.
pub struct Presence {
    sender: Sender<Command>,
}

impl Default for Presence {
    fn default() -> Self {
        let (sender, receiver) = mpsc::channel();
        std::thread::Builder::new()
            .name(String::from("discord-presence"))
            .spawn(move || run(&receiver))
            .ok();
        Self { sender }
    }
}

impl Presence {
    pub fn play(&self, playing: Playing) {
        let _ = self.sender.send(Command::Play(playing));
    }

    pub fn stop(&self) {
        let _ = self.sender.send(Command::Stop);
    }
}

fn run(receiver: &Receiver<Command>) {
    let mut client: Option<(String, DiscordIpcClient)> = None;
    while let Ok(command) = receiver.recv() {
        match command {
            Command::Play(playing) => {
                // A different application id needs a fresh connection.
                if client.as_ref().is_none_or(|(id, _)| *id != playing.app_id) {
                    if let Some((_, mut old)) = client.take() {
                        let _ = old.close();
                    }
                    let mut fresh = DiscordIpcClient::new(&playing.app_id);
                    // Discord not running: nothing to show, nothing to report.
                    if fresh.connect().is_err() {
                        continue;
                    }
                    client = Some((playing.app_id.clone(), fresh));
                }
                let Some((_, connected)) = client.as_mut() else { continue };
                let activity = activity::Activity::new()
                    .details(playing.instance_name.as_str())
                    .state(playing.detail.as_str())
                    .timestamps(activity::Timestamps::new().start(playing.started_at))
                    .assets(activity::Assets::new().large_image("logo").large_text("FirLauncher"));
                if connected.set_activity(activity).is_err() {
                    // Discord was restarted; reconnect on the next launch.
                    client = None;
                }
            }
            Command::Stop => {
                if let Some((_, connected)) = client.as_mut() {
                    if connected.clear_activity().is_err() {
                        client = None;
                    }
                }
            }
        }
    }
}
