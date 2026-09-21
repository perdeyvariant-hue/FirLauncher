//! Parallel, resumable, hash-verified downloads.
//!
//! Every file lands in a sibling `.part` file first, is verified against its
//! SHA1 and only then renamed into place — so an interrupted run never leaves
//! a half-written jar that looks valid. Re-running skips whatever already
//! matches, which is what makes "download only what is missing" work.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use futures_util::StreamExt;
use sha1::{Digest, Sha1};
use sha2::Sha256;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

use crate::error::{ErrorKind, LauncherError, Result};
use crate::net::retry::{network_error, with_retry, RetryPolicy};

/// Anything that wants to be told how a batch is progressing.
pub trait ProgressSink: Send + Sync {
    fn add_bytes(&self, bytes: u64);
    /// Called once per finished file, with how many are done overall.
    fn item_finished(&self, done: usize, total: usize);
}

/// Sources disagree on the digest they publish: Mojang uses SHA1, Adoptium
/// SHA-256. Carrying the algorithm with the value keeps the verifier honest
/// instead of silently comparing a SHA-256 against a SHA1.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Checksum {
    Sha1(String),
    Sha256(String),
}

/// Streaming hasher for whichever algorithm an item declares.
enum FileHasher {
    Sha1(Sha1),
    Sha256(Sha256),
}

impl FileHasher {
    fn for_checksum(checksum: &Checksum) -> Self {
        match checksum {
            Checksum::Sha1(_) => FileHasher::Sha1(Sha1::new()),
            Checksum::Sha256(_) => FileHasher::Sha256(Sha256::new()),
        }
    }

    fn update(&mut self, data: &[u8]) {
        match self {
            FileHasher::Sha1(hasher) => hasher.update(data),
            FileHasher::Sha256(hasher) => hasher.update(data),
        }
    }

    fn finalize_hex(self) -> String {
        match self {
            FileHasher::Sha1(hasher) => hex::encode(hasher.finalize()),
            FileHasher::Sha256(hasher) => hex::encode(hasher.finalize()),
        }
    }
}

impl Checksum {
    fn expected(&self) -> &str {
        match self {
            Checksum::Sha1(value) | Checksum::Sha256(value) => value,
        }
    }
}

#[derive(Debug, Clone)]
pub struct DownloadItem {
    pub url: String,
    pub dest: PathBuf,
    /// Absent for sources that publish no digest at all.
    pub checksum: Option<Checksum>,
    pub size: Option<u64>,
}

impl DownloadItem {
    pub fn new(url: impl Into<String>, dest: impl Into<PathBuf>) -> Self {
        Self {
            url: url.into(),
            dest: dest.into(),
            checksum: None,
            size: None,
        }
    }

    #[must_use]
    pub fn with_sha1(mut self, sha1: Option<String>) -> Self {
        self.checksum = sha1.map(|value| Checksum::Sha1(value.to_ascii_lowercase()));
        self
    }

    #[must_use]
    pub fn with_sha256(mut self, sha256: Option<String>) -> Self {
        self.checksum = sha256.map(|value| Checksum::Sha256(value.to_ascii_lowercase()));
        self
    }

    #[must_use]
    pub fn with_size(mut self, size: Option<u64>) -> Self {
        self.size = size;
        self
    }
}

/// Total bytes a batch will move, as far as the manifests tell us.
pub fn total_bytes(items: &[DownloadItem]) -> u64 {
    items.iter().filter_map(|item| item.size).sum()
}

/// Hashes a file with the algorithm the expected checksum uses.
async fn digest_file(path: &Path, checksum: &Checksum) -> Result<String> {
    let mut hasher = FileHasher::for_checksum(checksum);
    let mut file = tokio::fs::File::open(path).await?;
    let mut buffer = vec![0_u8; 128 * 1024];
    loop {
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize_hex())
}

/// SHA1 of a file on disk, for callers that need it independently of a
/// download (mod update checks, export manifests).
pub async fn sha1_of_file(path: &Path) -> Result<String> {
    digest_file(path, &Checksum::Sha1(String::new())).await
}

