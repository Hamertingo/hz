//! An audio message from the agent: where it is saved, what the chat shows (the transcript), and which voice a platform starts with.

use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Folder under the workspace that holds the audio files.
pub const FOLDER: &str = "audios";

/// Keeps letters, digits, `-` and `_`; everything else becomes `_`, so a name cannot climb out of its folder.
pub fn sanitise_for_file(raw: &str) -> String {
    let s: String = raw.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
    let s = s.trim_matches('_');
    if s.is_empty() { "agent".into() } else { s.chars().take(48).collect() }
}

/// `<workspace>/audios/<agent>-<yyyymmdd-hhmmss>.wav`.
pub fn memo_path(workspace: &Path, agent: &str, now: DateTime<Utc>) -> PathBuf {
    workspace.join(FOLDER).join(format!("{}-{}.wav", sanitise_for_file(agent), now.format("%Y%m%d-%H%M%S")))
}

/// An audio message with the words it says.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Memo {
    pub path: PathBuf,
    pub transcript: String,
    pub duration_ms: u64,
}

impl Memo {
    /// A memo whose transcript is trimmed; an empty transcript is refused because the chat body would be blank.
    pub fn new(path: PathBuf, transcript: &str, duration_ms: u64) -> anyhow::Result<Self> {
        let transcript = transcript.trim().to_string();
        if transcript.is_empty() {
            anyhow::bail!("a voice message needs its transcript");
        }
        Ok(Self { path, transcript, duration_ms })
    }

    /// The message as the chat stores it: kind `voice`, body = the transcript.
    pub fn message(&self) -> serde_json::Value {
        serde_json::json!({
            "kind": "voice",
            "body": self.transcript,
            "path": self.path,
            "duration_ms": self.duration_ms,
        })
    }
}

/// Length of a PCM WAV file in milliseconds, read from its header; None if it is not a WAV we understand.
pub fn wav_duration_ms(bytes: &[u8]) -> Option<u64> {
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return None;
    }
    let mut byte_rate = 0u64;
    let mut pos = 12;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().ok()?) as u64;
        if id == b"fmt " && pos + 20 <= bytes.len() {
            byte_rate = u32::from_le_bytes(bytes[pos + 16..pos + 20].try_into().ok()?) as u64;
        } else if id == b"data" {
            let avail = (bytes.len() - pos - 8) as u64;
            // Streaming writers leave 0 or 0xFFFFFFFF here; trust the bytes actually present.
            let n = if size == 0 || size > avail { avail } else { size };
            return (byte_rate > 0).then(|| n * 1000 / byte_rate);
        }
        pos += 8 + size as usize + (size as usize & 1);
    }
    None
}

/// A starting voice for a platform.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoiceChoice {
    pub engine: &'static str,
    pub voice: &'static str,
}

/// The voice to start with on `os` / `arch` (values of `std::env::consts`): a local neural voice where the machine can run one, the system voice otherwise.
pub fn default_voice(os: &str, arch: &str) -> VoiceChoice {
    match (os, arch) {
        ("macos", "aarch64") => VoiceChoice { engine: "kokoro", voice: "af_heart" },
        ("macos", _) => VoiceChoice { engine: "say", voice: "Samantha" },
        ("windows", _) => VoiceChoice { engine: "sapi", voice: "Microsoft Zira" },
        _ => VoiceChoice { engine: "espeak-ng", voice: "en-us" },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn wav(rate: u32, data_len: usize, declared: u32) -> Vec<u8> {
        let mut v = b"RIFF\0\0\0\0WAVEfmt ".to_vec();
        v.extend(16u32.to_le_bytes());
        v.extend([1, 0, 1, 0]);
        v.extend((rate / 2).to_le_bytes());
        v.extend(rate.to_le_bytes());
        v.extend([2, 0, 16, 0]);
        v.extend(b"data");
        v.extend(declared.to_le_bytes());
        v.extend(vec![0u8; data_len]);
        v
    }

    #[test]
    fn path_is_under_audios_with_stamp() {
        let now = Utc.with_ymd_and_hms(2026, 3, 4, 5, 6, 7).unwrap();
        assert_eq!(memo_path(Path::new("/w"), "Ana", now), PathBuf::from("/w/audios/Ana-20260304-050607.wav"));
    }

    #[test]
    fn sanitise() {
        assert_eq!(sanitise_for_file("../x/y"), "x_y");
        assert_eq!(sanitise_for_file("é ü"), "agent");
        assert_eq!(sanitise_for_file("ok-name_1"), "ok-name_1");
        assert_eq!(sanitise_for_file(&"a".repeat(99)).len(), 48);
    }

    #[test]
    fn traversal_name_stays_inside() {
        let p = memo_path(Path::new("/w"), "../../etc", Utc::now());
        assert!(p.starts_with("/w/audios"));
        assert!(!p.to_string_lossy().contains(".."));
    }

    #[test]
    fn memo_body_is_the_transcript() {
        let m = Memo::new("/w/audios/a.wav".into(), "  Hello there \n", 1200).unwrap();
        let j = m.message();
        assert_eq!(j["kind"], "voice");
        assert_eq!(j["body"], "Hello there");
        assert_eq!(j["duration_ms"], 1200);
    }

    #[test]
    fn empty_transcript_is_refused() {
        assert!(Memo::new("/a".into(), "  \n", 5).is_err());
    }

    #[test]
    fn wav_duration_from_header() {
        assert_eq!(wav_duration_ms(&wav(16000, 16000, 16000)), Some(1000));
        assert_eq!(wav_duration_ms(&wav(16000, 8000, 0)), Some(500));
        assert_eq!(wav_duration_ms(&wav(16000, 8000, u32::MAX)), Some(500));
    }

    #[test]
    fn wav_garbage_is_none() {
        assert_eq!(wav_duration_ms(b"nope"), None);
        assert_eq!(wav_duration_ms(&[0u8; 100]), None);
        let mut no_data = wav(16000, 0, 0);
        no_data.truncate(36);
        assert_eq!(wav_duration_ms(&no_data), None);
    }

    #[test]
    fn default_voice_per_platform() {
        assert_eq!(default_voice("macos", "aarch64").engine, "kokoro");
        assert_eq!(default_voice("macos", "x86_64").engine, "say");
        assert_eq!(default_voice("windows", "x86_64").engine, "sapi");
        assert_eq!(default_voice("linux", "x86_64").engine, "espeak-ng");
        assert_eq!(default_voice("freebsd", "x86_64"), default_voice("linux", "aarch64"));
    }
}
