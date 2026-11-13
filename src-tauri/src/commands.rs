//! Tauri commands. Thin wrappers around the pure logic in `textfile`.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use thiserror::Error;

use crate::assets::asset_dirs_for;
use crate::atomic::atomic_write;
use crate::textfile::{self, FileFormat};
use crate::watch::{event_is_for, watch_target, CASE_INSENSITIVE};

#[derive(Error, Debug)]
pub enum AppError {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Decode(#[from] textfile::DecodeError),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Watch(#[from] notify::Error),
    #[error("{0}")]
    Other(String),
}

// Commands reject with a plain string, which the front end turns into an Error.
impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

type Result<T> = std::result::Result<T, AppError>;

#[derive(Default)]
pub struct AppState {
    /// Paths received before the front end asked for them.
    pub pending_open: Mutex<Vec<String>>,
    /// Set once the front end has called `take_open_requests`; later requests are emitted.
    pub frontend_ready: AtomicBool,
    /// Active watches by the id `watch_file` returned. Dropping a watcher stops it.
    watchers: Mutex<HashMap<u64, RecommendedWatcher>>,
    next_watch_id: AtomicU64,
}

#[derive(Serialize)]
pub struct FileData {
    text: String,
    format: FileFormat,
    #[serde(rename = "modifiedMs")]
    modified_ms: u64,
}

#[derive(Serialize)]
pub struct WriteResult {
    #[serde(rename = "modifiedMs")]
    modified_ms: u64,
}

#[derive(Serialize, Deserialize)]
pub struct RecoverySnapshot {
    id: String,
    path: Option<String>,
    text: String,
    #[serde(rename = "savedMs")]
    saved_ms: u64,
}

#[derive(Serialize, Clone)]
struct FileChange {
    /// The id `watch_file` returned for the watch this event belongs to.
    id: u64,
    kind: &'static str,
}

fn modified_ms(path: &Path) -> Result<u64> {
    let modified = fs::metadata(path)?.modified()?;
    Ok(modified.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0))
}

/// Let the webview load images from the folder of a file we read or wrote, and from that folder's
/// parent (so `../images/x.png` works), unless the parent is a drive or profile root. The asset
/// protocol scope starts empty (not global); this is the only place it grows. Failure is not
/// fatal: the document still opens, its local images just will not load.
fn allow_assets_beside(app: &AppHandle, file: &str) {
    for dir in asset_dirs_for(file) {
        let _ = app.asset_protocol_scope().allow_directory(dir, true);
    }
}

