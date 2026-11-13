//! Atomic file replacement. Pure `std`, no Tauri, so it can be unit tested anywhere.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Write `bytes` to a temporary file beside `target`, flush it to disk, then rename it over
/// `target`. The temporary file is removed if anything fails.
pub fn atomic_write(target: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let dir = target.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let name = target
        .file_name()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "Not a file path"))?
        .to_string_lossy();
    let temp: PathBuf = dir.join(format!(".{name}.{}.tmp", std::process::id()));

    let written = (|| -> std::io::Result<()> {
        let mut file = fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.flush()?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, target)
    })();
    if written.is_err() {
        let _ = fs::remove_file(&temp);
    }
    written
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("docedit-atomic-{}-{name}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn creates_and_replaces_a_file_without_leaving_temporaries() {
        let dir = scratch("replace");
        let target = dir.join("settings.json");
        atomic_write(&target, b"one").unwrap();
        atomic_write(&target, b"two").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"two");
        let entries: Vec<_> = fs::read_dir(&dir).unwrap().collect();
        assert_eq!(entries.len(), 1);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn fails_cleanly_when_the_folder_is_missing() {
        let dir = scratch("missing");
        let target = dir.join("no-such-folder").join("a.json");
        assert!(atomic_write(&target, b"x").is_err());
        fs::remove_dir_all(&dir).unwrap();
    }
}