/// True when the file on disk already is what we were about to download.
async fn already_valid(item: &DownloadItem) -> bool {
    let Ok(meta) = tokio::fs::metadata(&item.dest).await else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    match (&item.checksum, item.size) {
        (Some(checksum), _) => match digest_file(&item.dest, checksum).await {
            Ok(actual) => actual == checksum.expected(),
            Err(_) => false,
        },
        (None, Some(size)) => meta.len() == size,
        (None, None) => true,
    }
}

fn part_path(dest: &Path) -> PathBuf {
    let mut name = dest.as_os_str().to_os_string();
    name.push(".part");
    PathBuf::from(name)
}

async fn ensure_parent(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|error| {
            LauncherError::io(format!("Не удалось создать папку {}", parent.display()))
                .with_detail(error.to_string())
        })?;
    }
    Ok(())
}

async fn hash_existing(path: &Path, checksum: &Checksum) -> Result<FileHasher> {
    let mut hasher = FileHasher::for_checksum(checksum);
    let mut file = tokio::fs::File::open(path).await?;
    let mut buffer = vec![0_u8; 128 * 1024];
    loop {
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher)
}

/// Downloads one file, resuming a previous `.part` when the server allows it.
async fn download_one(
    client: &reqwest::Client,
    item: &DownloadItem,
    token: &CancellationToken,
    sink: &dyn ProgressSink,
    attempt: u32,
) -> Result<()> {
    let part = part_path(&item.dest);
    ensure_parent(&item.dest).await?;

    // A retry means the previous body was wrong, so start clean instead of
    // resuming on top of bytes we already know are bad.
    if attempt > 0 {
        let _ = tokio::fs::remove_file(&part).await;
    }

    // Without a published digest there is nothing to verify, but the
    // streaming hasher still needs a concrete algorithm; SHA1 is the
    // cheap default.
    let checksum = item
        .checksum
        .clone()
        .unwrap_or_else(|| Checksum::Sha1(String::new()));
    let mut hasher = FileHasher::for_checksum(&checksum);
    let mut resume_from = 0_u64;

    if let Ok(meta) = tokio::fs::metadata(&part).await {
        let existing = meta.len();
        let expected = item.size.unwrap_or(u64::MAX);
        if existing > 0 && existing < expected {
            // Seed the hasher with what is already on disk so the final digest
            // covers the whole file, not just the resumed tail.
            hasher = hash_existing(&part, &checksum).await?;
            resume_from = existing;
            sink.add_bytes(existing);
        } else {
            let _ = tokio::fs::remove_file(&part).await;
        }
    }

    let mut request = client.get(&item.url);
    if resume_from > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={resume_from}-"));
    }

    let response = request
        .send()
        .await
        .map_err(|error| network_error("Не удалось соединиться с сервером", &error))?;

    let status = response.status();
    if !status.is_success() {
        let retryable = status.is_server_error()
            || status == reqwest::StatusCode::TOO_MANY_REQUESTS
            || status == reqwest::StatusCode::REQUEST_TIMEOUT;
        return Err(
            LauncherError::new(ErrorKind::Http, format!("Сервер ответил {status}"))
                .with_detail(item.url.clone())
                .retryable(retryable),
        );
    }

    // The server ignored our Range header, so the body starts from zero again.
    let append = resume_from > 0 && status == reqwest::StatusCode::PARTIAL_CONTENT;
    if resume_from > 0 && !append {
        hasher = FileHasher::for_checksum(&checksum);
        let _ = tokio::fs::remove_file(&part).await;
    }

    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(append)
        .truncate(!append)
        .open(&part)
        .await
        .map_err(|error| {
            LauncherError::io(format!("Не удалось открыть {}", part.display()))
                .with_detail(error.to_string())
        })?;

    let mut stream = response.bytes_stream();
    loop {
        let next = tokio::select! {
            biased;
            () = token.cancelled() => {
                let _ = file.flush().await;
                return Err(LauncherError::new(ErrorKind::Cancelled, "Загрузка отменена"));
            }
            chunk = stream.next() => chunk,
        };

        let Some(chunk) = next else { break };
        let chunk = chunk.map_err(|error| network_error("Обрыв загрузки", &error))?;
        hasher.update(&chunk);
        file.write_all(&chunk).await?;
        sink.add_bytes(chunk.len() as u64);
    }

    file.flush().await?;
    drop(file);

    if let Some(expected) = &item.checksum {
        let actual = hasher.finalize_hex();
        if actual != expected.expected() {
            let _ = tokio::fs::remove_file(&part).await;
            let algorithm = match expected {
                Checksum::Sha1(_) => "SHA1",
                Checksum::Sha256(_) => "SHA-256",
            };
            return Err(
                LauncherError::new(ErrorKind::Hash, "Файл скачался повреждённым")
                    .with_detail(format!(
                        "{}
ожидался {algorithm} {}, получен {actual}",
                        item.url,
                        expected.expected()
                    ))
                    // Worth one clean retry: mirrors and proxies do truncate bodies.
                    .retryable(true),
            );
        }
    }

    tokio::fs::rename(&part, &item.dest).await.map_err(|error| {
        LauncherError::io(format!("Не удалось сохранить {}", item.dest.display()))
            .with_detail(error.to_string())
    })?;

    Ok(())
}

