//! Push notices to a phone through Bark. By default the push says only who and what kind.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::{anyhow, bail, Result};
use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use rand::distributions::Alphanumeric;
use rand::Rng;
use serde_json::{json, Value};

/// Where and how to push.
#[derive(Clone)]
pub struct BarkConfig {
    pub server: String,
    pub device_key: String,
    /// Exactly 32 characters; used as the AES-256 key.
    pub encrypt_key: Option<String>,
}

impl std::fmt::Debug for BarkConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BarkConfig")
            .field("server", &self.server)
            .field("device_key", &"redacted")
            .field("encrypt_key", &self.encrypt_key.as_ref().map(|_| "redacted"))
            .finish()
    }
}

/// What kind of thing happened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Finished,
    Question,
    Approval,
    /// The agent wants the person to take over its screen (a sign-in, a CAPTCHA, a payment).
    Takeover,
}

/// One event worth a buzz.
#[derive(Debug, Clone)]
pub struct Notice {
    pub who: String,
    pub kind: Kind,
    pub text: String,
}

/// A ready HTTP POST: JSON body to the URL.
#[derive(Debug, Clone, PartialEq)]
pub struct Request {
    pub url: String,
    pub body_json: Value,
}

/// Sends a prepared request; tests plug in a fake.
pub trait Poster {
    /// POSTs the JSON body to the URL.
    fn post(&self, url: &str, body: &Value) -> Result<()>;
}

fn generic_line(n: &Notice) -> String {
    match n.kind {
        Kind::Finished => format!("{} finished", n.who),
        Kind::Question => format!("{} has a question", n.who),
        Kind::Approval => format!("{} needs approval", n.who),
        Kind::Takeover => format!("{} needs you to take over", n.who),
    }
}

/// Builds the push. Without `full_text`, or without an encrypt key, the body is only "who and what kind":
/// the real text never travels in the clear. With both, the body carries no title or text; instead
/// `ciphertext` is base64(AES-256-GCM of `{"title","body"}` JSON, tag appended) and `iv` is the 12 ASCII
/// characters used as nonce, which is how Bark decrypts a pushed message.
pub fn build_request(cfg: &BarkConfig, notice: &Notice, full_text: bool) -> Result<Request> {
    let server = url::Url::parse(cfg.server.trim()).map_err(|_| anyhow!("bad Bark server address"))?;
    if !matches!(server.scheme(), "http" | "https") {
        bail!("Bark server must be http or https");
    }
    if cfg.device_key.is_empty() || !cfg.device_key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        bail!("bad Bark device key");
    }
    let url = format!("{}/push", server.as_str().trim_end_matches('/'));
    let who = notice.who.trim();
    let body_json = match (&cfg.encrypt_key, full_text) {
        (Some(key), true) => {
            if key.len() != 32 {
                bail!("Bark encrypt key must be 32 characters");
            }
            let iv: String = rand::thread_rng().sample_iter(&Alphanumeric).take(12).map(char::from).collect();
            let plain = json!({ "title": who, "body": notice.text }).to_string();
            let ct = Aes256Gcm::new_from_slice(key.as_bytes())
                .map_err(|_| anyhow!("bad encrypt key"))?
                .encrypt(Nonce::from_slice(iv.as_bytes()), plain.as_bytes())
                .map_err(|_| anyhow!("could not encrypt"))?;
            json!({
                "device_key": cfg.device_key,
                "ciphertext": STANDARD.encode(ct),
                "iv": iv,
                "group": "hz",
            })
        }
        _ => json!({
            "device_key": cfg.device_key,
            "title": "Hz",
            "body": generic_line(&Notice { who: who.into(), ..notice.clone() }),
            "group": "hz",
        }),
    };
    Ok(Request { url, body_json })
}

