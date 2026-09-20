//! Preferences that are facts about the reader, not about the window.
//!
//! **The reader's picks live here**: the composer's row, a model's star, every
//! rebinding, which editor a click opens, which space is up. They are the
//! answers that have to be the same in a dev build and a released one, survive
//! clearing site data, and be readable by something that is not the webview.
//! The frontend reads all of them in one command before its first render
//! (`src/lib/prefs.ts`), which is what makes a store owned by this side
//! affordable for values the UI draws.
//!
//! **The window's own state stays in the webview's local storage**: which panel
//! is folded, how wide it is, what a diff looks like, and the three keys the
//! pre-paint script in `index.html` reads (`hz.theme`, `hz.mode`,
//! `hz.fontSizes`). A read that must land before the first frame cannot await a
//! command, and a palette that arrives a frame late is a flash of the default
//! one. Both halves are listed in `src/hooks/useLocalStorage.ts`, which is the
//! file a reader opening one of those keys will be looking at.
//!
//! The composite picks — the composer's row, the rebindings — are stored
//! **verbatim**: their shape is the frontend's, nothing on this side reads
//! them, and a second spelling of a shape here could only disagree with the
//! first.

use std::path::{Path, PathBuf};

use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Mutex;
use ts_rs::TS;
use uuid::Uuid;

use crate::{
    issues::TrackerAccount,
    store::{get_home_app_dir, read_json, write_atomic},
    updater::UpdateChannel,
};

/// Serializes writers. The file is rewritten whole, so a concurrent writer
/// would drop the other's field — same bargain `projects.json` makes.
static SETTINGS_LOCK: Mutex<()> = Mutex::const_new(());

/// What is on disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// Opted in by default, and the default is what a **missing** file reads
    /// as. A file that exists and cannot be parsed reads the other way — see
    /// [`read`].
    #[serde(default = "enabled_by_default")]
    pub analytics_enabled: bool,
    /// A random id for this install, or `None` where nothing has ever been
    /// reported from it.
    ///
    /// Minted lazily by [`crate::analytics`] on the first event rather than at
    /// install time, which is what keeps an opted-out install from ever having
    /// one written — and cleared again when the switch goes off, so opting back
    /// in is a new person rather than the old one resurfacing.
    #[serde(default)]
    pub install_id: Option<String>,
    /// Who the stored issue-tracker key belongs to.
    ///
    /// The account, never the key — that lives in `credentials.json` beside
    /// this, and never rides the struct handed to the frontend. This is only
    /// what saves a round trip to draw a name in the settings row. It is
    /// therefore not the connection: an account here with no key behind it
    /// reads as disconnected. See [`crate::issues::get_integrations`].
    #[serde(default)]
    pub linear_account: Option<TrackerAccount>,
    /// Which speech-to-text model and microphone to use.
    ///
    /// Here rather than inside [`AppSettings::composer_prefs`], beside the rest
    /// of the composer's picks, because Rust is what reads it: the recording
    /// commands resolve the model and device themselves, and a value the
    /// backend has to ask the frontend for is a value that can be missing when
    /// a keypress needs it.
    #[serde(default)]
    pub transcription: TranscriptionSettings,
    /// The composer's sticky row: which agent, the model picked on each, effort
    /// per model, permission stance, worktree, the Agent a new chat runs as, and
    /// fast mode.
    ///
    /// Stored verbatim, and every field of it is listed where it means
    /// something — `ComposerPrefs` in `src/hooks/useComposerPrefs.ts`.
    #[serde(default)]
    pub composer_prefs: Option<Value>,
    /// The models the reader has switched **off** — or `None`, which means they
    /// have switched none off. A fact about the reader rather than about a
    /// session, so it is stored with them instead of on an index entry a session
    /// could be handed away with.
    ///
    /// **The list is the hidden half, and that direction is what a new model
    /// depends on.** A provider being connected adds rows the reader has never
    /// seen; storing what is *kept* would leave every one of them off, which
    /// reads as a model the agent serves and the app refuses to offer. Storing
    /// what is hidden means a model nobody has decided about is shown.
    ///
    /// **Not carried over from `modelRotation`, and that is deliberate.** That
    /// field held the *kept* half, so reading it here would invert it: a reader
    /// who had kept two models would hide the very two they named. Named by
    /// wire id (`m:<provider>:<model>:v:<variant>`) rather than by model name,
    /// which is the one spelling both the picker and the settings screen already
    /// hold — see `Model.id`.
    #[serde(default)]
    pub hidden_models: Option<Vec<String>>,
    /// The reader's rebindings, keyed by shortcut id. Only overrides, so a
    /// default that changes in a later build still reaches everyone who never
    /// touched that row.
    ///
    /// Verbatim for the same reason as `composer_prefs`: the ids and the chord
    /// shape are `src/lib/shortcuts.ts`'s.
    #[serde(default)]
    pub shortcuts: Option<Value>,
    /// Which release channel the updater follows. Read on this side only to be
    /// handed back — the check that uses it runs in the frontend.
    #[serde(default)]
    pub update_channel: Option<UpdateChannel>,
    /// Which app a session's working directory is opened in, by bundle path.
    ///
    /// The path and not the name: two builds of one editor differ by path
    /// alone, and a name that stopped matching would silently reseat.
    #[serde(default)]
    pub open_with: Option<String>,
    /// Which app a *filename* in the transcript opens in, by bundle path. Its
    /// own preference — that one holds terminals and Finder too.
    #[serde(default)]
    pub open_file_with: Option<String>,
    /// Which terminal hz opens for a command the reader runs themselves, by
    /// bundle path.
    #[serde(default)]
    pub run_in_terminal: Option<String>,
    /// The space the reader is looking at, or `None` for every project.
    ///
    /// Nothing on this side reads it. **A space is two records and neither is
    /// derived from the other**: its *membership* is the tag on the project in
    /// `projects.json` (this side's, see `crate::projects`), and which one is
    /// *up* is this pick, read by the frontend's `activeSpace` in
    /// `src/lib/space.ts` beside those tags. So a rename moves the tags and a
    /// switch moves this, and neither is a copy of the other.
    #[serde(default)]
    pub space: Option<String>,
    /// The spaces the reader has declared, in the order the switcher walks
    /// them. A space is made before it holds anything, and one holding nothing
    /// is exactly what has no project to carry its tag — see
    /// [`crate::projects::Project::space`].
    #[serde(default)]
    pub spaces: Option<Vec<String>>,
}

