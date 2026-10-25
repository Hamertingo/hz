//! Secrets in the macOS Keychain, through the `security` tool.
//!
//! Plugin tokens, OAuth client credentials and the values of a server's
//! environment live here and nowhere in `~/.hz`: a JSON file in the home folder is
//! readable by anything that runs as the reader, and a Keychain item is not.
//!
//! The value travels to `security -i` on **stdin**, never on the command line,
//! where any process could read it from `ps`. It is stored as base64 so no quote
//! or brace in a JSON secret can break the interactive tool's own parsing.
//!
//! Only macOS has this backend. Elsewhere every call fails with a sentence saying
//! so, since the alternative — a quiet fallback to a file — would put the secret
//! exactly where this module exists to keep it out of.

use anyhow::Result;

/// The Keychain service every item here is filed under.
const SERVICE: &str = "hz.plugins";

/// Stores `secret` under `account`, replacing what was there.
pub fn set(account: &str, secret: &str) -> Result<()> {
    backend::set(SERVICE, account, secret)
}

/// The secret under `account`, or `None` when nothing is stored.
pub fn get(account: &str) -> Result<Option<String>> {
    backend::get(SERVICE, account)
}

/// Removes the secret under `account`. Removing what is not there is not an error.
pub fn delete(account: &str) -> Result<()> {
    backend::delete(SERVICE, account)
}

#[cfg(all(target_os = "macos", not(test)))]
mod backend {
    use std::io::Write;
    use std::process::{Command, Stdio};

    use anyhow::{bail, Context, Result};
    use base64::Engine as _;

    use crate::proc::HideConsole;

    const SECURITY: &str = "/usr/bin/security";

    fn encode(secret: &str) -> String {
        base64::engine::general_purpose::STANDARD.encode(secret)
    }

    pub fn set(service: &str, account: &str, secret: &str) -> Result<()> {
        // `account` is built from ids this app minted; refusing anything else
        // keeps a stray quote from ever reaching the interactive parser.
        if !account.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '.')) {
            bail!("not a keychain account name");
        }
        let mut child = Command::new(SECURITY)
            .hide_console()
            .arg("-i")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .context("could not start the macOS security tool")?;
        let line = format!("add-generic-password -U -s {service} -a {account} -w {}\n", encode(secret));
        child
            .stdin
            .take()
            .context("no stdin on the security tool")?
            .write_all(line.as_bytes())
            .context("could not hand the secret to the Keychain")?;
        let out = child.wait_with_output().context("the security tool did not finish")?;
        let err = String::from_utf8_lossy(&out.stderr);
        if !out.status.success() || err.contains("security:") {
            bail!("the Keychain refused the secret: {}", err.trim());
        }
        Ok(())
    }

    pub fn get(service: &str, account: &str) -> Result<Option<String>> {
        let out = Command::new(SECURITY)
            .hide_console()
            .args(["find-generic-password", "-s", service, "-a", account, "-w"])
            .output()
            .context("could not start the macOS security tool")?;
        if !out.status.success() {
            // 44 is "item not found"; anything else is a real failure worth saying.
            if out.status.code() == Some(44) {
                return Ok(None);
            }
            bail!("the Keychain could not be read: {}", String::from_utf8_lossy(&out.stderr).trim());
        }
        let text = String::from_utf8_lossy(&out.stdout);
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(text.trim())
            .context("a Keychain item here is not one this app wrote")?;
        Ok(Some(String::from_utf8(bytes).context("a Keychain item here is not text")?))
    }

    pub fn delete(service: &str, account: &str) -> Result<()> {
        let out = Command::new(SECURITY)
            .hide_console()
            .args(["delete-generic-password", "-s", service, "-a", account])
            .output()
            .context("could not start the macOS security tool")?;
        if out.status.success() || out.status.code() == Some(44) {
            Ok(())
        } else {
            bail!("the Keychain could not forget it: {}", String::from_utf8_lossy(&out.stderr).trim())
        }
    }
}

#[cfg(all(not(target_os = "macos"), not(test)))]
mod backend {
    use anyhow::{bail, Result};

    const WHY: &str = "secrets are kept in the macOS Keychain, which this system does not have";

    pub fn set(_: &str, _: &str, _: &str) -> Result<()> {
        bail!(WHY)
    }
    pub fn get(_: &str, _: &str) -> Result<Option<String>> {
        bail!(WHY)
    }
    pub fn delete(_: &str, _: &str) -> Result<()> {
        bail!(WHY)
    }
}

/// Tests run against memory: a test must never write to the developer's Keychain.
#[cfg(test)]
mod backend {
    use std::collections::HashMap;
    use std::sync::{LazyLock, Mutex};

    use anyhow::Result;

    static ITEMS: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(Default::default);

    pub fn set(service: &str, account: &str, secret: &str) -> Result<()> {
        ITEMS.lock().unwrap().insert(format!("{service}/{account}"), secret.to_string());
        Ok(())
    }
    pub fn get(service: &str, account: &str) -> Result<Option<String>> {
        Ok(ITEMS.lock().unwrap().get(&format!("{service}/{account}")).cloned())
    }
    pub fn delete(service: &str, account: &str) -> Result<()> {
        ITEMS.lock().unwrap().remove(&format!("{service}/{account}"));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_secret_round_trips_and_is_forgotten() {
        set("t:a", "{\"x\":\"y z\"}").unwrap();
        assert_eq!(get("t:a").unwrap().as_deref(), Some("{\"x\":\"y z\"}"));
        delete("t:a").unwrap();
        assert_eq!(get("t:a").unwrap(), None);
        delete("t:a").unwrap();
    }
}
