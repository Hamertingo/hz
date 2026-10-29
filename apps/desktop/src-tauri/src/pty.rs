//! A real shell on a pseudo-terminal, for "Take over": the reader types into the
//! agent's own folder instead of asking the agent to.
//!
//! Minimal on purpose. It is `openpty` plus a login-less shell, with the output
//! streamed to the webview as it arrives and the input written back. There is no
//! terminal emulator on either end, so full-screen programs will draw as noise —
//! the sheet is for running commands, not for `vim`.

use std::{
    collections::HashMap,
    fs::File,
    io::{Read, Write},
    os::fd::{AsRawFd, FromRawFd, OwnedFd},
    process::{Command, Stdio},
    sync::{LazyLock, Mutex},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// One open terminal: the master end we write to, and the shell's pid.
struct Pty {
    master: File,
    pid: u32,
}

static OPEN: LazyLock<Mutex<HashMap<String, Pty>>> = LazyLock::new(Default::default);

#[derive(Clone, Serialize)]
struct PtyData {
    id: String,
    data: String,
}

#[derive(Clone, Serialize)]
struct PtyExit {
    id: String,
}

fn winsize(cols: u16, rows: u16) -> libc::winsize {
    libc::winsize { ws_row: rows.max(1), ws_col: cols.max(1), ws_xpixel: 0, ws_ypixel: 0 }
}

/// Starts `shell` on a fresh pty in `cwd` and hands back the master end, the pid
/// and a channel of the bytes it prints. The channel closes when the shell exits.
///
/// Separate from the command so a test can drive a real shell without a window.
fn spawn(
    shell: &str,
    cwd: &str,
    cols: u16,
    rows: u16,
) -> anyhow::Result<(File, u32, std::sync::mpsc::Receiver<Vec<u8>>)> {
    if !std::path::Path::new(cwd).is_dir() {
        anyhow::bail!("{cwd} is not a folder");
    }

    let (mut master_fd, mut slave_fd) = (0, 0);
    let mut size = winsize(cols, rows);
    // SAFETY: both out-pointers are valid for the call, and the name and termios
    // arguments are allowed to be null.
    let rc = unsafe {
        libc::openpty(&mut master_fd, &mut slave_fd, std::ptr::null_mut(), std::ptr::null_mut(), &mut size)
    };
    if rc != 0 {
        anyhow::bail!("could not open a terminal: {}", std::io::Error::last_os_error());
    }
    // SAFETY: openpty returned two descriptors that nothing else owns.
    let (master, slave) = unsafe { (OwnedFd::from_raw_fd(master_fd), OwnedFd::from_raw_fd(slave_fd)) };

    let mut command = Command::new(shell);
    command
        .current_dir(cwd)
        .env("TERM", "xterm-256color")
        .stdin(Stdio::from(slave.try_clone()?))
        .stdout(Stdio::from(slave.try_clone()?))
        .stderr(Stdio::from(slave));
    // SAFETY: only async-signal-safe calls between fork and exec. The shell must
    // lead its own session with the pty as its controlling terminal, or job
    // control and Ctrl-C do nothing.
    unsafe {
        use std::os::unix::process::CommandExt;
        command.pre_exec(|| {
            libc::setsid();
            libc::ioctl(0, libc::TIOCSCTTY as _, 0);
            Ok(())
        });
    }
    let mut child = command.spawn()?;
    let pid = child.id();
    // Reaped here whenever it ends, by exit or by `pty_close`, so no zombie stays.
    std::thread::spawn(move || {
        let _ = child.wait();
    });

    let reader = File::from(master.try_clone()?);
    let writer = File::from(master);
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 8192];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 || tx.send(buf[..n].to_vec()).is_err() {
                break;
            }
        }
    });

    Ok((writer, pid, rx))
}

/// Splits `bytes` at the last complete UTF-8 character, so a multi-byte glyph cut
/// by a read boundary is held for the next chunk instead of becoming `�`.
fn split_complete(bytes: &[u8]) -> (&[u8], &[u8]) {
    let mut cut = bytes.len();
    // A character is at most four bytes, so only the last three can be a stub.
    for back in 1..=bytes.len().min(3) {
        let at = bytes.len() - back;
        let b = bytes[at];
        if b & 0b1100_0000 == 0b1000_0000 {
            continue;
        }
        let need = if b >= 0xF0 { 4 } else if b >= 0xE0 { 3 } else if b >= 0xC0 { 2 } else { 1 };
        if need > back {
            cut = at;
        }
        break;
    }
    bytes.split_at(cut)
}

