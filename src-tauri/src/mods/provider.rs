//! The provider abstraction and the HTTP etiquette every provider shares:
//! a token-bucket rate limit, honouring 429 back-off hints, and retries on
//! transient failures.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::time::{Duration, Instant};

use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::error::{ErrorKind, LauncherError, Result};
use crate::net::retry::network_error;

use super::{
    Category, ModVersion, ProjectDetails, ProjectKind, ProviderId, SearchQuery, SearchResult,
    Target,
};

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// One mod source. Methods return boxed futures so the trait stays usable
/// as `dyn ModProvider`.
pub trait ModProvider: Send + Sync {
    fn id(&self) -> ProviderId;

    fn search<'a>(&'a self, query: &'a SearchQuery) -> BoxFuture<'a, Result<SearchResult>>;

    fn categories(&self, kind: ProjectKind) -> BoxFuture<'_, Result<Vec<Category>>>;

    /// The full description page of a project: body, gallery, links.
    fn details<'a>(&'a self, project_id: &'a str) -> BoxFuture<'a, Result<ProjectDetails>>;

    /// Versions of a project that fit the target, newest first.
    fn versions<'a>(
        &'a self,
        project_id: &'a str,
        target: &'a Target,
    ) -> BoxFuture<'a, Result<Vec<ModVersion>>>;

    /// One specific version (CurseForge needs the project to address a file).
    fn version<'a>(
        &'a self,
        project_id: &'a str,
        version_id: &'a str,
    ) -> BoxFuture<'a, Result<ModVersion>>;

    /// Display names for projects, keyed by id.
    fn project_names<'a>(&'a self, ids: &'a [String])
        -> BoxFuture<'a, Result<HashMap<String, String>>>;

    /// The versions installed files belong to, keyed by the file's SHA1.
    /// Providers that cannot identify by SHA1 return an empty map.
    fn identify<'a>(&'a self, sha1s: &'a [String])
        -> BoxFuture<'a, Result<HashMap<String, ModVersion>>>;

    /// The newest version that fits the target for each identified file,
    /// keyed by the current file's SHA1.
    fn latest_for<'a>(
        &'a self,
        sha1s: &'a [String],
        target: &'a Target,
    ) -> BoxFuture<'a, Result<HashMap<String, ModVersion>>>;
}

/// Token bucket: `burst` requests at once, refilled at `per_second`.
pub struct RateLimiter {
    per_second: f64,
    burst: f64,
    state: tokio::sync::Mutex<(f64, Instant)>,
}

impl RateLimiter {
    pub fn new(per_second: f64, burst: f64) -> Self {
        Self {
            per_second,
            burst,
            state: tokio::sync::Mutex::new((burst, Instant::now())),
        }
    }

    pub async fn acquire(&self) {
        loop {
            let wait = {
                let mut state = self.state.lock().await;
                let now = Instant::now();
                let refilled =
                    (state.0 + now.duration_since(state.1).as_secs_f64() * self.per_second)
                        .min(self.burst);
                state.1 = now;
                if refilled >= 1.0 {
                    state.0 = refilled - 1.0;
                    return;
                }
                state.0 = refilled;
                Duration::from_secs_f64((1.0 - refilled) / self.per_second)
            };
            tokio::time::sleep(wait).await;
        }
    }
}

/// How long the server asked us to wait, from `Retry-After` or Modrinth's
/// `X-Ratelimit-Reset` (both in seconds), bounded to something sane.
pub fn backoff_hint(headers: &reqwest::header::HeaderMap) -> Duration {
    let seconds = ["retry-after", "x-ratelimit-reset"]
        .iter()
        .find_map(|name| {
            headers
                .get(*name)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.trim().parse::<u64>().ok())
        })
        .unwrap_or(5);
    Duration::from_secs(seconds.clamp(1, 60))
}

const MAX_ATTEMPTS: u32 = 5;

