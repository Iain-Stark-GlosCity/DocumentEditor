//! Pure text-file logic: encoding, BOM and line-ending detection and the exact inverse.
//! No dependency on `tauri`, so it is unit tested with plain `cargo test`.

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Encoding {
    #[serde(rename = "utf-8")]
    Utf8,
    #[serde(rename = "utf-16le")]
    Utf16Le,
    #[serde(rename = "utf-16be")]
    Utf16Be,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Eol {
    Lf,
    Crlf,
}

/// Mirrors the TypeScript `FileFormat` field for field.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct FileFormat {
    pub encoding: Encoding,
    pub bom: bool,
    pub eol: Eol,
    #[serde(rename = "mixedEol")]
    pub mixed_eol: bool,
}

#[derive(Error, Debug, PartialEq, Eq)]
pub enum DecodeError {
    #[error("the file is not valid UTF-8")]
    InvalidUtf8,
    #[error("the file is not valid UTF-16")]
    InvalidUtf16,
}

const BOM_UTF8: [u8; 3] = [0xEF, 0xBB, 0xBF];
const BOM_UTF16LE: [u8; 2] = [0xFF, 0xFE];
const BOM_UTF16BE: [u8; 2] = [0xFE, 0xFF];

/// Decode file bytes to text with `\n` line endings, plus the format needed to write it back.
pub fn decode(bytes: &[u8]) -> Result<(String, FileFormat), DecodeError> {
    let (encoding, bom, body) = if bytes.starts_with(&BOM_UTF8) {
        (Encoding::Utf8, true, &bytes[3..])
    } else if bytes.starts_with(&BOM_UTF16LE) {
        (Encoding::Utf16Le, true, &bytes[2..])
    } else if bytes.starts_with(&BOM_UTF16BE) {
        (Encoding::Utf16Be, true, &bytes[2..])
    } else {
        (Encoding::Utf8, false, bytes)
    };

    let raw: String = match encoding {
        Encoding::Utf8 => std::str::from_utf8(body)
            .map_err(|_| DecodeError::InvalidUtf8)?
            .to_owned(),
        Encoding::Utf16Le => decode_utf16(body, u16::from_le_bytes)?,
        Encoding::Utf16Be => decode_utf16(body, u16::from_be_bytes)?,
    };

    let crlf = raw.matches("\r\n").count();
    let lf = raw.matches('\n').count() - crlf;
    let eol = if crlf == 0 && lf > 0 { Eol::Lf } else if lf > crlf { Eol::Lf } else { Eol::Crlf };
    let mixed_eol = crlf > 0 && lf > 0;
    let text = if crlf > 0 { raw.replace("\r\n", "\n") } else { raw };

    Ok((text, FileFormat { encoding, bom, eol, mixed_eol }))
}

fn decode_utf16(body: &[u8], to_u16: fn([u8; 2]) -> u16) -> Result<String, DecodeError> {
    if body.len() % 2 != 0 {
        return Err(DecodeError::InvalidUtf16);
    }
    let units = body.chunks_exact(2).map(|c| to_u16([c[0], c[1]]));
    char::decode_utf16(units)
        .collect::<Result<String, _>>()
        .map_err(|_| DecodeError::InvalidUtf16)
}