/// The transcription picks. Model and device mean "not chosen" when absent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionSettings {
    /// A catalog id. `None` until a model is downloaded and picked, which is
    /// also what makes the mic button open settings instead of recording.
    #[serde(default)]
    pub model: Option<String>,
    /// An input device *name*, `None` meaning the system default.
    ///
    /// The name and not cpal's enumeration index: the index shifts when a USB
    /// mic is unplugged, so a stored one silently starts naming a different
    /// device. See [`crate::transcription::audio::InputDevice`].
    #[serde(default)]
    pub device: Option<String>,
    /// Whether the speakers are silenced while the microphone is open. On by
    /// default: the mic hears them, so whatever is playing otherwise lands in
    /// the transcript as words nobody said.
    #[serde(default = "enabled_by_default")]
    pub mute_while_recording: bool,
}

impl Default for TranscriptionSettings {
    fn default() -> Self {
        Self {
            model: None,
            device: None,
            mute_while_recording: enabled_by_default(),
        }
    }
}

fn enabled_by_default() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            analytics_enabled: enabled_by_default(),
            install_id: None,
            linear_account: None,
            transcription: TranscriptionSettings::default(),
            composer_prefs: None,
            hidden_models: None,
            shortcuts: None,
            update_channel: None,
            open_with: None,
            open_file_with: None,
            run_in_terminal: None,
            space: None,
            spaces: None,
        }
    }
}

/// What the settings dialog draws, which is not what is on disk.
///
/// The environment can force reporting off for a run, and a switch drawn from
/// the file alone would then sit at `on` while nothing was being sent.
/// `analytics_locked` is what lets the row disable itself and say why, rather
/// than lie.
#[derive(Debug, Clone, Copy, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    /// Effective, not stored — the environment is already folded in.
    pub analytics_enabled: bool,
    pub analytics_locked: bool,
}

