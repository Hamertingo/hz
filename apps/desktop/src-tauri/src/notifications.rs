use std::sync::{LazyLock, Mutex};

use tauri::AppHandle;

use crate::settings::MeStatus;

// `emit` and `path` are trait methods, so the traits only need to be in scope
// where they are called — and this module posts a banner from Rust on macOS
// alone, every other target having its own backend. Imported unconditionally
// they are dead code on Windows, which `-D warnings` refuses.
#[cfg(target_os = "macos")]
use tauri::{Emitter, Manager};

/// Show a desktop notification that clicks back into the session it came from.
///
/// Deliberately not `tauri-plugin-notification`, for two reasons that each rule
/// it out on their own. It drops the handle `show` returns, and that handle is
/// the only thing a click is reported through. And it posts through
/// `NSUserNotificationCenter`, which current macOS does not deliver for an app
/// at all — see the notifications section of FEATURES.md for what was measured.
///
/// Waiting on the handle blocks until the reader acts or the banner ages out,
/// hence `spawn_blocking`: one parked thread per banner on screen, bounded by
/// how many the OS will stack.
#[tauri::command]
pub async fn notify_session(
    app: AppHandle,
    session_id: String,
    kind: String,
    title: String,
    body: String,
) -> Result<(), String> {
    deliver(&app, Some(session_id), kind, title, body).await;
    Ok(())
}

/// The one door a banner goes through: the reader's status first (held banners
/// come back as a summary), then the Preferences page's level for this kind and
/// its quiet hours.
async fn deliver(app: &AppHandle, session_id: Option<String>, kind: String, title: String, body: String) {
    let settings = crate::settings::read().await;
    if verdict(settings.me.status, &kind) == Verdict::Hold {
        HELD.lock().expect("held notifications poisoned").push(Held { title, body });
        return;
    }
    crate::bark_push::on_banner(app, session_id.as_deref(), &kind, &title, &body);
    let prefs = crate::studio::StudioPrefs::from_value(settings.studio.as_ref());
    match crate::studio::delivery(&prefs, &kind, crate::studio::local_minutes()) {
        crate::studio::Delivery::Banner { sound } => post(app.clone(), session_id, kind, title, body, sound),
        crate::studio::Delivery::Badge | crate::studio::Delivery::Off => {}
    }
}

/// A real banner on request, for the Preferences page's "Send a test
/// notification". It ignores the levels and quiet hours on purpose: the point is
/// to see whether the OS lets hz show one at all.
#[tauri::command]
pub async fn notify_test(app: AppHandle) -> Result<(), String> {
    if cfg!(target_os = "macos") && tauri::is_dev() {
        return Err("A dev build has no app bundle, so macOS shows no banners for it. Try the installed app.".into());
    }
    post(
        app,
        None,
        "asking".into(),
        "hz test".into(),
        "If you can read this, banners work.".into(),
        true,
    );
    Ok(())
}

/// A banner for something that waits on the reader (`asking`) or names them
/// (`mention`), held or delivered by their status exactly as the webview's own
/// banners are.
pub async fn notify_asking(app: &AppHandle, session_id: Option<String>, kind: &str, title: String, body: String) {
    deliver(app, session_id, kind.into(), title, body).await;
}

/// What the reader's status does to one banner.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Deliver,
    Hold,
}

/// Focus lets only a request through ("asking": the agent is blocked on the
/// reader); Away holds everything, requests included, since nobody is there to
/// answer. Held banners are not dropped: they come back as one summary.
pub fn verdict(status: MeStatus, kind: &str) -> Verdict {
    match status {
        MeStatus::Available => Verdict::Deliver,
        MeStatus::Focus if kind == "asking" || kind == "mention" => Verdict::Deliver,
        MeStatus::Focus | MeStatus::Away => Verdict::Hold,
    }
}

struct Held {
    title: String,
    body: String,
}

/// Banners withheld while the reader was Focus or Away, oldest first.
static HELD: LazyLock<Mutex<Vec<Held>>> = LazyLock::new(Default::default);

/// One banner for everything that was held: how many, and the first few titles.
fn summary(held: &[Held]) -> Option<(String, String)> {
    if held.is_empty() {
        return None;
    }
    let n = held.len();
    let title = if n == 1 {
        "1 update while you were away".to_string()
    } else {
        format!("{n} updates while you were away")
    };
    let mut body = held.iter().take(3).map(|h| {
        if h.body.is_empty() { h.title.clone() } else { format!("{}: {}", h.title, h.body) }
    }).collect::<Vec<_>>().join(" · ");
    if n > 3 {
        body.push_str(&format!(" · and {} more", n - 3));
    }
    Some((title, body))
}

/// Called when the reader's status changes: back to Available posts the summary
/// of what was held. Any other status leaves the queue to grow.
pub fn status_changed(app: &AppHandle, status: MeStatus) {
    if status != MeStatus::Available {
        return;
    }
    let held = std::mem::take(&mut *HELD.lock().expect("held notifications poisoned"));
    if let Some((title, body)) = summary(&held) {
        post(app.clone(), None, "summary".into(), title, body, false);
    }
}

