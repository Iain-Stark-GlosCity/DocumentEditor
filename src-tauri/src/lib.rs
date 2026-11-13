pub mod assets;
pub mod atomic;
pub mod commands;
pub mod textfile;
pub mod watch;

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use tauri::{AppHandle, Emitter, Manager};

use commands::AppState;

/// Keep only arguments that look like file paths, resolved against `cwd` if relative.
fn paths_from_args<I: IntoIterator<Item = String>>(args: I, cwd: Option<&Path>) -> Vec<String> {
    args.into_iter()
        .filter(|a| !a.is_empty() && !a.starts_with('-'))
        .map(|a| {
            let p = PathBuf::from(&a);
            match cwd {
                Some(dir) if p.is_relative() => dir.join(p).to_string_lossy().into_owned(),
                _ => a,
            }
        })
        .collect()
}

/// Deliver paths to the front end: emit if it is ready, otherwise queue for `take_open_requests`.
fn deliver_open_requests(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    let state = app.state::<AppState>();
    // Decide under the queue lock so `take_open_requests` cannot slip in between.
    let Ok(mut pending) = state.pending_open.lock() else { return };
    if state.frontend_ready.load(Ordering::SeqCst) {
        drop(pending);
        let _ = app.emit("open-request", paths);
    } else {
        pending.extend(paths);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let paths = paths_from_args(args.into_iter().skip(1), Some(Path::new(&cwd)));
            deliver_open_requests(app, paths);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .setup(|app| {
            let paths = paths_from_args(std::env::args().skip(1), None);
            deliver_open_requests(app.handle(), paths);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::write_file,
            commands::stat_file,
            commands::watch_file,
            commands::unwatch_file,
            commands::write_recovery,
            commands::clear_recovery,
            commands::list_recovery,
            commands::take_open_requests,
            commands::read_settings,
            commands::write_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DocumentEditor");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_flags_and_empty_args_and_resolves_relative_paths() {
        let args = vec!["--flag".to_string(), String::new(), "a.md".to_string()];
        let out = paths_from_args(args, Some(Path::new("work")));
        assert_eq!(out, vec![Path::new("work").join("a.md").to_string_lossy().into_owned()]);
    }

    #[test]
    fn leaves_paths_alone_without_a_cwd() {
        let out = paths_from_args(vec!["a.md".to_string()], None);
        assert_eq!(out, vec!["a.md".to_string()]);
    }
}
