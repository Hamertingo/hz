//! Several sign-ins on one engine: one folder per account and the environment that points an engine at it.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};

/// The agent CLIs that keep their own sign-in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    Claude,
    Codex,
    OpenCode,
    Antigravity,
    Grok,
}

/// One sign-in the reader added.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub engine: Engine,
    pub label: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Data {
    accounts: Vec<Account>,
    /// Agent id to account id.
    assignments: BTreeMap<String, String>,
}

/// The accounts file plus the root folder the per-account directories live in.
#[derive(Debug)]
pub struct AccountStore {
    path: PathBuf,
    root: PathBuf,
    data: Data,
}

/// Accepts lowercase letters, digits, `-` and `_`, 1 to 64 long, so an id is always one safe path segment.
pub fn validate_id(id: &str) -> Result<()> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_');
    if ok { Ok(()) } else { bail!("invalid account id") }
}

impl AccountStore {
    /// Loads the file at `path` (missing means empty); account folders go in `accounts/` beside it.
    pub fn open(path: &Path) -> Result<Self> {
        let data = match std::fs::read_to_string(path) {
            Ok(s) => serde_json::from_str(&s).context("accounts file is not valid")?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Data::default(),
            Err(e) => return Err(e.into()),
        };
        let root = path.parent().unwrap_or(Path::new(".")).join("accounts");
        Ok(AccountStore { path: path.to_path_buf(), root, data })
    }

