//! Which folder to expose to the asset protocol for a file. Pure `std`, no Tauri, so it can be
//! unit tested anywhere. `commands.rs` applies the result to Tauri's asset protocol scope.

use std::path::{Path, PathBuf};

/// The folder whose contents (recursively) a document may show as images: the file's parent.
/// `None` for a path with no usable parent: a bare file name, or a file directly in a root.
pub fn asset_dir_for(file: &Path) -> Option<PathBuf> {
    let parent = file.parent()?;
    // A bare file name has an empty parent. A file directly under a drive or filesystem root has
    // the root as its parent; exposing that would expose the whole disk, so refuse it.
    if parent.as_os_str().is_empty() || parent.parent().is_none() {
        return None;
    }
    Some(parent.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_the_parent_folder() {
        assert_eq!(
            asset_dir_for(Path::new("docs/notes/a.md")),
            Some(PathBuf::from("docs/notes"))
        );
    }

    #[test]
    fn a_bare_file_name_has_no_folder() {
        assert_eq!(asset_dir_for(Path::new("a.md")), None);
    }

    #[test]
    fn a_root_has_no_folder() {
        assert_eq!(asset_dir_for(Path::new("/")), None);
    }

    #[test]
    fn a_file_directly_under_the_root_exposes_nothing() {
        assert_eq!(asset_dir_for(Path::new("/a.md")), None);
    }
}
