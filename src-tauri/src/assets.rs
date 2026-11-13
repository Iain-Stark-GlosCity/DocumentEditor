//! Which folders to expose to the asset protocol for a file. Pure `std`, no Tauri, so it can be
//! unit tested anywhere. `commands.rs` applies the result to Tauri's asset protocol scope.
//!
//! Paths are handled as strings split on both `/` and `\`, so the decisions are the same on every
//! host OS (a Windows path is judged identically when the tests run on Linux).

/// A path split into its root and its folder/file components, remembering where each component
/// ends in the original string so folder paths can be sliced out unchanged.
struct SplitPath<'a> {
    text: &'a str,
    root_end: usize,
    comps: Vec<&'a str>,
    ends: Vec<usize>,
}

impl<'a> SplitPath<'a> {
    fn parse(text: &'a str) -> Self {
        let b = text.as_bytes();
        let is_sep = |c: u8| c == b'/' || c == b'\\';
        let mut i = 0;
        let mut unc = false;
        if text.starts_with(r"\\?\") {
            i = 4;
            if text[i..].len() >= 4 && text[i..i + 4].eq_ignore_ascii_case(r"UNC\") {
                unc = true;
                i += 4;
            }
        } else if text.len() >= 2 && is_sep(b[0]) && is_sep(b[1]) {
            unc = true;
            i = 2;
        }
        if unc {
            // `server\share` belongs to the root: a share root is as broad as a drive root.
            for _ in 0..2 {
                while i < b.len() && !is_sep(b[i]) {
                    i += 1;
                }
                if i < b.len() {
                    i += 1;
                }
            }
        } else if i + 1 < b.len() && b[i].is_ascii_alphabetic() && b[i + 1] == b':' {
            i += 2;
            if i < b.len() && is_sep(b[i]) {
                i += 1;
            }
        } else if i < b.len() && is_sep(b[i]) {
            i += 1;
        }
        let root_end = i;

        let mut comps = Vec::new();
        let mut ends = Vec::new();
        let mut start = root_end;
        for (offset, c) in text[root_end..].char_indices().chain(std::iter::once((text.len() - root_end, '/'))) {
            let at = root_end + offset;
            if c == '/' || c == '\\' {
                if at > start {
                    comps.push(&text[start..at]);
                    ends.push(at);
                }
                start = at + 1;
            }
        }
        SplitPath { text, root_end, comps, ends }
    }

    /// The folder made of the first `n` components (the root itself for 0).
    fn folder(&self, n: usize) -> &'a str {
        if n == 0 {
            &self.text[..self.root_end]
        } else {
            &self.text[..self.ends[n - 1]]
        }
    }
}

/// True for a user profile folder or the folder holding them: `Users`, `Users\name`, `home`,
/// `home/name`, `root`. Components are those below the root.
fn is_profile_root(comps: &[&str]) -> bool {
    let first = match comps.first() {
        Some(first) => first.to_ascii_lowercase(),
        None => return false,
    };
    match (first.as_str(), comps.len()) {
        ("users" | "home", 1 | 2) => true,
        ("root", 1) => true,
        _ => false,
    }
}

/// The folders whose contents (recursively) a document may show as images.
///
/// Always the file's own folder; plus that folder's parent, so `![](../images/x.png)` works,
/// unless the parent is a drive/filesystem/share root or a user profile root, where only the own
/// folder is allowed. Empty for a path with no usable folder: a bare file name, or a file
/// directly in a root (exposing that would expose the whole disk).
pub fn asset_dirs_for(file: &str) -> Vec<String> {
    let path = SplitPath::parse(file);
    let own = path.comps.len().saturating_sub(1);
    if own == 0 {
        return Vec::new();
    }
    let mut dirs = vec![path.folder(own).to_string()];
    let up = own - 1;
    if up > 0 && !is_profile_root(&path.comps[..up]) {
        dirs.push(path.folder(up).to_string());
    }
    dirs
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dirs(file: &str) -> Vec<String> {
        asset_dirs_for(file)
    }

    #[test]
    fn allows_the_own_folder_and_its_parent() {
        assert_eq!(dirs("docs/notes/a.md"), vec!["docs/notes", "docs"]);
        assert_eq!(dirs(r"C:\Work\Project\docs\a.md"), vec![r"C:\Work\Project\docs", r"C:\Work\Project"]);
        assert_eq!(dirs("/srv/site/docs/a.md"), vec!["/srv/site/docs", "/srv/site"]);
    }

    #[test]
    fn handles_mixed_separators_and_repeats() {
        assert_eq!(dirs(r"C:\Work/Project\\docs/a.md"), vec![r"C:\Work/Project\\docs", r"C:\Work/Project"]);
    }

    #[test]
    fn a_bare_file_name_has_no_folder() {
        assert!(dirs("a.md").is_empty());
    }

    #[test]
    fn a_file_directly_in_a_root_exposes_nothing() {
        assert!(dirs("/").is_empty());
        assert!(dirs("/a.md").is_empty());
        assert!(dirs(r"C:\a.md").is_empty());
        assert!(dirs(r"\\server\share\a.md").is_empty());
    }

    #[test]
    fn the_parent_is_never_a_drive_root() {
        assert_eq!(dirs(r"C:\docs\a.md"), vec![r"C:\docs"]);
        assert_eq!(dirs("/docs/a.md"), vec!["/docs"]);
        assert_eq!(dirs(r"\\server\share\docs\a.md"), vec![r"\\server\share\docs"]);
    }

    #[test]
    fn the_parent_is_never_a_user_profile_root() {
        assert_eq!(dirs(r"C:\Users\name\notes\a.md"), vec![r"C:\Users\name\notes"]);
        assert_eq!(dirs(r"c:\users\NAME\notes\a.md"), vec![r"c:\users\NAME\notes"]);
        assert_eq!(dirs("/home/name/notes/a.md"), vec!["/home/name/notes"]);
        assert_eq!(dirs("/root/notes/a.md"), vec!["/root/notes"]);
        // A file directly in a profile root: the root itself is the own folder, allowed alone.
        assert_eq!(dirs(r"C:\Users\name\a.md"), vec![r"C:\Users\name"]);
    }

    #[test]
    fn deeper_folders_under_a_profile_get_their_parent() {
        assert_eq!(
            dirs(r"C:\Users\name\Documents\notes\a.md"),
            vec![r"C:\Users\name\Documents\notes", r"C:\Users\name\Documents"]
        );
    }

    #[test]
    fn verbatim_prefixes_are_understood() {
        assert_eq!(dirs(r"\\?\C:\docs\a.md"), vec![r"\\?\C:\docs"]);
        assert_eq!(dirs(r"\\?\C:\Users\name\notes\a.md"), vec![r"\\?\C:\Users\name\notes"]);
        assert_eq!(dirs(r"\\?\C:\Work\docs\a.md"), vec![r"\\?\C:\Work\docs", r"\\?\C:\Work"]);
        assert_eq!(dirs(r"\\?\UNC\server\share\docs\a.md"), vec![r"\\?\UNC\server\share\docs"]);
    }
}
