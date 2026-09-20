//! The app's name, as the rest of the system records it.
//!
//! macOS files an application's own state under the bundle **identifier**, so
//! renaming the app moves where the webview looks: the picks the webview keeps
//! itself — the theme, the text sizes, which panel is folded — live in
//! `localStorage`, and that lives in a directory WebKit names after the
//! identifier. Left alone, an upgraded reader finds those back at their
//! defaults, with the old ones still on disk under a name nothing answers to.
//! The durable preferences are not exposed to this: they live in
//! `settings.json`, which no identifier names.
//!
//! Run before the webview exists, which is also the only moment it works:
//! WebKit opens its store as the window comes up, and a directory moved out
//! from under a store that already read the missing path is a directory nobody
//! reads this launch.

/// The identifier this build answers to.
const CURRENT: &str = "com.hamerti.hz";

/// The identifiers it answered to before, newest first. One entry per name the
/// app has shipped under — an install that skipped several still lands here
/// with everything it had, since each step moved its own directory into the
/// next one's place.
const PREVIOUS: &[&str] = &["com.yogesh.dray"];

/// The directories per platform that hold an application's persisted state,
/// relative to the home directory. The webview's own storage and whatever the
/// app writes through Tauri's path API both live under one of these.
#[cfg(target_os = "macos")]
const ROOTS: &[&str] = &["Library/Application Support", "Library/WebKit"];

/// WebKitGTK keeps its store beside the app's own data, under the same name.
#[cfg(target_os = "linux")]
const ROOTS: &[&str] = &[".local/share"];

/// Moves state left under a previous identifier onto the current one, once.
///
/// Best-effort by design: a directory that cannot be moved costs the reader
/// their settings, where an error here would cost them the launch. A failure is
/// loud on stderr and nothing else — and it is only ever attempted where the
/// current directory is absent, so a store this build has already written is
/// never overwritten by a stale one.
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub fn adopt_previous_identity() {
    let Some(home) = std::env::home_dir() else {
        return;
    };

    for root in ROOTS {
        let root = home.join(root);
        let target = root.join(CURRENT);
        if target.exists() {
            continue;
        }

        for previous in PREVIOUS {
            let source = root.join(previous);
            if source.exists() {
                if let Err(e) = std::fs::rename(&source, &target) {
                    eprintln!("[identity] could not move {}: {e}", source.display());
                }
                break;
            }
        }
    }
}

/// Windows and anything else: the identifier names a registry key and an
/// `AppData` directory this file does not claim to know, so nothing is moved.
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn adopt_previous_identity() {}