/// Encode `\n` text back to bytes using the stored format. Exact inverse of `decode` for
/// files that did not mix line endings; mixed files are normalised to `format.eol`.
pub fn encode(text: &str, format: &FileFormat) -> Vec<u8> {
    let with_eol;
    let body: &str = match format.eol {
        Eol::Lf => text,
        Eol::Crlf => {
            with_eol = text.replace('\n', "\r\n");
            &with_eol
        }
    };

    let mut out = Vec::with_capacity(body.len() + 3);
    match format.encoding {
        Encoding::Utf8 => {
            if format.bom {
                out.extend_from_slice(&BOM_UTF8);
            }
            out.extend_from_slice(body.as_bytes());
        }
        Encoding::Utf16Le => {
            if format.bom {
                out.extend_from_slice(&BOM_UTF16LE);
            }
            for u in body.encode_utf16() {
                out.extend_from_slice(&u.to_le_bytes());
            }
        }
        Encoding::Utf16Be => {
            if format.bom {
                out.extend_from_slice(&BOM_UTF16BE);
            }
            for u in body.encode_utf16() {
                out.extend_from_slice(&u.to_be_bytes());
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const ENCODINGS: [Encoding; 3] = [Encoding::Utf8, Encoding::Utf16Le, Encoding::Utf16Be];

    fn fmt(encoding: Encoding, bom: bool, eol: Eol) -> FileFormat {
        FileFormat { encoding, bom, eol, mixed_eol: false }
    }

    #[test]
    fn round_trips_every_encoding_bom_and_eol() {
        let samples = ["", "one line", "a\nb\nc\n", "héllo \u{1F600} wörld\nsecond\n"];
        for encoding in ENCODINGS {
            for bom in [false, true] {
                // UTF-16 without a BOM is indistinguishable from other data, so it is not
                // detected: only test BOM-less for UTF-8.
                if !bom && encoding != Encoding::Utf8 {
                    continue;
                }
                for eol in [Eol::Lf, Eol::Crlf] {
                    for sample in samples {
                        let f = fmt(encoding, bom, eol);
                        let bytes = encode(sample, &f);
                        let (text, got) = decode(&bytes).unwrap();
                        assert_eq!(text, sample);
                        assert_eq!(encode(&text, &got), bytes);
                        if sample.contains('\n') {
                            assert_eq!(got, f);
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn detects_boms() {
        assert_eq!(decode(&[0xEF, 0xBB, 0xBF, b'a']).unwrap().1.encoding, Encoding::Utf8);
        assert!(decode(&[0xEF, 0xBB, 0xBF, b'a']).unwrap().1.bom);
        let (t, f) = decode(&[0xFF, 0xFE, b'a', 0]).unwrap();
        assert_eq!((t.as_str(), f.encoding, f.bom), ("a", Encoding::Utf16Le, true));
        let (t, f) = decode(&[0xFE, 0xFF, 0, b'a']).unwrap();
        assert_eq!((t.as_str(), f.encoding, f.bom), ("a", Encoding::Utf16Be, true));
        let (_, f) = decode(b"plain").unwrap();
        assert!(!f.bom);
    }

    #[test]
    fn no_line_endings_defaults_to_crlf() {
        let (_, f) = decode(b"no newline").unwrap();
        assert_eq!(f.eol, Eol::Crlf);
        assert!(!f.mixed_eol);
        let (_, f) = decode(b"").unwrap();
        assert_eq!(f.eol, Eol::Crlf);
    }

    #[test]
    fn detects_dominant_eol_and_mixed() {
        let (t, f) = decode(b"a\nb\nc\r\n").unwrap();
        assert_eq!(t, "a\nb\nc\n");
        assert_eq!(f.eol, Eol::Lf);
        assert!(f.mixed_eol);
        let (_, f) = decode(b"a\r\nb\r\nc\n").unwrap();
        assert_eq!(f.eol, Eol::Crlf);
        assert!(f.mixed_eol);
        let (_, f) = decode(b"a\nb\n").unwrap();
        assert_eq!(f.eol, Eol::Lf);
        assert!(!f.mixed_eol);
    }

    #[test]
    fn mixed_files_normalise_to_dominant_eol() {
        let (t, f) = decode(b"a\nb\nc\r\n").unwrap();
        assert_eq!(encode(&t, &f), b"a\nb\nc\n");
    }

    #[test]
    fn rejects_invalid_utf8() {
        assert_eq!(decode(&[0x61, 0xFF, 0xFE, 0x62]), Err(DecodeError::InvalidUtf8));
        assert_eq!(decode(&[0xC3, 0x28]), Err(DecodeError::InvalidUtf8));
    }

    #[test]
    fn rejects_invalid_utf16() {
        // Odd length.
        assert_eq!(decode(&[0xFF, 0xFE, 0x61]), Err(DecodeError::InvalidUtf16));
        // Lone high surrogate.
        assert_eq!(decode(&[0xFF, 0xFE, 0x00, 0xD8]), Err(DecodeError::InvalidUtf16));
    }

    #[test]
    fn json_matches_typescript_type() {
        let f = FileFormat { encoding: Encoding::Utf16Le, bom: true, eol: Eol::Lf, mixed_eol: false };
        assert_eq!(
            serde_json::to_string(&f).unwrap(),
            r#"{"encoding":"utf-16le","bom":true,"eol":"lf","mixedEol":false}"#
        );
        let back: FileFormat = serde_json::from_str(
            r#"{"encoding":"utf-8","bom":false,"eol":"crlf","mixedEol":true}"#,
        )
        .unwrap();
        assert_eq!(back.encoding, Encoding::Utf8);
        assert!(back.mixed_eol);
    }
}
