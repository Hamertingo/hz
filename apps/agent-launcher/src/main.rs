//! `hz-agent` — the agent's launcher, as Windows ships it.
//!
//! The counterpart of [`apps/agent/bin/hz-agent`], which is a `#!/bin/sh` script
//! and therefore nothing Windows can run. Same contract, and the contract is the
//! whole reason this is a binary rather than a `.cmd`: `binpath::mcode` resolves
//! *one* path, and every spawn site runs `<that> acp`. `CreateProcess` cannot
//! start a batch file, and neither can Rust's `Command` — its own documentation
//! says the `.exe` extension may be omitted while "files with other extensions
//! must include the extension", i.e. they are found and then fail to launch. So
//! what ships is an executable image.
//!
//! What it does is what the shell script does: run `app/dist/cli.js` under the
//! `node` shipped beside it, with every argument passed through untouched.
//!
//! **The node beside this file, never one off `PATH`.** `better-sqlite3` is a
//! native module, and a native module is built for exactly one Node ABI — a
//! different node refuses to load it with a `NODE_MODULE_VERSION` error rather
//! than doing anything useful. `vendor-agent.ps1` copies in the very node that
//! ran `pnpm install`, so the pair always agrees.
//!
//! macOS keeps its shell script, which is staged by `vendor-agent.sh` and works.
//! Two launchers for one contract is a real cost, paid knowingly: the
//! alternative is replacing a shipped, tested launcher on the one platform this
//! port is not being developed on.

use std::path::{Path, PathBuf};
use std::process::{exit, Command};

fn main() {
    let Some(root) = self_root() else {
        eprintln!("hz-agent: could not work out where this launcher is.");
        exit(1);
    };

    let Some(node) = find_node(&root) else {
        eprintln!(
            "hz-agent: could not find the node its agent runs on (looked in {} and on PATH).",
            root.join("bin").display()
        );
        exit(1);
    };

    let script = root.join("app").join("dist").join("cli.js");
    if !script.is_file() {
        eprintln!(
            "hz-agent: the agent is not built — {} is missing.",
            script.display()
        );
        exit(1);
    }

    let status = Command::new(&node)
        .arg(&script)
        // Everything after this binary's own name, as `OsString`s so an argument
        // arrives exactly as it left rather than through a lossy round trip. A
        // prompt is an argument here.
        .args(std::env::args_os().skip(1))
        .status();

    match status {
        Ok(status) => exit(status.code().unwrap_or(1)),
        Err(e) => {
            eprintln!("hz-agent: could not start {}: {e}", node.display());
            exit(1);
        }
    }
}

/// The `agent` directory this launcher was staged into.
///
/// `…/agent/bin/hz-agent.exe`, so the root is two levels up. Both hops are
/// checked, so a launcher somebody moved out of the layout fails here with a
/// sentence rather than three steps later inside a spawn.
fn self_root() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let root = exe.parent()?.parent()?;
    root.is_dir().then(|| root.to_path_buf())
}

/// The `node` beside this launcher, or one on `PATH` as a fallback.
///
/// The fallback is the shell script's, kept for the case that script keeps it
/// for: a staged tree somebody pruned by hand. It is a fallback and not the
/// rule — see the module docs for what a different node costs.
fn find_node(root: &Path) -> Option<PathBuf> {
    let name = if cfg!(windows) { "node.exe" } else { "node" };

    let beside = root.join("bin").join(name);
    if beside.is_file() {
        return Some(beside);
    }

    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
}

#[cfg(test)]
mod tests {
    use super::find_node;

    /// The staged node wins, which is the half that matters: the fallback only
    /// exists for a tree somebody pruned, and preferring it would hand the
    /// agent a node built for a different ABI.
    #[test]
    fn a_staged_node_beside_the_launcher_wins_over_the_path() {
        let root = std::env::temp_dir().join(format!("hz-agent-{}", std::process::id()));
        let bin = root.join("bin");
        std::fs::create_dir_all(&bin).unwrap();

        let name = if cfg!(windows) { "node.exe" } else { "node" };
        let staged = bin.join(name);
        std::fs::write(&staged, b"not really node").unwrap();

        assert_eq!(find_node(&root), Some(staged.clone()));

        let _ = std::fs::remove_dir_all(&root);
        let _ = staged;
    }
}