/// The modified time of a file without reading it, or `None` if it does not exist.
#[tauri::command]
pub fn stat_file(path: String) -> Result<Option<WriteResult>> {
    match modified_ms(Path::new(&path)) {
        Ok(modified_ms) => Ok(Some(WriteResult { modified_ms })),
        Err(AppError::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub fn read_file(app: AppHandle, path: String) -> Result<FileData> {
    let bytes = fs::read(&path)?;
    let (text, format) = textfile::decode(&bytes)?;
    allow_assets_beside(&app, &path);
    Ok(FileData { text, format, modified_ms: modified_ms(Path::new(&path))? })
}

/// Atomic: write a temporary file beside the target, flush it to disk, then rename over it.
#[tauri::command]
pub fn write_file(app: AppHandle, path: String, text: String, format: FileFormat) -> Result<WriteResult> {
    let target = PathBuf::from(&path);
    atomic_write(&target, &textfile::encode(&text, &format))?;
    allow_assets_beside(&app, &path);
    Ok(WriteResult { modified_ms: modified_ms(&target)? })
}

fn settings_file(app: &AppHandle) -> Result<PathBuf> {
    let dir = app.path().app_config_dir().map_err(|e| AppError::Other(e.to_string()))?;
    fs::create_dir_all(&dir)?;
    Ok(dir.join("settings.json"))
}

/// The stored settings JSON, or `None` if the file does not exist yet.
#[tauri::command]
pub fn read_settings(app: AppHandle) -> Result<Option<String>> {
    match fs::read_to_string(settings_file(&app)?) {
        Ok(json) => Ok(Some(json)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
pub fn write_settings(app: AppHandle, json: String) -> Result<()> {
    atomic_write(&settings_file(&app)?, json.as_bytes())?;
    Ok(())
}

/// Watches the file's folder (a watch on the file itself is lost when an editor saves by deleting
/// and renaming) and reports events for that file name. Returns an id; every `file-changed`
/// event carries it, so the front end matches on the id and never on the path the OS reports.
#[tauri::command]
pub fn watch_file(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<u64> {
    let (dir, file_name) = watch_target(Path::new(&path))
        .ok_or_else(|| AppError::Other(format!("Cannot watch {path}: it has no file name")))?;
    let id = state.next_watch_id.fetch_add(1, Ordering::SeqCst);

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        let kind = match event.kind {
            EventKind::Remove(_) => "removed",
            EventKind::Create(_) | EventKind::Modify(_) => "modified",
            _ => return,
        };
        if event_is_for(&event.paths, &file_name, CASE_INSENSITIVE) {
            let _ = app.emit("file-changed", FileChange { id, kind });
        }
    })?;
    watcher.watch(&dir, RecursiveMode::NonRecursive)?;

    let mut watchers = state.watchers.lock().map_err(|_| AppError::Other("watcher lock poisoned".into()))?;
    watchers.insert(id, watcher);
    Ok(id)
}

/// Stops a watch and releases its watcher (and the OS handle on the folder).
#[tauri::command]
pub fn unwatch_file(state: State<'_, AppState>, id: u64) -> Result<()> {
    let mut watchers = state.watchers.lock().map_err(|_| AppError::Other("watcher lock poisoned".into()))?;
    watchers.remove(&id); // Dropping the watcher stops it.
    Ok(())
}

fn recovery_dir(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(e.to_string()))?
        .join("recovery");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Snapshot ids come from the front end; only allow names that cannot escape the folder.
fn recovery_file(app: &AppHandle, id: &str) -> Result<PathBuf> {
    let valid = !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !valid {
        return Err(AppError::Other(format!("Invalid recovery id: {id}")));
    }
    Ok(recovery_dir(app)?.join(format!("{id}.json")))
}

#[tauri::command]
pub fn write_recovery(app: AppHandle, snapshot: RecoverySnapshot) -> Result<()> {
    let file = recovery_file(&app, &snapshot.id)?;
    fs::write(file, serde_json::to_vec(&snapshot)?)?;
    Ok(())
}

#[tauri::command]
pub fn clear_recovery(app: AppHandle, id: String) -> Result<()> {
    match fs::remove_file(recovery_file(&app, &id)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

#[tauri::command]
pub fn list_recovery(app: AppHandle) -> Result<Vec<RecoverySnapshot>> {
    let mut snapshots = Vec::new();
    for entry in fs::read_dir(recovery_dir(&app)?)? {
        let path = entry?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        // A corrupt snapshot must not hide the others.
        if let Ok(snapshot) = fs::read(&path).map_err(AppError::from).and_then(|b| Ok(serde_json::from_slice(&b)?)) {
            snapshots.push(snapshot);
        }
    }
    Ok(snapshots)
}

/// Returns and clears paths queued before the front end was ready, and marks it ready so later
/// requests are emitted as `open-request` events instead.
#[tauri::command]
pub fn take_open_requests(state: State<'_, AppState>) -> Result<Vec<String>> {
    // Hold the lock while flipping the flag so a concurrent delivery cannot slip between.
    let mut pending = state.pending_open.lock().map_err(|_| AppError::Other("queue lock poisoned".into()))?;
    state.frontend_ready.store(true, std::sync::atomic::Ordering::SeqCst);
    Ok(std::mem::take(&mut *pending))
}
