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

#[cfg(test)]
mod tests {
    use super::*;

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