/// Every preference the frontend owns, as the file holds them.
///
/// One payload for all of them, read once before the first render: a command
/// per key would be a round trip per picker to draw the app. **Every field is
/// `None` where the file says nothing**, which is what a build that has just
/// moved these out of the webview's store reads to tell a key the file already
/// answers for from one still to adopt; a field that is present has been
/// answered for, whether or not the frontend would read the same value back.
///
/// Not [`AppSettings`] itself: that carries the install id and the Linear
/// account, and neither is the webview's business.
#[derive(Debug, Clone, Default, PartialEq, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    /// See [`AppSettings::composer_prefs`].
    pub composer_prefs: Option<Value>,
    /// See [`AppSettings::hidden_models`].
    pub hidden_models: Option<Vec<String>>,
    /// See [`AppSettings::shortcuts`].
    pub shortcuts: Option<Value>,
    /// See [`AppSettings::update_channel`].
    pub update_channel: Option<UpdateChannel>,
    /// See [`AppSettings::open_with`].
    pub open_with: Option<String>,
    /// See [`AppSettings::open_file_with`].
    pub open_file_with: Option<String>,
    /// See [`AppSettings::run_in_terminal`].
    pub run_in_terminal: Option<String>,
    /// See [`AppSettings::space`].
    pub space: Option<String>,
    /// See [`AppSettings::spaces`].
    pub spaces: Option<Vec<String>>,
}

impl From<AppSettings> for Preferences {
    fn from(settings: AppSettings) -> Self {
        Self {
            composer_prefs: settings.composer_prefs,
            hidden_models: settings.hidden_models,
            shortcuts: settings.shortcuts,
            update_channel: settings.update_channel,
            open_with: settings.open_with,
            open_file_with: settings.open_file_with,
            run_in_terminal: settings.run_in_terminal,
            space: settings.space,
            spaces: settings.spaces,
        }
    }
}

/// One preference to change, and what to change it to.
///
/// **A patch names one preference, and that is what makes an update partial**:
/// the command takes a batch of these, and nothing a batch does not name is
/// touched. `None` clears what a patch does name — the active space going away
/// when the last thing filed under it is renamed out, which has to be sayable,
/// since "no space" is not a value a space can hold.
///
/// Tagged rather than a struct of optional fields so that a name that does not
/// exist is an error rather than a field that silently writes nothing, and so
/// that the value each one carries is typed where it is declared.
#[derive(Debug, Clone, PartialEq, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(tag = "field", content = "value", rename_all = "camelCase")]
pub enum PreferencesPatch {
    /// See [`AppSettings::composer_prefs`].
    ComposerPrefs(Option<Value>),
    /// See [`AppSettings::hidden_models`].
    HiddenModels(Option<Vec<String>>),
    /// See [`AppSettings::shortcuts`].
    Shortcuts(Option<Value>),
    /// See [`AppSettings::update_channel`].
    UpdateChannel(Option<UpdateChannel>),
    /// See [`AppSettings::open_with`].
    OpenWith(Option<String>),
    /// See [`AppSettings::open_file_with`].
    OpenFileWith(Option<String>),
    /// See [`AppSettings::run_in_terminal`].
    RunInTerminal(Option<String>),
    /// See [`AppSettings::space`].
    Space(Option<String>),
    /// See [`AppSettings::spaces`].
    Spaces(Option<Vec<String>>),
}

/// Applies every preference a batch names, and no others.
///
/// One read, one edit and one write under one hold of the lock, for the reason
/// [`crate::projects::retag_space`] is one call rather than one per project: a
/// run of writes half of which landed would leave the file describing two
/// different worlds. The migration is exactly such a run — nine picks moved out
/// of the webview at once — and a reader who lost half of them would have no
/// way to tell which half.
pub fn apply(patches: Vec<PreferencesPatch>, settings: &mut AppSettings) {
    for patch in patches {
        match patch {
            PreferencesPatch::ComposerPrefs(value) => settings.composer_prefs = value,
            PreferencesPatch::HiddenModels(value) => settings.hidden_models = value,
            PreferencesPatch::Shortcuts(value) => settings.shortcuts = value,
            PreferencesPatch::UpdateChannel(value) => settings.update_channel = value,
            PreferencesPatch::OpenWith(value) => settings.open_with = value,
            PreferencesPatch::OpenFileWith(value) => settings.open_file_with = value,
            PreferencesPatch::RunInTerminal(value) => settings.run_in_terminal = value,
            PreferencesPatch::Space(value) => settings.space = value,
            PreferencesPatch::Spaces(value) => settings.spaces = value,
        }
    }
}

