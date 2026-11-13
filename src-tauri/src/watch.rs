//! Pure helpers for file watching. Pure `std`, no Tauri or notify, so they can be unit tested
//! anywhere.
//!
//! The watcher watches the file's parent folder (non-recursively) and keeps events whose path has
//! the file's name. A watch on the file itself would be lost when an editor saves by deleting and
//! renaming. Only the file name is compared, never the whole path, because the OS may report the
//! folder part differently from how it was registered (case, slashes, a `\\?\` prefix).

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

/// Whether file names compare case-insensitively: true on Windows, where `A.md` and `a.md` are
/// the same file.
pub const CASE_INSENSITIVE: bool = cfg!(windows);

/// Splits a watched path into the folder to watch and the file name to filter on. A path with no
/// folder part is watched in the current folder. `None` if it has no file name.
pub fn watch_target(path: &Path) -> Option<(PathBuf, OsString)> {
    let name = path.file_name()?.to_os_string();
    let dir = match path.parent() {
        Some(p) if !p.as_os_str().is_empty() => p.to_path_buf(),
        _ => PathBuf::from("."),
    };
    Some((dir, name))
}

/// Whether two file names are the same file.
pub fn same_file_name(a: &OsStr, b: &OsStr, case_insensitive: bool) -> bool {
    if !case_insensitive {
        return a == b;
    }
    match (a.to_str(), b.to_str()) {
        (Some(a), Some(b)) => a == b || a.to_lowercase() == b.to_lowercase(),
        _ => a == b,
    }
}

/// Whether any of an event's paths is the watched file, judged by file name alone.
pub fn event_is_for(paths: &[PathBuf], file_name: &OsStr, case_insensitive: bool) -> bool {
    paths
        .iter()
        .any(|p| p.file_name().is_some_and(|n| same_file_name(n, file_name, case_insensitive)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_into_folder_and_name() {
        let (dir, name) = watch_target(Path::new("docs/a.md")).unwrap();
        assert_eq!(dir, PathBuf::from("docs"));
        assert_eq!(name, OsString::from("a.md"));
    }

    #[test]
    fn a_bare_name_is_watched_in_the_current_folder() {
        let (dir, name) = watch_target(Path::new("a.md")).unwrap();
        assert_eq!(dir, PathBuf::from("."));
        assert_eq!(name, OsString::from("a.md"));
    }

    #[test]
    fn a_path_without_a_file_name_is_refused() {
        assert!(watch_target(Path::new("/")).is_none());
        assert!(watch_target(Path::new("")).is_none());
    }

    #[test]
    fn names_compare_exactly_when_case_sensitive() {
        assert!(same_file_name(OsStr::new("a.md"), OsStr::new("a.md"), false));
        assert!(!same_file_name(OsStr::new("a.md"), OsStr::new("A.MD"), false));
    }

    #[test]
    fn names_ignore_case_when_case_insensitive() {
        assert!(same_file_name(OsStr::new("Notes.MD"), OsStr::new("notes.md"), true));
        assert!(!same_file_name(OsStr::new("notes.md"), OsStr::new("notes.txt"), true));
    }

    #[test]
    fn matches_on_the_file_name_whatever_the_folder_looks_like() {
        let name = OsString::from("a.md");
        let reported = vec![PathBuf::from("/other/spelling/A.md")];
        assert!(event_is_for(&reported, &name, true));
        assert!(!event_is_for(&reported, &name, false));
    }

    #[test]
    fn matches_when_any_path_of_a_rename_matches() {
        let name = OsString::from("a.md");
        let paths = vec![PathBuf::from("dir/.a.md.tmp"), PathBuf::from("dir/a.md")];
        assert!(event_is_for(&paths, &name, false));
    }

    #[test]
    fn ignores_other_files_and_empty_events() {
        let name = OsString::from("a.md");
        assert!(!event_is_for(&[PathBuf::from("dir/b.md")], &name, true));
        assert!(!event_is_for(&[], &name, true));
    }
}