/// Opens a shell in `cwd` and starts streaming it as `pty_data` events. Returns
/// the id every other call names it by.
#[tauri::command]
pub async fn pty_open(app: AppHandle, cwd: String, cols: u16, rows: u16) -> Result<String, String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let (master, pid, rx) = spawn(&shell, &cwd, cols, rows).map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    OPEN.lock().expect("ptys poisoned").insert(id.clone(), Pty { master, pid });

    let emit_id = id.clone();
    std::thread::spawn(move || {
        let mut held: Vec<u8> = Vec::new();
        while let Ok(chunk) = rx.recv() {
            held.extend_from_slice(&chunk);
            let (done, rest) = split_complete(&held);
            if done.is_empty() {
                continue;
            }
            let data = String::from_utf8_lossy(done).into_owned();
            let rest = rest.to_vec();
            held = rest;
            let _ = app.emit("pty_data", PtyData { id: emit_id.clone(), data });
        }
        OPEN.lock().expect("ptys poisoned").remove(&emit_id);
        let _ = app.emit("pty_exit", PtyExit { id: emit_id });
    });
    Ok(id)
}

/// Types `data` into the terminal exactly as given, newlines included.
#[tauri::command]
pub async fn pty_write(id: String, data: String) -> Result<(), String> {
    let mut open = OPEN.lock().expect("ptys poisoned");
    let pty = open.get_mut(&id).ok_or("that terminal has closed")?;
    pty.master.write_all(data.as_bytes()).map_err(|e| e.to_string())
}

/// Tells the shell its window changed size.
#[tauri::command]
pub async fn pty_resize(id: String, cols: u16, rows: u16) -> Result<(), String> {
    let open = OPEN.lock().expect("ptys poisoned");
    let pty = open.get(&id).ok_or("that terminal has closed")?;
    let size = winsize(cols, rows);
    // SAFETY: the descriptor is the live master and `size` outlives the call.
    let rc = unsafe { libc::ioctl(pty.master.as_raw_fd(), libc::TIOCSWINSZ as _, &size) };
    if rc == 0 { Ok(()) } else { Err(std::io::Error::last_os_error().to_string()) }
}

/// Ends the shell and forgets the terminal. Quiet about one already gone: the
/// sheet closing and the shell exiting race, and either order is fine.
#[tauri::command]
pub async fn pty_close(id: String) {
    let pty = OPEN.lock().expect("ptys poisoned").remove(&id);
    if let Some(pty) = pty {
        // SAFETY: a signal to a pid we started. The hangup is what a closed
        // terminal window sends, and a shell that ignores it gets the kill.
        unsafe {
            libc::kill(pty.pid as i32, libc::SIGHUP);
            libc::kill(pty.pid as i32, libc::SIGKILL);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    /// A real shell on a real pty runs a command in the folder it was given and
    /// prints the result back: the whole of what Take over needs.
    #[test]
    fn a_shell_runs_a_command_in_its_folder() {
        let dir = std::env::temp_dir().canonicalize().unwrap();
        let (mut master, pid, rx) = spawn("/bin/sh", dir.to_str().unwrap(), 80, 24).unwrap();
        master.write_all(b"echo pty-$((20+22)); pwd; exit\n").unwrap();

        let mut out = String::new();
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(chunk) => out.push_str(&String::from_utf8_lossy(&chunk)),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(_) => break,
            }
            if out.contains("pty-42") && out.contains(dir.to_str().unwrap()) {
                break;
            }
        }
        let _ = pid;
        assert!(out.contains("pty-42"), "no output from the shell: {out:?}");
        assert!(out.contains(dir.to_str().unwrap()), "wrong folder: {out:?}");
    }

    #[test]
    fn a_folder_that_is_not_there_is_refused() {
        assert!(spawn("/bin/sh", "/definitely/not/here", 80, 24).is_err());
    }

    /// A glyph cut in half by a read boundary waits for its other half.
    #[test]
    fn a_split_character_is_held_back() {
        let bytes = "é".as_bytes(); // two bytes
        let (done, rest) = split_complete(&bytes[..1]);
        assert!(done.is_empty());
        assert_eq!(rest.len(), 1);
        let (done, rest) = split_complete(bytes);
        assert_eq!(done, bytes);
        assert!(rest.is_empty());
        let (done, rest) = split_complete(b"abc");
        assert_eq!((done, rest), (&b"abc"[..], &b""[..]));
    }
}
