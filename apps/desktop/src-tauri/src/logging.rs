//! Where a failure goes when nobody is watching a terminal.
//!
//! A bundled `.app` launched from Finder or Dock inherits launchd's environment,
//! so its stderr goes to the system log — a file the reader will never open. That
//! made every `eprintln!` in this tree a note to nobody, and there are fifty-odd of
//! them on paths that matter: a worktree rollback that did not land, an index
//! write that failed, a session file that would not delete. The app knew, and said
//! so to a wall.
//!
//! **One redirect rather than fifty call sites.** Rather than teaching each site a
//! new function — and trusting every one added later to remember it — stderr is
//! teed once, at startup, into a file beside the app's own data. A thread carries
//! what arrives to both the terminal it always went to and the log.
//!
//! That covers the sites that exist, the ones added after this, and **the panic
//! message of a task that unwinds** — which no call-site change could ever have
//! caught, and which is the other half of a session that dies without saying so.
//!
//! The child's stderr is deliberately untouched. `mcode` writes its own, the
//! harness reads it to explain a turn that ended badly, and it arrives here as a
//! *value* rather than through this process's descriptor — see [`stderr_tail_note`].
//!
//! [`stderr_tail_note`]: crate::harness::mcode::mcode

use std::path::Path;

/// How large the log may grow before it is rolled over, once.
///
/// An app that runs for months cannot be allowed to fill a disk with its own
/// complaints, and nobody is going to rotate this by hand — so it keeps one file
/// and one previous file, and the oldest is what goes.
#[cfg(unix)]
const MAX_BYTES: u64 = 4 * 1024 * 1024;

/// Sends this process's stderr to the terminal **and** to `hz.log` under the
/// app's own data directory.
///
/// **Called once, and it must not be the thing that creates the directory.** The
/// caller passes a path it already resolved — `store::get_home_app_dir` — rather
/// than joining `~/.hz` here, and that is load-bearing rather than tidy: the
/// resolver is what moves a directory left by an earlier name of the app into
/// place, and it only does that while `~/.hz` does not exist yet. Creating it here
/// to hold a log would quietly cost a reader their session history.
///
/// Every failure below is silent on purpose. A process that cannot open its own
/// log is one that should still start, and the log is where a complaint about that
/// would have gone.
#[cfg(unix)]
pub fn tee_stderr(dir: &Path) {
    use std::fs::{File, OpenOptions};
    use std::io::{Read, Write};
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::thread;

    let path = dir.join("hz.log");
    roll_if_large(&path);

    let Ok(mut log) = OpenOptions::new().create(true).append(true).open(&path) else {
        return;
    };

    // One pipe, and the write end of it becomes fd 2: everything the process
    // writes to stderr comes out of the read end instead of going anywhere.
    let mut fds = [0 as libc::c_int; 2];
    // SAFETY: `pipe` fills both entries of a two-element array, or returns -1.
    if unsafe { libc::pipe(fds.as_mut_ptr()) } != 0 {
        return;
    }
    // SAFETY: both descriptors were just handed over by `pipe`, and nothing else
    // holds them — taking them as `OwnedFd` is the whole of the transfer, and it
    // is what closes them if any check below returns early.
    let read_end = unsafe { OwnedFd::from_raw_fd(fds[0]) };
    let write_end = unsafe { OwnedFd::from_raw_fd(fds[1]) };

    // The terminal is kept aside *before* the pipe takes its place, which is what
    // makes this a tee: a dev run still prints where it always printed.
    //
    // SAFETY: `dup` returns a fresh descriptor the caller owns, and a negative
    // return is checked before it is trusted.
    let terminal = unsafe { libc::dup(libc::STDERR_FILENO) };
    if terminal < 0 {
        return;
    }
    // SAFETY: `dup2` is handed two descriptors this function owns, and the result
    // is checked. It closes whatever fd 2 was, which is the intended handover.
    if unsafe { libc::dup2(write_end.as_raw_fd(), libc::STDERR_FILENO) } < 0 {
        return;
    }
    // SAFETY: as above — `dup`'s return is owned by nobody else yet.
    let terminal = unsafe { OwnedFd::from_raw_fd(terminal) };

    // fd 2 holds the only copy of this end from here on, and dropping ours is what
    // leaves it that way: a second copy kept alive would hold the pipe open after
    // the process's stderr had gone.
    drop(write_end);

    let mut from_pipe = File::from(read_end);
    let mut to_terminal = File::from(terminal);

    thread::spawn(move || {
        let mut buffer = [0u8; 8 * 1024];
        loop {
            match from_pipe.read(&mut buffer) {
                // Zero is the write end going away — every copy of fd 2 closed —
                // and an error here is a read that cannot be retried. Both end it.
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let chunk = &buffer[..n];
                    // The terminal first, and its failure ignored: stderr being
                    // gone is what happens under a bundled app, and it must not
                    // stop the write that a reader can still find.
                    let _ = to_terminal.write_all(chunk);
                    let _ = log.write_all(chunk);
                }
            }
        }
    });
}

/// Windows keeps a launched app's stderr going to whatever console started it,
/// which is where somebody building this already looks. Nothing to arrange, and
/// nothing to break by pretending otherwise.
#[cfg(not(unix))]
pub fn tee_stderr(_dir: &Path) {}

/// Keeps the log to one file plus one previous one.
#[cfg(unix)]
fn roll_if_large(path: &Path) {
    let too_big = std::fs::metadata(path)
        .map(|meta| meta.len() > MAX_BYTES)
        .unwrap_or(false);
    if too_big {
        let _ = std::fs::rename(path, path.with_extension("log.1"));
    }
}
