//! A read-only local API for connected apps. Keys are shown once and only their sha256 is kept.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use rand::distributions::Alphanumeric;
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// A stored key record; the plaintext key is never here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeyInfo {
    pub id: String,
    pub label: String,
    /// Lowercase hex sha256 of the key.
    pub hash: String,
    /// Unix seconds; chrono's serde support is not enabled in this build.
    pub created: i64,
}

/// The set of keys, with last-use times kept in a second file so a read does not rewrite the keys.
#[derive(Debug)]
pub struct AppKeys {
    path: PathBuf,
    used_path: PathBuf,
    keys: Vec<KeyInfo>,
    used: BTreeMap<String, i64>,
}

fn hash_key(key: &str) -> String {
    Sha256::digest(key.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// Compares two byte strings without stopping at the first difference.
fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn write_json<T: Serialize>(path: &Path, v: &T) -> Result<()> {
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(v)?)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

fn read_json<T: Default + for<'de> Deserialize<'de>>(path: &Path) -> Result<T> {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).with_context(|| format!("{} is not valid", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(e) => Err(e.into()),
    }
}

impl AppKeys {
    /// Loads keys from `path`; last-use times live in `<path>.used`.
    pub fn open(path: &Path) -> Result<Self> {
        let mut used_name = path.as_os_str().to_owned();
        used_name.push(".used");
        let used_path = PathBuf::from(used_name);
        Ok(AppKeys {
            path: path.to_path_buf(),
            keys: read_json(path)?,
            used: read_json(&used_path)?,
            used_path,
        })
    }

    /// Makes a key and returns (id, plaintext); the plaintext is not recoverable afterwards.
    pub fn create(&mut self, label: &str) -> Result<(String, String)> {
        let rnd = |n: usize| -> String { rand::thread_rng().sample_iter(&Alphanumeric).take(n).map(char::from).collect() };
        let id = rnd(10).to_lowercase();
        let key = format!("hzk_{}", rnd(40));
        self.keys.push(KeyInfo {
            id: id.clone(),
            label: label.trim().chars().take(60).collect(),
            hash: hash_key(&key),
            created: Utc::now().timestamp(),
        });
        write_json(&self.path, &self.keys)?;
        Ok((id, key))
    }

    /// The id of the key that matches, or `None`. Every stored hash is compared so timing does not reveal a near match.
    pub fn verify(&self, key: &str) -> Option<String> {
        let h = hash_key(key);
        let mut found = None;
        for k in &self.keys {
            if ct_eq(k.hash.as_bytes(), h.as_bytes()) {
                found = Some(k.id.clone());
            }
        }
        found
    }

    /// Deletes a key so it stops working; false when the id is unknown.
    pub fn revoke(&mut self, id: &str) -> Result<bool> {
        let before = self.keys.len();
        self.keys.retain(|k| k.id != id);
        if self.keys.len() == before {
            return Ok(false);
        }
        self.used.remove(id);
        write_json(&self.path, &self.keys)?;
        write_json(&self.used_path, &self.used)?;
        Ok(true)
    }

    /// Records when a key was last used.
    pub fn touch(&mut self, id: &str, now: DateTime<Utc>) -> Result<()> {
        if self.keys.iter().any(|k| k.id == id) {
            self.used.insert(id.into(), now.timestamp());
            write_json(&self.used_path, &self.used)?;
        }
        Ok(())
    }

    /// When a key was last used.
    pub fn last_used(&self, id: &str) -> Option<DateTime<Utc>> {
        self.used.get(id).and_then(|t| DateTime::from_timestamp(*t, 0))
    }

    /// All keys, oldest first.
    pub fn list(&self) -> &[KeyInfo] {
        &self.keys
    }
}

/// Where a request goes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Route {
    Agents,
    Memories(String),
    Live,
    NotFound,
    MethodNotAllowed,
}

/// Maps method and path to a route. Only GET reads; any other verb on a known path is refused.
pub fn route(method: &str, path: &str) -> Route {
    let path = path.split(['?', '#']).next().unwrap_or("");
    let segs: Vec<&str> = path.trim_matches('/').split('/').collect();
    let known = match segs.as_slice() {
        ["v1", "agents"] => Some(Route::Agents),
        ["v1", "live"] => Some(Route::Live),
        ["v1", "agents", id, "memories"] if !id.is_empty() && *id != "." && *id != ".." => Some(Route::Memories((*id).to_string())),
        _ => None,
    };
    match known {
        None => Route::NotFound,
        Some(_) if !method.eq_ignore_ascii_case("GET") => Route::MethodNotAllowed,
        Some(r) => r,
    }
}

/// The token in an `Authorization: Bearer <token>` value; the scheme name is case-insensitive.
pub fn bearer_token(header: &str) -> Option<&str> {
    let h = header.trim();
    let (scheme, rest) = h.split_once(char::is_whitespace)?;
    let tok = rest.trim();
    (scheme.eq_ignore_ascii_case("bearer") && !tok.is_empty() && !tok.contains(char::is_whitespace)).then_some(tok)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        std::env::temp_dir().join(format!("hz-keys-{}", uuid::Uuid::new_v4())).join("keys.json")
    }

    #[test]
    fn create_verify_revoke() {
        let mut k = AppKeys::open(&tmp()).unwrap();
        let (id, key) = k.create("Notes app").unwrap();
        assert!(key.starts_with("hzk_"));
        assert_eq!(k.verify(&key), Some(id.clone()));
        assert_eq!(k.verify("hzk_wrong"), None);
        assert_eq!(k.verify(""), None);
        assert!(k.revoke(&id).unwrap());
        assert_eq!(k.verify(&key), None);
        assert!(!k.revoke(&id).unwrap());
    }

    #[test]
    fn only_the_hash_is_stored() {
        let p = tmp();
        let mut k = AppKeys::open(&p).unwrap();
        let (_, key) = k.create("a").unwrap();
        let text = std::fs::read_to_string(&p).unwrap();
        assert!(!text.contains(&key));
        assert!(text.contains(&hash_key(&key)));
        assert_eq!(hash_key(&key).len(), 64);
    }

    #[test]
    fn persists_across_open() {
        let p = tmp();
        let key = {
            let mut k = AppKeys::open(&p).unwrap();
            k.create("a").unwrap().1
        };
        let k2 = AppKeys::open(&p).unwrap();
        assert!(k2.verify(&key).is_some());
        assert_eq!(k2.list()[0].label, "a");
    }

    #[test]
    fn two_keys_are_independent() {
        let mut k = AppKeys::open(&tmp()).unwrap();
        let (a, ka) = k.create("a").unwrap();
        let (b, kb) = k.create("b").unwrap();
        assert_ne!(ka, kb);
        assert_eq!(k.verify(&kb), Some(b));
        k.revoke(&a).unwrap();
        assert!(k.verify(&kb).is_some());
    }

    #[test]
    fn touch_is_stored_separately() {
        let p = tmp();
        let mut k = AppKeys::open(&p).unwrap();
        let (id, _) = k.create("a").unwrap();
        let before = std::fs::read_to_string(&p).unwrap();
        let now = DateTime::from_timestamp(Utc::now().timestamp(), 0).unwrap();
        k.touch(&id, now).unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), before);
        assert_eq!(AppKeys::open(&p).unwrap().last_used(&id), Some(now));
        k.touch("ghost", now).unwrap();
        assert!(k.last_used("ghost").is_none());
    }

    #[test]
    fn constant_time_compare() {
        assert!(ct_eq(b"abc", b"abc"));
        assert!(!ct_eq(b"abc", b"abd"));
        assert!(!ct_eq(b"abc", b"ab"));
    }

    #[test]
    fn routes() {
        assert_eq!(route("GET", "/v1/agents"), Route::Agents);
        assert_eq!(route("get", "/v1/agents/"), Route::Agents);
        assert_eq!(route("GET", "/v1/agents/leo/memories?limit=5"), Route::Memories("leo".into()));
        assert_eq!(route("GET", "/v1/live"), Route::Live);
    }

    #[test]
    fn writes_are_refused() {
        for m in ["POST", "PUT", "PATCH", "DELETE"] {
            assert_eq!(route(m, "/v1/agents"), Route::MethodNotAllowed);
            assert_eq!(route(m, "/v1/agents/leo/memories"), Route::MethodNotAllowed);
        }
        assert_eq!(route("POST", "/nope"), Route::NotFound);
    }

    #[test]
    fn odd_paths_are_not_found() {
        for p in ["/", "/v1", "/v2/agents", "/v1/agents/leo", "/v1/agents//memories", "/v1/agents/../memories", "/v1/agents/a/memories/x"] {
            assert_eq!(route("GET", p), Route::NotFound, "{p}");
        }
    }

    #[test]
    fn bearer_parsing() {
        assert_eq!(bearer_token("Bearer abc"), Some("abc"));
        assert_eq!(bearer_token("bearer   abc  "), Some("abc"));
        assert_eq!(bearer_token("BEARER abc"), Some("abc"));
        assert_eq!(bearer_token("Basic abc"), None);
        assert_eq!(bearer_token("Bearer"), None);
        assert_eq!(bearer_token("Bearer "), None);
        assert_eq!(bearer_token("Bearer a b"), None);
        assert_eq!(bearer_token(""), None);
    }
}
