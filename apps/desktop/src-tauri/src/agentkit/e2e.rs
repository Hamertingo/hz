//! End-to-end encryption: AES-256-GCM sealed strings, plus the ways a person carries the key.

use std::path::Path;

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::{anyhow, bail, Result};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine as _;
use rand::RngCore;
use sha2::{Digest, Sha256};

/// Shown in place of a message this device cannot open.
pub const PLACEHOLDER: &str = "Encrypted message. This device does not have the key to open it.";
const PREFIX: &str = "e1:";
const QR_PREFIX: &str = "hzkey1:";
const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CHECK_BYTES: usize = 4;

/// A 32-byte account key.
#[derive(Clone, PartialEq, Eq)]
pub struct Key([u8; 32]);

impl std::fmt::Debug for Key {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Key(redacted)")
    }
}

fn checksum(key: &[u8; 32]) -> [u8; CHECK_BYTES] {
    let h = Sha256::digest(key);
    let mut c = [0u8; CHECK_BYTES];
    c.copy_from_slice(&h[..CHECK_BYTES]);
    c
}

fn b32_encode(bytes: &[u8]) -> String {
    let mut out = String::new();
    let (mut acc, mut bits) = (0u32, 0u32);
    for &b in bytes {
        acc = (acc << 8) | u32::from(b);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(ALPHABET[((acc >> bits) & 31) as usize] as char);
        }
    }
    if bits > 0 {
        out.push(ALPHABET[((acc << (5 - bits)) & 31) as usize] as char);
    }
    out
}

fn b32_decode(s: &str, byte_len: usize) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let (mut acc, mut bits) = (0u32, 0u32);
    for c in s.chars() {
        let up = match c.to_ascii_uppercase() {
            'O' => '0',
            'I' | 'L' => '1',
            u => u,
        };
        let v = ALPHABET.iter().position(|&a| a as char == up)? as u32;
        acc = (acc << 5) | v;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            out.push(((acc >> bits) & 0xff) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    // Leftover bits are padding and must be zero, or the code was altered.
    if out.len() != byte_len || acc != 0 {
        return None;
    }
    Some(out)
}

impl Key {
    /// A fresh random key.
    pub fn generate() -> Key {
        let mut k = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut k);
        Key(k)
    }

    /// The raw key bytes, for callers that store the key in a keychain.
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    /// Builds a key from raw bytes.
    pub fn from_bytes(b: [u8; 32]) -> Key {
        Key(b)
    }

    /// The key as groups of five characters with a built-in checksum, for writing down.
    pub fn to_recovery_code(&self) -> String {
        let mut raw = self.0.to_vec();
        raw.extend_from_slice(&checksum(&self.0));
        let s = b32_encode(&raw);
        s.as_bytes().chunks(5).map(|c| std::str::from_utf8(c).unwrap_or("")).collect::<Vec<_>>().join("-")
    }

    /// Reads a recovery code back; spaces, dashes and case are ignored and a typo is rejected by the checksum.
    pub fn from_recovery_code(code: &str) -> Result<Key> {
        let flat: String = code.chars().filter(|c| !c.is_whitespace() && *c != '-').collect();
        let raw = b32_decode(&flat, 32 + CHECK_BYTES).ok_or_else(|| anyhow!("that recovery code is not valid"))?;
        let mut k = [0u8; 32];
        k.copy_from_slice(&raw[..32]);
        if raw[32..] != checksum(&k) {
            bail!("that recovery code has a typo");
        }
        Ok(Key(k))
    }

    /// The text to put in a QR code so a second device can import the key.
    pub fn to_qr_payload(&self) -> String {
        format!("{QR_PREFIX}{}", URL_SAFE_NO_PAD.encode(self.0))
    }

    /// Reads a scanned QR payload.
    pub fn from_qr_payload(s: &str) -> Result<Key> {
        let body = s.trim().strip_prefix(QR_PREFIX).ok_or_else(|| anyhow!("not a key code"))?;
        let raw = URL_SAFE_NO_PAD.decode(body).map_err(|_| anyhow!("not a key code"))?;
        let k: [u8; 32] = raw.try_into().map_err(|_| anyhow!("not a key code"))?;
        Ok(Key(k))
    }
}

fn cipher(key: &Key) -> Aes256Gcm {
    Aes256Gcm::new((&key.0).into())
}

/// Encrypts to `e1:` + base64(nonce, ciphertext, tag); `aad` is bound to the message but not stored in it.
pub fn seal(key: &Key, plaintext: &str, aad: &[u8]) -> Result<String> {
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    let ct = cipher(key)
        .encrypt(Nonce::from_slice(&nonce), Payload { msg: plaintext.as_bytes(), aad })
        .map_err(|_| anyhow!("could not encrypt"))?;
    let mut all = nonce.to_vec();
    all.extend_from_slice(&ct);
    Ok(format!("{PREFIX}{}", STANDARD.encode(all)))
}

