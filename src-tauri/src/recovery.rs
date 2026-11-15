//! The crash-recovery snapshot record. Pure data, so it is tested without Tauri.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, PartialEq)]
pub struct RecoverySnapshot {
    pub id: String,
    pub path: Option<String>,
    pub text: String,
    #[serde(rename = "savedMs")]
    pub saved_ms: u64,
    /// The format the document was in. Absent in snapshots written by older versions.
    #[serde(rename = "providerId", default, skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
}

/// Writes a snapshot atomically. A plain write cut short (a crash or power loss, which is when
/// recovery matters) would leave a truncated file that replaced the last good snapshot.
pub fn write_snapshot(file: &std::path::Path, snapshot: &RecoverySnapshot) -> std::io::Result<()> {
    crate::atomic::atomic_write(file, &serde_json::to_vec(snapshot)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_snapshots_whole_and_leaves_only_the_json_file() {
        let dir = std::env::temp_dir().join(format!("docedit-recovery-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("rec-a.json");
        let mut s = RecoverySnapshot {
            id: "rec-a".into(),
            path: None,
            text: "x".repeat(10_000),
            saved_ms: 1,
            provider_id: None,
        };
        write_snapshot(&file, &s).unwrap();
        s.text = "short".into();
        write_snapshot(&file, &s).unwrap();
        let back: RecoverySnapshot = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
        assert_eq!(back, s);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn old_snapshot_without_provider_id_still_loads() {
        let old = r#"{"id":"a","path":null,"text":"hi","savedMs":5}"#;
        let s: RecoverySnapshot = serde_json::from_str(old).unwrap();
        assert_eq!(s.provider_id, None);
        assert_eq!(s.saved_ms, 5);
    }

    #[test]
    fn provider_id_round_trips() {
        let s = RecoverySnapshot {
            id: "a".into(),
            path: Some("/x.txt".into()),
            text: "t".into(),
            saved_ms: 7,
            provider_id: Some("markdown".into()),
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains(r#""providerId":"markdown""#));
        assert_eq!(serde_json::from_str::<RecoverySnapshot>(&json).unwrap(), s);
    }

    #[test]
    fn absent_provider_id_is_not_written() {
        let s = RecoverySnapshot {
            id: "a".into(),
            path: None,
            text: String::new(),
            saved_ms: 1,
            provider_id: None,
        };
        assert!(!serde_json::to_string(&s).unwrap().contains("providerId"));
    }
}