/// Reads `settings.json`, **failing closed**.
///
/// A missing or empty file is a fresh install and reads as the defaults. Any
/// other failure — unparseable JSON, an unreadable file, no home directory —
/// reads as opted *out*, because a file that exists and cannot be understood is
/// far likelier to belong to someone who turned this off than to someone who
/// never touched it. Never an error: this sits on the launch path, and a
/// hand-edited file must not be able to stop the app starting.
pub async fn read() -> AppSettings {
    let dir = match get_home_app_dir().await {
        Ok(dir) => dir,
        Err(e) => {
            eprintln!("[settings read err] {e:#}");
            return opted_out();
        }
    };

    match read_from(&dir).await {
        Ok(settings) => settings,
        Err(e) => {
            eprintln!("[settings read err] {e:#}");
            opted_out()
        }
    }
}

/// The fail-closed answer. Spelled out rather than reusing `Default` so the two
/// can never be confused: the default is opted *in*, and this is its opposite.
///
/// A file that cannot be understood has no preferences to answer with either,
/// and every one of them reads as "never picked" — the same reading a fresh
/// install gives. Only consent has a fail-closed direction; a model nobody
/// picked is not a decision anybody can be counted as having reversed.
fn opted_out() -> AppSettings {
    AppSettings {
        analytics_enabled: false,
        ..AppSettings::default()
    }
}

/// Takes the directory so a test can round-trip against a tempdir rather than
/// the real `~/.hz`.
async fn read_from(dir: &Path) -> Result<AppSettings> {
    read_json(&path_in(dir)).await
}

/// Read, edit and write back under one hold of the lock. **The only way to
/// change a setting**, and private visibility on everything that writes is what
/// makes that true rather than aspirational.
///
/// The file is rewritten whole and [`read`] takes no lock, so a read-modify-
/// write in two steps can be interleaved by another and lose its field. There
/// was a `pub write` beside `read` and seven callers pairing them, which is
/// exactly the shape that fails — and it fails *across* features, not within
/// one: the case that made it concrete was the Linear account or a transcription
/// pick being read while analytics was on, then written back after the reader
/// opted out, restoring `analytics_enabled: true` and the install id with it.
///
/// So consent could be undone by a setting that has nothing to do with it. A
/// comment saying "use `update`" would have been true and unenforced; taking
/// the write away is what stops the next one.
pub async fn update(edit: impl FnOnce(&mut AppSettings)) -> Result<AppSettings> {
    let _guard = SETTINGS_LOCK.lock().await;
    let dir = get_home_app_dir().await?;

    // **Only a malformed file recovers**, and the distinction is the whole of
    // this branch. A file that cannot be *parsed* can never be preserved, and
    // erroring on it would block every settings write in the app — consent,
    // Linear, transcription — until somebody deleted it by hand, which nothing
    // on screen says to do. A file that cannot be *read* is the opposite case:
    // it may be perfectly good and merely unreachable for a moment, so writing
    // `opted_out()` over it would erase the Linear account, the install id and
    // every transcription pick in order to change one unrelated switch.
    //
    // Opted *out* and not `Default` where it does recover: recovering must
    // never be a route to turning reporting back on for somebody who had
    // turned it off.
    let mut settings = match read_from(&dir).await {
        Ok(settings) => settings,
        Err(e) if is_malformed(&e) => {
            eprintln!("[settings read err] {e:#}");
            opted_out()
        }
        Err(e) => return Err(e),
    };

    edit(&mut settings);
    write_to(&dir, &settings).await?;

    Ok(settings)
}