    fn save(&self) -> Result<()> {
        if let Some(p) = self.path.parent() {
            std::fs::create_dir_all(p)?;
        }
        let tmp = self.path.with_extension("tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(&self.data)?)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }

    /// All accounts, oldest first.
    pub fn list(&self) -> &[Account] {
        &self.data.accounts
    }

    /// Adds an account with the given id; ids are unique.
    pub fn add(&mut self, id: &str, engine: Engine, label: &str) -> Result<Account> {
        validate_id(id)?;
        if self.data.accounts.iter().any(|a| a.id == id) {
            bail!("account already exists");
        }
        let acc = Account { id: id.into(), engine, label: label.trim().chars().take(60).collect() };
        self.data.accounts.push(acc.clone());
        self.save()?;
        Ok(acc)
    }

    /// Removes an account and any agent assignments that used it; the folder on disk stays.
    pub fn remove(&mut self, id: &str) -> Result<bool> {
        let before = self.data.accounts.len();
        self.data.accounts.retain(|a| a.id != id);
        self.data.assignments.retain(|_, v| v != id);
        let gone = self.data.accounts.len() != before;
        if gone {
            self.save()?;
        }
        Ok(gone)
    }

    /// The folder for an account id, always directly under the accounts root.
    pub fn dir_for(&self, id: &str) -> Result<PathBuf> {
        validate_id(id)?;
        Ok(self.root.join(id))
    }

    /// Makes an agent use an account; the account must exist.
    pub fn assign(&mut self, agent: &str, account_id: &str) -> Result<()> {
        if !self.data.accounts.iter().any(|a| a.id == account_id) {
            return Err(anyhow!("no such account"));
        }
        self.data.assignments.insert(agent.into(), account_id.into());
        self.save()
    }

    /// Returns an agent to the engine's default sign-in.
    pub fn unassign(&mut self, agent: &str) -> Result<()> {
        self.data.assignments.remove(agent);
        self.save()
    }

    /// The account an agent uses, if one was assigned.
    pub fn account_for(&self, agent: &str) -> Option<&Account> {
        let id = self.data.assignments.get(agent)?;
        self.data.accounts.iter().find(|a| &a.id == id)
    }
}

/// Environment variables that point `engine` at `account_dir`.
pub fn env_for(engine: Engine, account_dir: &Path) -> Vec<(String, String)> {
    let d = |p: PathBuf| p.to_string_lossy().into_owned();
    match engine {
        Engine::Claude => vec![("CLAUDE_CONFIG_DIR".into(), d(account_dir.to_path_buf()))],
        Engine::Codex => vec![("CODEX_HOME".into(), d(account_dir.to_path_buf()))],
        Engine::OpenCode => vec![("XDG_DATA_HOME".into(), d(account_dir.join("data")))],
        Engine::Antigravity | Engine::Grok => vec![("HOME".into(), d(account_dir.join("home")))],
    }
}

/// The folder an engine keeps its sign-in in under HOME, for the engines that need a linked HOME.
pub fn own_dir_name(engine: Engine) -> Option<&'static str> {
    match engine {
        Engine::Antigravity => Some(".gemini"),
        Engine::Grok => Some(".grok"),
        _ => None,
    }
}

/// Builds `<account_dir>/home` as a mirror of the real home where every entry is a symlink except the
/// engine's own folder, which is a fresh real directory so its sign-in stays separate. Safe to run again.
#[cfg(unix)]
pub fn prepare_home(real_home: &Path, account_dir: &Path, own_dir_name: &str) -> Result<PathBuf> {
    if own_dir_name.is_empty() || own_dir_name.contains('/') || own_dir_name == ".." || own_dir_name == "." {
        bail!("invalid engine folder name");
    }
    let home = account_dir.join("home");
    std::fs::create_dir_all(&home)?;
    std::fs::create_dir_all(home.join(own_dir_name))?;
    for entry in std::fs::read_dir(real_home)? {
        let entry = entry?;
        let name = entry.file_name();
        if name == std::ffi::OsStr::new(own_dir_name) {
            continue;
        }
        let link = home.join(&name);
        if std::fs::symlink_metadata(&link).is_ok() {
            continue;
        }
        std::os::unix::fs::symlink(entry.path(), &link)?;
    }
    Ok(home)
}

/// Linked homes are only built on unix.
#[cfg(not(unix))]
pub fn prepare_home(_real_home: &Path, _account_dir: &Path, _own_dir_name: &str) -> Result<PathBuf> {
    bail!("linked homes need a unix system")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let p = std::env::temp_dir().join(format!("hz-acc-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn id_validation() {
        assert!(validate_id("work-2").is_ok());
        for bad in ["", "..", "a/b", "A", "a b", ".hidden", &"a".repeat(65)] {
            assert!(validate_id(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn env_per_engine() {
        let d = Path::new("/a/x");
        assert_eq!(env_for(Engine::Claude, d), vec![("CLAUDE_CONFIG_DIR".into(), "/a/x".into())]);
        assert_eq!(env_for(Engine::Codex, d)[0].0, "CODEX_HOME");
        assert_eq!(env_for(Engine::OpenCode, d), vec![("XDG_DATA_HOME".into(), "/a/x/data".into())]);
        assert_eq!(env_for(Engine::Grok, d), vec![("HOME".into(), "/a/x/home".into())]);
        assert_eq!(env_for(Engine::Antigravity, d)[0].1, "/a/x/home");
    }

    #[test]
    fn store_roundtrip_and_assign() {
        let dir = tmp();
        let f = dir.join("accounts.json");
        let mut s = AccountStore::open(&f).unwrap();
        s.add("work", Engine::Claude, " Work ").unwrap();
        s.assign("leo", "work").unwrap();
        let s2 = AccountStore::open(&f).unwrap();
        assert_eq!(s2.list()[0].label, "Work");
        assert_eq!(s2.account_for("leo").unwrap().id, "work");
        assert!(s2.account_for("nova").is_none());
    }

    #[test]
    fn duplicate_and_unknown_are_errors() {
        let dir = tmp();
        let mut s = AccountStore::open(&dir.join("a.json")).unwrap();
        s.add("a", Engine::Codex, "A").unwrap();
        assert!(s.add("a", Engine::Codex, "again").is_err());
        assert!(s.assign("leo", "ghost").is_err());
        assert!(s.add("../x", Engine::Codex, "x").is_err());
    }

    #[test]
    fn remove_clears_assignments() {
        let dir = tmp();
        let mut s = AccountStore::open(&dir.join("a.json")).unwrap();
        s.add("a", Engine::Codex, "A").unwrap();
        s.assign("leo", "a").unwrap();
        assert!(s.remove("a").unwrap());
        assert!(s.account_for("leo").is_none());
        assert!(!s.remove("a").unwrap());
    }

    #[test]
    fn dir_for_stays_under_root() {
        let dir = tmp();
        let s = AccountStore::open(&dir.join("a.json")).unwrap();
        assert_eq!(s.dir_for("work").unwrap(), dir.join("accounts").join("work"));
        assert!(s.dir_for("../etc").is_err());
    }

    #[test]
    fn corrupt_file_errors() {
        let dir = tmp();
        let f = dir.join("a.json");
        std::fs::write(&f, "{nope").unwrap();
        assert!(AccountStore::open(&f).is_err());
    }

    #[test]
    fn own_dir_names() {
        assert_eq!(own_dir_name(Engine::Grok), Some(".grok"));
        assert_eq!(own_dir_name(Engine::Antigravity), Some(".gemini"));
        assert_eq!(own_dir_name(Engine::Claude), None);
    }

    #[cfg(unix)]
    #[test]
    fn prepare_home_links_all_but_own_folder() {
        let root = tmp();
        let real = root.join("real");
        std::fs::create_dir_all(real.join(".grok")).unwrap();
        std::fs::write(real.join(".grok/token"), "secret").unwrap();
        std::fs::create_dir_all(real.join(".ssh")).unwrap();
        std::fs::write(real.join(".zshrc"), "x").unwrap();
        let acc = root.join("acc");
        let home = prepare_home(&real, &acc, ".grok").unwrap();
        assert!(std::fs::symlink_metadata(home.join(".zshrc")).unwrap().file_type().is_symlink());
        assert!(std::fs::symlink_metadata(home.join(".ssh")).unwrap().file_type().is_symlink());
        let own = std::fs::symlink_metadata(home.join(".grok")).unwrap();
        assert!(own.is_dir() && !own.file_type().is_symlink());
        assert!(!home.join(".grok/token").exists());
        prepare_home(&real, &acc, ".grok").unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn prepare_home_rejects_bad_folder_name() {
        let root = tmp();
        assert!(prepare_home(&root, &root.join("a"), "../x").is_err());
        assert!(prepare_home(&root, &root.join("a"), "").is_err());
    }
}