/// Decrypts a sealed string; a wrong key, wrong `aad`, tampering or truncation all fail the same way.
pub fn open(key: &Key, sealed: &str, aad: &[u8]) -> Result<String> {
    let fail = || anyhow!("could not open the message");
    let body = sealed.strip_prefix(PREFIX).ok_or_else(fail)?;
    let raw = STANDARD.decode(body).map_err(|_| fail())?;
    if raw.len() < 12 + 16 {
        return Err(fail());
    }
    let (nonce, ct) = raw.split_at(12);
    let pt = cipher(key).decrypt(Nonce::from_slice(nonce), Payload { msg: ct, aad }).map_err(|_| fail())?;
    String::from_utf8(pt).map_err(|_| fail())
}

/// Whether the text is in the sealed format.
pub fn is_sealed(s: &str) -> bool {
    s.starts_with(PREFIX)
}

/// Writes the key to `path` readable by its owner only.
pub fn save_key(path: &Path, key: &Key) -> Result<()> {
    use std::io::Write;
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p)?;
    }
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // An older file keeps its old mode through `open`, so set it again.
        f.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    }
    f.write_all(key.to_qr_payload().as_bytes())?;
    Ok(())
}

/// Reads a saved key; `None` when there is no file.
pub fn load_key(path: &Path) -> Result<Option<Key>> {
    match std::fs::read_to_string(path) {
        Ok(s) => Key::from_qr_payload(&s).map(Some),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("hz-e2e-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn seal_open_roundtrip() {
        let k = Key::generate();
        let s = seal(&k, "hello ünï", b"chat-1").unwrap();
        assert!(is_sealed(&s));
        assert_eq!(open(&k, &s, b"chat-1").unwrap(), "hello ünï");
    }

    #[test]
    fn same_text_seals_differently() {
        let k = Key::generate();
        assert_ne!(seal(&k, "a", b"").unwrap(), seal(&k, "a", b"").unwrap());
    }

    #[test]
    fn wrong_key_or_aad_fails() {
        let k = Key::generate();
        let s = seal(&k, "x", b"a").unwrap();
        assert!(open(&Key::generate(), &s, b"a").is_err());
        assert!(open(&k, &s, b"b").is_err());
    }

    #[test]
    fn tamper_and_truncation_fail() {
        let k = Key::generate();
        let s = seal(&k, "secret", b"").unwrap();
        let mut raw = STANDARD.decode(&s[3..]).unwrap();
        let last = raw.len() - 1;
        raw[last] ^= 1;
        assert!(open(&k, &format!("e1:{}", STANDARD.encode(&raw)), b"").is_err());
        raw[last] ^= 1;
        raw.truncate(raw.len() - 3);
        assert!(open(&k, &format!("e1:{}", STANDARD.encode(&raw)), b"").is_err());
        assert!(open(&k, "e1:AAAA", b"").is_err());
        assert!(open(&k, "e1:!!!", b"").is_err());
        assert!(open(&k, "plain", b"").is_err());
    }

    #[test]
    fn empty_plaintext_works() {
        let k = Key::generate();
        assert_eq!(open(&k, &seal(&k, "", b"").unwrap(), b"").unwrap(), "");
    }

    #[test]
    fn recovery_code_roundtrip() {
        let k = Key::generate();
        let code = k.to_recovery_code();
        assert!(code.contains('-'));
        assert_eq!(Key::from_recovery_code(&code).unwrap(), k);
        let messy = format!("  {}  ", code.to_lowercase().replace('-', " "));
        assert_eq!(Key::from_recovery_code(&messy).unwrap(), k);
    }

    #[test]
    fn recovery_code_rejects_typos() {
        let k = Key::generate();
        let code = k.to_recovery_code();
        let mut chars: Vec<char> = code.chars().collect();
        let i = chars.iter().position(|c| *c != '-').unwrap();
        chars[i] = if chars[i] == 'A' { 'B' } else { 'A' };
        let bad: String = chars.into_iter().collect();
        assert!(Key::from_recovery_code(&bad).is_err());
        assert!(Key::from_recovery_code("").is_err());
        assert!(Key::from_recovery_code("U-U-U").is_err());
        assert!(Key::from_recovery_code(&code[..code.len() - 6]).is_err());
    }

    #[test]
    fn qr_roundtrip_and_rejects() {
        let k = Key::generate();
        let p = k.to_qr_payload();
        assert!(p.starts_with("hzkey1:"));
        assert_eq!(Key::from_qr_payload(&p).unwrap(), k);
        assert!(Key::from_qr_payload("hzkey1:AAAA").is_err());
        assert!(Key::from_qr_payload("other:AAAA").is_err());
    }

    #[test]
    fn key_debug_hides_bytes() {
        assert_eq!(format!("{:?}", Key::generate()), "Key(redacted)");
    }

    #[test]
    fn key_file_roundtrip_with_private_mode() {
        let p = tmp().join("k");
        assert!(load_key(&p).unwrap().is_none());
        let k = Key::generate();
        save_key(&p, &k).unwrap();
        assert_eq!(load_key(&p).unwrap().unwrap(), k);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o600);
        }
    }
}
