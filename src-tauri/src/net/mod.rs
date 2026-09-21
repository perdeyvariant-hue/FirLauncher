//! HTTP plumbing shared by every remote source: the client, the retry policy
//! and the parallel, resumable, hash-verified downloader.

pub mod client;
pub mod download;
pub mod retry;

pub use client::{build_client, user_agent};
pub use download::{dedupe_by_destination, download_all, DownloadItem, ProgressSink};
pub use retry::{with_retry, RetryPolicy};