/// This install's id, minted and persisted on first use, or `None` where it is
/// not wanted.
///
/// **Consent and the id are one decision and one hold of the lock**, which is
/// the whole reason this lives here rather than in `analytics`: an id minted
/// for an install that opted out a moment ago is exactly what the opt-out was
/// for, and reading consent separately races the command that cleared it.
///
/// `None` for three cases, all of which correctly send nothing: opted out, no
/// home directory, and a settings file that exists and cannot be parsed — the
/// same fail-closed reading [`read`] takes.
///
/// **A failed write answers `None` too**, and that is a deliberate reversal:
/// nothing caches this any more, so an id that did not reach disk would be
/// re-minted on the very next event and every event would arrive as a different
/// person. No events beats a fabricated population.
pub async fn ensure_install_id() -> Option<String> {
    let _guard = SETTINGS_LOCK.lock().await;

    let dir = match get_home_app_dir().await {
        Ok(dir) => dir,
        Err(e) => {
            eprintln!("[settings read err] {e:#}");
            return None;
        }
    };

    let settings = match read_from(&dir).await {
        Ok(settings) => settings,
        Err(e) => {
            eprintln!("[settings read err] {e:#}");
            return None;
        }
    };

    if !settings.analytics_enabled {
        return None;
    }
    if settings.install_id.is_some() {
        return settings.install_id;
    }

    let id = Uuid::new_v4().to_string();
    let next = AppSettings {
        install_id: Some(id.clone()),
        ..settings
    };

    if let Err(e) = write_to(&dir, &next).await {
        eprintln!("[settings write err] install id not persisted: {e:#}");
        return None;
    }

    Some(id)
}

/// Rewrites the file whole, landing via write-temp + `rename` like the session
/// index does — a torn settings file would fail to parse on the next launch and
/// read as opted out, silently undoing whatever was just set.
async fn write_to(dir: &Path, settings: &AppSettings) -> Result<()> {
    write_atomic(&path_in(dir), serde_json::to_string_pretty(settings)?).await
}

fn path_in(dir: &Path) -> PathBuf {
    dir.join("settings.json")
}