/// Downloads every item, at most `concurrency` at a time, skipping whatever
/// already matches on disk. Stops the whole batch at the first hard failure.
/// Collapses entries that write to the same file.
///
/// Version JSONs really do list one library twice — 1.14 through 1.16 declare
/// the plain artifact and the natives variant as separate entries that share a
/// `downloads.artifact` path. Two tasks writing one `.part` race, and whichever
/// renames second fails with "file not found". Deduplicating here protects
/// every caller rather than each manifest parser separately.
/// Per-destination locks, shared across every batch in the process.
///
/// Deduplication fixes duplicates *within* one manifest, but two instances
/// installing at the same time share `libraries/` and would still race on the
/// same `.part`. Serialising per file means the second arrival simply finds
/// the finished download and skips it.
static FILE_LOCKS: std::sync::OnceLock<
    parking_lot::Mutex<std::collections::HashMap<PathBuf, Arc<tokio::sync::Mutex<()>>>>,
> = std::sync::OnceLock::new();

fn lock_for(path: &Path) -> Arc<tokio::sync::Mutex<()>> {
    let registry = FILE_LOCKS.get_or_init(|| parking_lot::Mutex::new(std::collections::HashMap::new()));
    let mut map = registry.lock();
    Arc::clone(
        map.entry(path.to_path_buf())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(()))),
    )
}

/// Drops the registry entry once nobody else holds it, so a long session does
/// not accumulate one lock per downloaded file.
fn release_lock(path: &Path) {
    let Some(registry) = FILE_LOCKS.get() else {
        return;
    };
    let mut map = registry.lock();
    if map.get(path).is_some_and(|lock| Arc::strong_count(lock) == 1) {
        map.remove(path);
    }
}

pub fn dedupe_by_destination(items: Vec<DownloadItem>) -> Vec<DownloadItem> {
    let mut order: Vec<DownloadItem> = Vec::with_capacity(items.len());
    let mut index: std::collections::HashMap<PathBuf, usize> =
        std::collections::HashMap::with_capacity(items.len());

    for item in items {
        match index.get(&item.dest) {
            Some(&position) => {
                // Keep whichever copy carries more verification data.
                let existing = &order[position];
                if existing.checksum.is_none() && item.checksum.is_some() {
                    order[position] = item;
                } else if existing.size.is_none() && item.size.is_some() {
                    order[position].size = item.size;
                }
            }
            None => {
                index.insert(item.dest.clone(), order.len());
                order.push(item);
            }
        }
    }

    order
}