/// Posts one banner. With a session id a click opens that session; without one
/// (the summary) it only raises the window.
fn post(app: AppHandle, session_id: Option<String>, kind: String, title: String, body: String, sound: bool) {
    // `UNUserNotificationCenter` reaches for the running process's bundle and
    // raises an **uncaught** `NSInternalInconsistencyException` when there
    // isn't one — not an error it returns, an abort that takes the app with it.
    // A `tauri dev` binary is exactly that case: it runs from `target/debug`
    // rather than a `.app`, so it has no bundle to find. Hence the early return,
    // and hence no desktop banners while developing; the in-app notice and the
    // sidebar rail are the whole signal there.
    //
    // `notify_rust::check_bundle` is *not* the guard to use. It only asks
    // whether a bundle identifier exists, which an embedded `Info.plist` is
    // enough to satisfy — it answered `Ok` for the dev binary right up to the
    // frame that crashed it.
    #[cfg(target_os = "macos")]
    if tauri::is_dev() {
        return;
    }

    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        request_auth_once();

        let mut notification = notify_rust::Notification::new();
        notification.summary(&title).body(&body).auto_icon();

        // Only "Banner and sound" asks for one; a plain banner is silent, which
        // is a pick the reader made and not the oversight `sound_for` guards.
        #[cfg(target_os = "macos")]
        if sound {
            notification.sound_name(sound_for(&kind));
        }

        let handle = match notification.show() {
            Ok(handle) => handle,
            // Best-effort by design: the in-app notice and the sidebar rail both
            // survive this, so a failure must never reach the reader as an error.
            Err(e) => return eprintln!("[notify err] {e}"),
        };

        #[cfg(target_os = "macos")]
        handle.wait_for_action(|action| {
            // A tap on the banner body is `"default"`; a dismissal or an expiry
            // is `"__closed"`, which is the reader declining to look — raising
            // the window on that would be the opposite of what was asked.
            if action != "__closed" {
                activate(&app, session_id.as_deref());
            }
        });
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (handle, &app, &session_id, &kind, sound);
        }
    });
}

/// Pick the banner's sound from what the session wants.
///
/// A banner with no sound at all is delivered silently — notify-rust only calls
/// `setSound` when a name is set — and silence is worst on exactly this channel,
/// which fires when the reader is in another app and can neither see the in-app
/// notice nor hear the sound it plays.
///
/// The two kinds are told apart because only one of them is a request: a
/// question left unanswered holds the session open, so it gets a sound that
/// stands out from the OS default the reader hears all day. `""` reads like "no
/// sound" and is the opposite — it is the name `UNNotificationSound.soundNamed:`
/// resolves to the system default, verified by ear against a named one.
#[cfg(target_os = "macos")]
fn sound_for(kind: &str) -> &'static str {
    match kind {
        "asking" => "Ping",
        _ => "",
    }
}

/// Ask the OS for permission, once for the life of the process.
///
/// The first call is what raises the system prompt, and it **blocks until the
/// reader answers it** — so this must not be per-banner, or a stack of parked
/// threads all waits on one dialog. Posting before the answer lands is refused
/// outright, which is why the ask is here rather than at startup: it is the
/// first notification that needs it, and asking then is also what puts the
/// dialog in front of someone who has just seen why the app wants it.
///
/// A denial is silent and permanent. Nothing branches on the result because
/// there is nothing useful to do with it — a refused post already logs, and the
/// in-app notice covers the reader either way.
#[cfg(target_os = "macos")]
fn request_auth_once() {
    static ASKED: std::sync::Once = std::sync::Once::new();
    ASKED.call_once(|| {
        if let Err(e) = notify_rust::request_auth_blocking() {
            eprintln!("[notify auth err] {e}");
        }
    });
}

/// Bring the window forward and tell the frontend which session was asked for.
///
/// Both halves are needed and neither implies the other: the OS raises the app
/// on its own, but nothing about being frontmost selects a session.
#[cfg(target_os = "macos")]
fn activate(app: &AppHandle, session_id: Option<&str>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Some(session_id) = session_id {
        if let Err(e) = app.emit("notification_activated", session_id) {
            eprintln!("[notify emit err] {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn focus_passes_only_a_request_and_away_passes_nothing() {
        assert_eq!(verdict(MeStatus::Available, "completed"), Verdict::Deliver);
        assert_eq!(verdict(MeStatus::Focus, "asking"), Verdict::Deliver);
        assert_eq!(verdict(MeStatus::Focus, "completed"), Verdict::Hold);
        assert_eq!(verdict(MeStatus::Away, "asking"), Verdict::Hold);
        assert_eq!(verdict(MeStatus::Away, "completed"), Verdict::Hold);
    }

    #[test]
    fn the_summary_counts_and_names_the_first_few() {
        let held = |t: &str| Held { title: t.into(), body: "done".into() };

        assert!(summary(&[]).is_none());
        assert_eq!(summary(&[held("Ada")]).unwrap().0, "1 update while you were away");

        let (title, body) = summary(&[held("A"), held("B"), held("C"), held("D"), held("E")]).unwrap();
        assert_eq!(title, "5 updates while you were away");
        assert_eq!(body, "A: done · B: done · C: done · and 2 more");
    }
}