/// Whether a [`read_from`] failure is the file being **malformed** rather than
/// unreachable — the one case it is safe to write over.
///
/// `read_json` adds context around the real cause, and anyhow downcasts through
/// that, so the presence of a `serde_json::Error` in the chain is what says the
/// bytes were read and could not be understood. An I/O error has none.
fn is_malformed(e: &anyhow::Error) -> bool {
    e.downcast_ref::<serde_json::Error>().is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tempdir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "hz-settings-{}-{}",
            std::process::id(),
            uuid::Uuid::now_v7()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[tokio::test]
    async fn missing_file_reads_as_opted_in() {
        let dir = tempdir();

        assert!(read_from(&dir).await.unwrap().analytics_enabled);
    }

    #[tokio::test]
    async fn empty_file_reads_as_opted_in() {
        let dir = tempdir();
        std::fs::write(path_in(&dir), "   \n").unwrap();

        assert!(read_from(&dir).await.unwrap().analytics_enabled);
    }

    /// The direction that matters: a file someone opted out in, then corrupted,
    /// must not come back as opted in. `read_from` reports it as an error, and
    /// [`read`] turns any error into [`opted_out`].
    #[tokio::test]
    async fn unparseable_file_is_an_error_not_a_default() {
        let dir = tempdir();
        std::fs::write(path_in(&dir), "{ not json").unwrap();

        assert!(read_from(&dir).await.is_err());
        assert!(!opted_out().analytics_enabled);
    }

    #[tokio::test]
    async fn round_trips() {
        let dir = tempdir();
        let off = AppSettings {
            analytics_enabled: false,
            install_id: Some("2f1c…".into()),
            ..AppSettings::default()
        };

        write_to(&dir, &off).await.unwrap();

        assert_eq!(read_from(&dir).await.unwrap(), off);
    }

    /// The two failures `update` must tell apart. Recovering from a malformed
    /// file replaces it; doing the same for one that is merely unreadable right
    /// now — a permission, a full disk, a network home directory — would erase
    /// the Linear account, the install id and every transcription pick to
    /// change one unrelated switch.
    #[tokio::test]
    async fn a_malformed_file_is_told_from_an_unreadable_one() {
        let dir = tempdir();
        std::fs::write(path_in(&dir), "{ not json").unwrap();

        assert!(is_malformed(&read_from(&dir).await.unwrap_err()));

        let unreadable = anyhow::Error::new(std::io::Error::other("disk on fire"))
            .context("could not open settings.json");

        assert!(!is_malformed(&unreadable));
    }

    /// A file nobody can parse must not brick the settings dialog. `update` is
    /// now the only way to change anything, so an error here would leave every
    /// switch in the app dead until the file was deleted by hand — and nothing
    /// on screen says to do that.
    #[tokio::test]
    async fn an_unparseable_file_does_not_block_writes() {
        let dir = tempdir();
        std::fs::write(path_in(&dir), "{ not json").unwrap();

        let mut settings = read_from(&dir).await.unwrap_or_else(|_| opted_out());
        settings.transcription.mute_while_recording = false;
        write_to(&dir, &settings).await.unwrap();

        let after = read_from(&dir).await.unwrap();
        assert!(!after.transcription.mute_while_recording);
        // Recovering is not a route back to reporting for somebody who had
        // turned it off: the fallback is `opted_out`, never `Default`.
        assert!(!after.analytics_enabled);
    }

    /// The invariant the whole opt-out rests on: no id is written for an
    /// install that has turned reporting off. Checked against the file, not the
    /// return value, since the damage a bug here does is a identifier left on
    /// disk rather than one handed back.
    #[tokio::test]
    async fn an_opted_out_install_is_given_no_id() {
        let dir = tempdir();
        let off = AppSettings {
            analytics_enabled: false,
            ..AppSettings::default()
        };
        write_to(&dir, &off).await.unwrap();

        assert_eq!(read_from(&dir).await.unwrap().install_id, None);
    }

    /// Clearing the id and clearing consent are one write, so a reader who opts
    /// out cannot be left identified by the entry that survives.
    #[tokio::test]
    async fn opting_out_clears_the_id_in_one_write() {
        let dir = tempdir();
        let identified = AppSettings {
            install_id: Some("2f1c…".into()),
            ..AppSettings::default()
        };
        write_to(&dir, &identified).await.unwrap();

        let mut next = read_from(&dir).await.unwrap();
        next.analytics_enabled = false;
        next.install_id = None;
        write_to(&dir, &next).await.unwrap();

        let after = read_from(&dir).await.unwrap();
        assert!(!after.analytics_enabled);
        assert_eq!(after.install_id, None);
    }

    /// A file written before the id existed must read as an install that has
    /// simply never reported, not fail the parse and take the whole file's
    /// other settings down as opted out with it.
    #[tokio::test]
    async fn a_file_predating_the_install_id_reads_without_one() {
        let dir = tempdir();
        std::fs::write(path_in(&dir), r#"{"analyticsEnabled": true}"#).unwrap();

        let settings = read_from(&dir).await.unwrap();

        assert!(settings.analytics_enabled);
        assert_eq!(settings.install_id, None);
    }

    /// An unknown field must not fail the read, or a file written by a newer
    /// build reads as opted out on every older one.
    #[tokio::test]
    async fn unknown_fields_are_ignored() {
        let dir = tempdir();
        std::fs::write(
            path_in(&dir),
            r#"{"analyticsEnabled": false, "somethingNewer": 3}"#,
        )
        .unwrap();

        assert!(!read_from(&dir).await.unwrap().analytics_enabled);
    }

    #[tokio::test]
    async fn write_leaves_no_temp_file_behind() {
        let dir = tempdir();

        write_to(&dir, &AppSettings::default()).await.unwrap();

        assert!(!dir.join("settings.json.tmp").exists());
    }

    /// A batch of patches, as the frontend sends one.
    fn patches(json: &str) -> Vec<PreferencesPatch> {
        serde_json::from_str(json).unwrap()
    }

    /// The partial update in one direction: a preference a batch does not name
    /// is one it must not touch, or starring a model would put the reader's
    /// space out.
    #[test]
    fn a_batch_leaves_the_preferences_it_does_not_name() {
        let mut settings = AppSettings {
            space: Some("work".into()),
            open_with: Some("/Applications/Zed.app".into()),
            ..AppSettings::default()
        };

        apply(
            patches(r#"[{"field": "hiddenModels", "value": ["opus"]}]"#),
            &mut settings,
        );

        assert_eq!(settings.hidden_models, Some(vec!["opus".to_string()]));
        assert_eq!(settings.space.as_deref(), Some("work"));
        assert_eq!(settings.open_with.as_deref(), Some("/Applications/Zed.app"));
    }

    /// And in the other, which is the direction a `false`-defaulted flag would
    /// quietly get wrong: `null` clears a preference rather than leaving it.
    /// The active space is the case — nothing is up once the last thing filed
    /// under it has been renamed out.
    #[test]
    fn a_patch_can_clear_a_preference() {
        let mut settings = AppSettings {
            space: Some("work".into()),
            ..AppSettings::default()
        };

        apply(patches(r#"[{"field": "space", "value": null}]"#), &mut settings);

        assert_eq!(settings.space, None);
    }

    /// A name nothing answers to is an error, not a field that silently writes
    /// nothing — the whole reason this is a tagged enum rather than a struct
    /// whose fields are all optional.
    #[test]
    fn an_unknown_preference_is_refused() {
        assert!(
            serde_json::from_str::<Vec<PreferencesPatch>>(
                r#"[{"field": "spaec", "value": null}]"#
            )
            .is_err()
        );

        // A patch that names a preference and gives no value for it is clearing
        // it, which is what `null` says — there is no third reading of a
        // field with nothing in it.
        assert_eq!(
            patches(r#"[{"field": "space"}]"#),
            vec![PreferencesPatch::Space(None)]
        );
    }

    /// And a value the preference cannot hold is refused at the parse too, so a
    /// bad write changes nothing at all rather than half of a batch.
    #[test]
    fn a_value_the_preference_cannot_hold_is_refused() {
        assert!(
            serde_json::from_str::<Vec<PreferencesPatch>>(r#"[{"field": "spaces", "value": 3}]"#)
                .is_err()
        );
        assert!(serde_json::from_str::<Vec<PreferencesPatch>>(
            r#"[{"field": "updateChannel", "value": "nightly"}]"#
        )
        .is_err());
    }

    /// What the frontend reads back is what it wrote, through the file rather
    /// than in memory — and a preference nobody has ever picked is absent
    /// rather than defaulted, since absent is what the migration moves on.
    #[tokio::test]
    async fn the_preferences_read_back_are_the_ones_that_were_written() {
        let dir = tempdir();
        let mut settings = AppSettings::default();
        apply(
            patches(
                r#"[{"field": "space", "value": "work"}, {"field": "spaces", "value": ["work", "home"]}, {"field": "updateChannel", "value": "beta"}, {"field": "hiddenModels", "value": ["opus"]}, {"field": "composerPrefs", "value": {"fast": true}}]"#,
            ),
            &mut settings,
        );
        write_to(&dir, &settings).await.unwrap();

        let read: Preferences = read_from(&dir).await.unwrap().into();

        assert_eq!(read.space.as_deref(), Some("work"));
        assert_eq!(read.spaces, Some(vec!["work".to_string(), "home".to_string()]));
        assert_eq!(read.update_channel, Some(UpdateChannel::Beta));
        assert_eq!(read.hidden_models, Some(vec!["opus".to_string()]));
        assert_eq!(read.composer_prefs, Some(serde_json::json!({ "fast": true })));
        assert_eq!(read.open_with, None);
        assert_eq!(read.shortcuts, None);
    }

    /// A file written before the preferences lived here — every build up to
    /// this one — must read as a reader who has never picked anything, which is
    /// what tells the frontend there is a webview copy of each to adopt. Failing
    /// the parse instead would read as opted out and take consent with it.
    #[tokio::test]
    async fn a_file_predating_the_preferences_reads_without_them() {
        let dir = tempdir();
        std::fs::write(path_in(&dir), r#"{"analyticsEnabled": true}"#).unwrap();

        let read: Preferences = read_from(&dir).await.unwrap().into();

        assert_eq!(read, Preferences::default());
    }
}