pub async fn download_all(
    client: &reqwest::Client,
    items: Vec<DownloadItem>,
    concurrency: usize,
    token: CancellationToken,
    sink: Arc<dyn ProgressSink>,
) -> Result<()> {
    let items = dedupe_by_destination(items);
    let total = items.len();
    if total == 0 {
        return Ok(());
    }

    let semaphore = Arc::new(Semaphore::new(concurrency.clamp(1, 64)));
    let done = Arc::new(AtomicUsize::new(0));
    let mut handles = Vec::with_capacity(total);

    for item in items {
        let client = client.clone();
        let semaphore = Arc::clone(&semaphore);
        let token = token.clone();
        let sink = Arc::clone(&sink);
        let done = Arc::clone(&done);

        handles.push(tokio::spawn(async move {
            let _permit = semaphore
                .acquire()
                .await
                .map_err(|_| LauncherError::internal("Пул загрузок закрыт"))?;

            if token.is_cancelled() {
                return Err(LauncherError::new(ErrorKind::Cancelled, "Загрузка отменена"));
            }

            // Nobody else may touch this file, or its .part, until we are done.
            let file_lock = lock_for(&item.dest);
            let guard = file_lock.lock().await;

            let outcome = if already_valid(&item).await {
                if let Some(size) = item.size {
                    sink.add_bytes(size);
                }
                Ok(())
            } else {
                with_retry(RetryPolicy::default(), |attempt| {
                    let client = client.clone();
                    let item = item.clone();
                    let token = token.clone();
                    let sink = Arc::clone(&sink);
                    async move {
                        download_one(&client, &item, &token, sink.as_ref(), attempt).await
                    }
                })
                .await
            };

            drop(guard);
            drop(file_lock);
            release_lock(&item.dest);
            outcome?;

            let finished = done.fetch_add(1, Ordering::Relaxed) + 1;
            sink.item_finished(finished, total);
            Ok(())
        }));
    }

    let mut first_error: Option<LauncherError> = None;
    for handle in handles {
        let outcome: Result<()> = match handle.await {
            Ok(result) => result,
            Err(join_error) => Err(LauncherError::internal("Сбой потока загрузки")
                .with_detail(join_error.to_string())),
        };
        if let Err(error) = outcome {
            if first_error.is_none() {
                // One doomed file means the rest of the batch is pointless.
                token.cancel();
                first_error = Some(error);
            }
        }
    }

    match first_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(url: &str, dest: &str) -> DownloadItem {
        DownloadItem::new(url, PathBuf::from(dest))
    }

    #[test]
    fn same_destination_is_downloaded_once() {
        // The shape 1.14-1.16 version JSONs produce: the plain artifact entry
        // and the natives entry name the same jar.
        let items = vec![
            item("https://libs/lwjgl-opengl-3.2.2.jar", "/lib/lwjgl-opengl-3.2.2.jar"),
            item("https://libs/other.jar", "/lib/other.jar"),
            item("https://libs/lwjgl-opengl-3.2.2.jar", "/lib/lwjgl-opengl-3.2.2.jar"),
        ];

        let deduped = dedupe_by_destination(items);

        assert_eq!(deduped.len(), 2);
        // Order of first appearance is preserved, which the classpath relies on.
        assert_eq!(deduped[0].dest, PathBuf::from("/lib/lwjgl-opengl-3.2.2.jar"));
        assert_eq!(deduped[1].dest, PathBuf::from("/lib/other.jar"));
    }

    #[test]
    fn the_copy_with_verification_data_wins() {
        let bare = item("https://libs/a.jar", "/lib/a.jar");
        let verified = item("https://libs/a.jar", "/lib/a.jar")
            .with_sha1(Some(String::from("ABCDEF")))
            .with_size(Some(1024));

        let deduped = dedupe_by_destination(vec![bare, verified]);
        assert_eq!(deduped.len(), 1);
        assert_eq!(
            deduped[0].checksum,
            Some(Checksum::Sha1(String::from("abcdef")))
        );
        assert_eq!(deduped[0].size, Some(1024));

        // A size-only duplicate still contributes its size to the total.
        let verified = item("https://libs/b.jar", "/lib/b.jar").with_sha1(Some(String::from("aa")));
        let sized = item("https://libs/b.jar", "/lib/b.jar").with_size(Some(64));
        let deduped = dedupe_by_destination(vec![verified, sized]);
        assert_eq!(deduped.len(), 1);
        assert_eq!(deduped[0].size, Some(64));
        assert_eq!(deduped[0].checksum, Some(Checksum::Sha1(String::from("aa"))));
    }

    #[test]
    fn totals_count_each_file_once() {
        let items = dedupe_by_destination(vec![
            item("https://libs/a.jar", "/lib/a.jar").with_size(Some(100)),
            item("https://libs/a.jar", "/lib/a.jar").with_size(Some(100)),
        ]);
        assert_eq!(total_bytes(&items), 100);
    }
}
