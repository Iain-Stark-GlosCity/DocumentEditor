//! Binary file helpers for images: write bytes or copy a file without ever clobbering by accident.
//! Pure `std`, no Tauri, so it can be unit tested anywhere.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// Why a binary write or copy failed. `Exists` is reported to the front end as a typed error.
#[derive(Debug)]
pub enum BinaryError {
    Exists,
    Io(io::Error),
}

impl From<io::Error> for BinaryError {
    fn from(e: io::Error) -> Self {
        BinaryError::Io(e)
    }
}

/// Decodes `%XX` escapes (as produced by JavaScript's `encodeURIComponent`) into UTF-8 text.
/// Used for header values, which cannot carry arbitrary characters. Invalid input is an error.
pub fn percent_decode(text: &str) -> Result<String, String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = bytes.get(i + 1..i + 3).ok_or("Truncated % escape")?;
            let hex = std::str::from_utf8(hex).map_err(|_| "Bad % escape")?;
            out.push(u8::from_str_radix(hex, 16).map_err(|_| "Bad % escape")?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "Not valid UTF-8".to_string())
}

fn temp_beside(target: &Path) -> io::Result<PathBuf> {
    let dir = target.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let name = target
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Not a file path"))?
        .to_string_lossy();
    Ok(dir.join(format!(".{name}.{}.tmp", std::process::id())))
}

/// Creates the parent folders, refuses an existing target unless `overwrite`, and otherwise
/// finishes by renaming a fully written temporary file into place.
fn place(
    target: &Path,
    overwrite: bool,
    fill: impl FnOnce(&Path) -> io::Result<()>,
) -> Result<(), BinaryError> {
    if !overwrite && target.exists() {
        return Err(BinaryError::Exists);
    }
    if let Some(parent) = target.parent().filter(|p| !p.as_os_str().is_empty()) {
        fs::create_dir_all(parent)?;
    }
    let temp = temp_beside(target)?;
    let done = fill(&temp).and_then(|_| {
        // Re-check just before the rename to narrow the window for a file created meanwhile.
        if !overwrite && target.exists() {
            return Err(io::Error::from(io::ErrorKind::AlreadyExists));
        }
        fs::rename(&temp, target)
    });
    match done {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&temp);
            if e.kind() == io::ErrorKind::AlreadyExists {
                Err(BinaryError::Exists)
            } else {
                Err(BinaryError::Io(e))
            }
        }
    }
}

pub fn write_bytes(target: &Path, bytes: &[u8], overwrite: bool) -> Result<(), BinaryError> {
    place(target, overwrite, |temp| {
        let mut file = fs::File::create(temp)?;
        file.write_all(bytes)?;
        file.flush()?;
        file.sync_all()
    })
}

pub fn copy_to(from: &Path, to: &Path, overwrite: bool) -> Result<(), BinaryError> {
    if from == to {
        return Ok(());
    }
    place(to, overwrite, |temp| fs::copy(from, temp).map(|_| ()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("docedit-binary-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn decodes_percent_escapes() {
        assert_eq!(percent_decode("C%3A%5CUsers%5Cme%20x%5Ca.png").unwrap(), r"C:\Users\me x\a.png");
        assert_eq!(percent_decode("%C3%A9.png").unwrap(), "é.png");
        assert_eq!(percent_decode("plain").unwrap(), "plain");
        assert!(percent_decode("%2").is_err());
        assert!(percent_decode("%zz").is_err());
        assert!(percent_decode("%FF").is_err());
    }

    #[test]
    fn writes_creating_parent_folders() {
        let dir = scratch("create");
        let target = dir.join("assets").join("deep").join("a.png");
        write_bytes(&target, &[1, 2, 3], false).unwrap();
        assert_eq!(fs::read(&target).unwrap(), vec![1, 2, 3]);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_to_overwrite_unless_asked_and_leaves_no_temporaries() {
        let dir = scratch("exists");
        let target = dir.join("a.png");
        write_bytes(&target, b"one", false).unwrap();
        assert!(matches!(write_bytes(&target, b"two", false), Err(BinaryError::Exists)));
        assert_eq!(fs::read(&target).unwrap(), b"one");
        write_bytes(&target, b"two", true).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"two");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn copies_with_the_same_rules() {
        let dir = scratch("copy");
        let source = dir.join("src.png");
        fs::write(&source, b"pixels").unwrap();
        let target = dir.join("out").join("dst.png");
        copy_to(&source, &target, false).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"pixels");
        assert!(matches!(copy_to(&source, &target, false), Err(BinaryError::Exists)));
        fs::write(&source, b"new").unwrap();
        copy_to(&source, &target, true).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new");
        copy_to(&source, &source, false).unwrap();
        assert!(copy_to(&dir.join("missing.png"), &dir.join("x.png"), false).is_err());
        assert!(!dir.join("x.png").exists());
        // Only `src.png` and `out/`: no temporary files left behind.
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);
        assert_eq!(fs::read_dir(dir.join("out")).unwrap().count(), 1);
        fs::remove_dir_all(&dir).unwrap();
    }
}