/// A provider's HTTP access: shared client, its rate limit, optional API key.
pub struct Http {
    pub client: reqwest::Client,
    pub limiter: &'static RateLimiter,
    pub api_key: Option<(&'static str, String)>,
    pub name: &'static str,
}

impl Http {
    async fn send<F>(&self, build: F) -> Result<reqwest::Response>
    where
        F: Fn(&reqwest::Client) -> reqwest::RequestBuilder,
    {
        let mut attempt = 0;
        loop {
            attempt += 1;
            self.limiter.acquire().await;

            let mut request = build(&self.client);
            if let Some((header, key)) = &self.api_key {
                request = request.header(*header, key);
            }

            let response = match request.send().await {
                Ok(response) => response,
                Err(error) if attempt < MAX_ATTEMPTS => {
                    let _ = error;
                    tokio::time::sleep(Duration::from_millis(400 * u64::from(attempt))).await;
                    continue;
                }
                Err(error) => {
                    return Err(network_error(&format!("{} недоступен", self.name), &error))
                }
            };

            let status = response.status();
            if status == reqwest::StatusCode::TOO_MANY_REQUESTS && attempt < MAX_ATTEMPTS {
                // The server told us exactly how long to back off; listen.
                tokio::time::sleep(backoff_hint(response.headers())).await;
                continue;
            }
            if status.is_server_error() && attempt < MAX_ATTEMPTS {
                tokio::time::sleep(Duration::from_millis(600 * u64::from(attempt))).await;
                continue;
            }
            if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
                let message = if self.api_key.is_some() {
                    format!("{} отклонил ключ API — проверьте его в настройках", self.name)
                } else {
                    format!("{} отказал в доступе", self.name)
                };
                return Err(LauncherError::new(ErrorKind::Provider, message)
                    .with_detail(format!("HTTP {status}")));
            }
            if !status.is_success() {
                let body = response.text().await.unwrap_or_default();
                let preview: String = body.chars().take(300).collect();
                return Err(LauncherError::new(
                    ErrorKind::Http,
                    format!("{} ответил {status}", self.name),
                )
                .with_detail(preview)
                .retryable(status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error()));
            }
            return Ok(response);
        }
    }

    async fn decode<T: DeserializeOwned>(&self, response: reqwest::Response) -> Result<T> {
        let bytes = response
            .bytes()
            .await
            .map_err(|error| network_error(&format!("Обрыв ответа {}", self.name), &error))?;
        serde_json::from_slice(&bytes).map_err(|error| {
            LauncherError::new(ErrorKind::Parse, format!("Ответ {} не разобрался", self.name))
                .with_detail(error.to_string())
        })
    }

    pub async fn get<T: DeserializeOwned>(&self, url: &str, query: &[(&str, String)]) -> Result<T> {
        let response = self.send(|client| client.get(url).query(query)).await?;
        self.decode(response).await
    }

    pub async fn post<T: DeserializeOwned, B: Serialize + Sync>(&self, url: &str, body: &B) -> Result<T> {
        let response = self.send(|client| client.post(url).json(body)).await?;
        self.decode(response).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_prefers_the_servers_hint() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("x-ratelimit-reset", reqwest::header::HeaderValue::from_static("12"));
        assert_eq!(backoff_hint(&headers), Duration::from_secs(12));

        headers.insert("retry-after", reqwest::header::HeaderValue::from_static("3"));
        assert_eq!(backoff_hint(&headers), Duration::from_secs(3));

        // Absurd hints are bounded; a missing hint falls back to a pause.
        let mut huge = reqwest::header::HeaderMap::new();
        huge.insert("retry-after", reqwest::header::HeaderValue::from_static("99999"));
        assert_eq!(backoff_hint(&huge), Duration::from_secs(60));
        assert_eq!(backoff_hint(&reqwest::header::HeaderMap::new()), Duration::from_secs(5));
    }

    #[tokio::test]
    async fn the_limiter_allows_a_burst_then_paces() {
        let limiter = RateLimiter::new(20.0, 3.0);
        let started = Instant::now();
        for _ in 0..3 {
            limiter.acquire().await;
        }
        assert!(started.elapsed() < Duration::from_millis(30), "burst should be immediate");
        limiter.acquire().await;
        // The fourth request waits for a refill: 1/20 s.
        assert!(started.elapsed() >= Duration::from_millis(40));
    }
}