/// Builds and sends a push through `poster`.
pub fn send(poster: &dyn Poster, cfg: &BarkConfig, notice: &Notice, full_text: bool) -> Result<()> {
    let r = build_request(cfg, notice, full_text)?;
    poster.post(&r.url, &r.body_json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn cfg(enc: Option<&str>) -> BarkConfig {
        BarkConfig { server: "https://api.day.app/".into(), device_key: "abc123".into(), encrypt_key: enc.map(String::from) }
    }
    fn notice(kind: Kind) -> Notice {
        Notice { who: "Leo".into(), kind, text: "the bank password is hunter2".into() }
    }
    const KEY: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn default_says_only_who_and_kind() {
        let r = build_request(&cfg(None), &notice(Kind::Question), false).unwrap();
        assert_eq!(r.url, "https://api.day.app/push");
        assert_eq!(r.body_json["body"], "Leo has a question");
        assert!(!r.body_json.to_string().contains("hunter2"));
    }

    #[test]
    fn kinds_have_their_own_wording() {
        let f = build_request(&cfg(None), &notice(Kind::Finished), false).unwrap();
        let a = build_request(&cfg(None), &notice(Kind::Approval), false).unwrap();
        assert_eq!(f.body_json["body"], "Leo finished");
        assert_eq!(a.body_json["body"], "Leo needs approval");
        let t = build_request(&cfg(None), &notice(Kind::Takeover), false).unwrap();
        assert_eq!(t.body_json["body"], "Leo needs you to take over");
    }

    #[test]
    fn full_text_without_key_stays_generic() {
        let r = build_request(&cfg(None), &notice(Kind::Finished), true).unwrap();
        assert!(!r.body_json.to_string().contains("hunter2"));
        assert!(r.body_json.get("ciphertext").is_none());
    }

    #[test]
    fn full_text_with_key_is_encrypted_and_decryptable() {
        let r = build_request(&cfg(Some(KEY)), &notice(Kind::Question), true).unwrap();
        let s = r.body_json.to_string();
        assert!(!s.contains("hunter2") && !s.contains(KEY));
        assert!(r.body_json.get("body").is_none());
        let iv = r.body_json["iv"].as_str().unwrap();
        assert_eq!(iv.len(), 12);
        let ct = STANDARD.decode(r.body_json["ciphertext"].as_str().unwrap()).unwrap();
        let pt = Aes256Gcm::new_from_slice(KEY.as_bytes()).unwrap().decrypt(Nonce::from_slice(iv.as_bytes()), ct.as_ref()).unwrap();
        let v: Value = serde_json::from_slice(&pt).unwrap();
        assert_eq!(v["body"], "the bank password is hunter2");
        assert_eq!(v["title"], "Leo");
    }

    #[test]
    fn short_key_is_an_error() {
        assert!(build_request(&cfg(Some("short")), &notice(Kind::Finished), true).is_err());
    }

    #[test]
    fn bad_server_or_device_key_rejected() {
        let mut c = cfg(None);
        c.server = "ftp://x".into();
        assert!(build_request(&c, &notice(Kind::Finished), false).is_err());
        c.server = "not a url".into();
        assert!(build_request(&c, &notice(Kind::Finished), false).is_err());
        let mut c = cfg(None);
        c.device_key = "a/b?x".into();
        assert!(build_request(&c, &notice(Kind::Finished), false).is_err());
        c.device_key = String::new();
        assert!(build_request(&c, &notice(Kind::Finished), false).is_err());
    }

    #[test]
    fn debug_never_prints_keys() {
        let s = format!("{:?}", cfg(Some(KEY)));
        assert!(!s.contains(KEY) && !s.contains("abc123"));
    }

    #[test]
    fn send_goes_through_poster() {
        struct P(RefCell<Vec<(String, Value)>>);
        impl Poster for P {
            fn post(&self, url: &str, body: &Value) -> Result<()> {
                self.0.borrow_mut().push((url.into(), body.clone()));
                Ok(())
            }
        }
        let p = P(RefCell::new(vec![]));
        send(&p, &cfg(None), &notice(Kind::Finished), false).unwrap();
        assert_eq!(p.0.borrow().len(), 1);
        assert_eq!(p.0.borrow()[0].0, "https://api.day.app/push");
    }

    #[test]
    fn who_is_trimmed() {
        let n = Notice { who: "  Leo ".into(), kind: Kind::Finished, text: String::new() };
        assert_eq!(build_request(&cfg(None), &n, false).unwrap().body_json["body"], "Leo finished");
    }
}
