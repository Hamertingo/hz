//! Where each computer action lands, so the mascot can fly there. The log holds a tool, a point and a short label, never typed text.

use std::io::Write;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One action on screen. `time` is unix milliseconds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Action {
    pub time: i64,
    pub agent: String,
    pub tool: String,
    pub x: f64,
    pub y: f64,
    pub label: String,
    /// True when the point is the centre of a box rather than a coordinate the agent named.
    pub approx: bool,
}

const POINTER_WORDS: [&str; 8] = ["click", "tap", "move", "hover", "scroll", "drag", "mouse", "press_at"];
const TARGET_KEYS: [&str; 7] = ["target", "element", "element_name", "label", "name", "aria_label", "button_text"];
const MAX_TARGET: usize = 40;

/// The word that says what kind of action this is: the tool name, or for a generic "computer" tool, its `action` field.
fn kind(tool: &str, input: &Value) -> String {
    let t = tool.to_ascii_lowercase();
    if POINTER_WORDS.iter().any(|w| t.contains(w)) || t.contains("type") || t.contains("key") {
        return t;
    }
    input.get("action").and_then(|a| a.as_str()).map(|a| a.to_ascii_lowercase()).unwrap_or(t)
}

fn num(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn pair(v: &Value) -> Option<(f64, f64)> {
    if let Some(a) = v.as_array() {
        return Some((num(a.first()?)?, num(a.get(1)?)?));
    }
    let o = v.as_object()?;
    let get = |ks: &[&str]| ks.iter().find_map(|k| o.get(*k).and_then(num));
    Some((get(&["x", "X", "clientX", "pageX", "left"])?, get(&["y", "Y", "clientY", "pageY", "top"])?))
}

/// Reads a point from a pointer-style tool's input: `x`/`y`, `coordinate`, `position`, or a box (whose centre is approximate).
pub fn locate(tool: &str, input: &Value) -> Option<(f64, f64, bool)> {
    let k = kind(tool, input);
    if !POINTER_WORDS.iter().any(|w| k.contains(w)) {
        return None;
    }
    if let Some((x, y)) = pair(input) {
        return Some((x, y, false));
    }
    for key in ["coordinate", "coordinates", "position", "pos", "point", "at", "start_coordinate"] {
        if let Some((x, y)) = input.get(key).and_then(pair) {
            return Some((x, y, false));
        }
    }
    for key in ["bbox", "box", "rect", "bounds"] {
        let Some(b) = input.get(key) else { continue };
        if let Some(a) = b.as_array() {
            let n: Vec<f64> = a.iter().filter_map(num).collect();
            if n.len() == 4 {
                return Some((n[0] + n[2] / 2.0, n[1] + n[3] / 2.0, true));
            }
        } else if let (Some((x, y)), Some(o)) = (pair(b), b.as_object()) {
            let w = o.get("width").or(o.get("w")).and_then(num)?;
            let h = o.get("height").or(o.get("h")).and_then(num)?;
            return Some((x + w / 2.0, y + h / 2.0, true));
        }
    }
    None
}

fn clean_target(s: &str) -> String {
    let flat: String = s.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let flat = flat.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() > MAX_TARGET {
        format!("{}…", flat.chars().take(MAX_TARGET).collect::<String>().trim_end())
    } else {
        flat
    }
}

/// A short phrase such as "Clicking Send". Typing and key presses get a fixed phrase: what was typed is never read.
pub fn label_for(tool: &str, input: &Value) -> String {
    let k = kind(tool, input);
    let verb = if k.contains("type") || k.contains("text") || k.contains("fill") {
        return "Typing".into();
    } else if k.contains("key") {
        return "Pressing a key".into();
    } else if k.contains("double") {
        "Double-clicking"
    } else if k.contains("right") {
        "Right-clicking"
    } else if k.contains("click") || k.contains("tap") {
        "Clicking"
    } else if k.contains("hover") || k.contains("move") || k.contains("mouse") {
        "Moving to"
    } else if k.contains("scroll") {
        "Scrolling"
    } else if k.contains("drag") {
        "Dragging"
    } else {
        return "Working".into();
    };
    if verb == "Scrolling" {
        if let Some(d) = input.get("direction").and_then(|d| d.as_str()).filter(|d| ["up", "down", "left", "right"].contains(d)) {
            return format!("Scrolling {d}");
        }
    }
    let target = TARGET_KEYS.iter().find_map(|k| input.get(*k).and_then(|v| v.as_str())).map(clean_target).filter(|t| !t.is_empty());
    match target {
        Some(t) => format!("{verb} {t}"),
        None => verb.to_string(),
    }
}

/// Appends one JSON line; does nothing when `enabled` is false. On unix the folder is made 0700 and the file 0600.
pub fn append(path: &Path, action: &Action, enabled: bool) -> std::io::Result<()> {
    if !enabled {
        return Ok(());
    }
    if let Some(dir) = path.parent() {
        let existed = dir.exists();
        std::fs::create_dir_all(dir)?;
        #[cfg(unix)]
        if !existed {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
        }
    }
    let mut opts = std::fs::OpenOptions::new();
    opts.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(path)?;
    writeln!(f, "{}", serde_json::to_string(action).map_err(std::io::Error::other)?)
}

/// Actions logged after `since` (unix ms, exclusive); unreadable lines are skipped.
pub fn read_since(path: &Path, since: i64) -> Vec<Action> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return vec![];
    };
    text.lines().filter_map(|l| serde_json::from_str::<Action>(l).ok()).filter(|a| a.time > since).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("hz-cursor-{}", uuid::Uuid::new_v4()))
    }
    fn act(time: i64) -> Action {
        Action { time, agent: "ana".into(), tool: "click".into(), x: 1.0, y: 2.0, label: "Clicking Send".into(), approx: false }
    }

    #[test]
    fn locates_plain_xy_and_arrays_and_objects() {
        assert_eq!(locate("click", &json!({"x": 10, "y": 20.5})), Some((10.0, 20.5, false)));
        assert_eq!(locate("computer", &json!({"action":"left_click","coordinate":[5,6]})), Some((5.0, 6.0, false)));
        assert_eq!(locate("mouse_move", &json!({"position":{"clientX":3,"clientY":4}})), Some((3.0, 4.0, false)));
        assert_eq!(locate("click", &json!({"x":"7","y":"8"})), Some((7.0, 8.0, false)));
    }

    #[test]
    fn box_centre_is_approximate() {
        assert_eq!(locate("click", &json!({"bbox":[10,10,20,40]})), Some((20.0, 30.0, true)));
        assert_eq!(locate("click", &json!({"rect":{"x":0,"y":0,"width":10,"height":10}})), Some((5.0, 5.0, true)));
    }

    #[test]
    fn non_pointer_or_missing_gives_none() {
        assert_eq!(locate("type", &json!({"x":1,"y":2})), None);
        assert_eq!(locate("read_file", &json!({"x":1,"y":2})), None);
        assert_eq!(locate("click", &json!({"selector":"#go"})), None);
        assert_eq!(locate("click", &json!({"x":1})), None);
    }

    #[test]
    fn labels_use_target() {
        assert_eq!(label_for("click", &json!({"target":"Send"})), "Clicking Send");
        assert_eq!(label_for("computer", &json!({"action":"double_click","element":"Row"})), "Double-clicking Row");
        assert_eq!(label_for("click", &json!({})), "Clicking");
        assert_eq!(label_for("scroll", &json!({"direction":"down"})), "Scrolling down");
        assert_eq!(label_for("hover", &json!({"name":"Menu"})), "Moving to Menu");
        assert_eq!(label_for("mystery", &json!({})), "Working");
    }

    #[test]
    fn typed_text_never_appears() {
        let secret = "hunter2-correct-horse";
        for (tool, input) in [
            ("type", json!({"text": secret})),
            ("computer", json!({"action":"type","text": secret, "target":"Password"})),
            ("fill_form", json!({"value": secret, "label": "Password"})),
            ("key", json!({"keys": secret})),
            ("click", json!({"text": secret, "target": "Send"})),
            ("click", json!({"value": secret})),
        ] {
            let l = label_for(tool, &input);
            assert!(!l.contains(secret), "{tool}: {l}");
        }
        assert_eq!(label_for("type", &json!({"text":"x"})), "Typing");
        assert_eq!(label_for("press_key", &json!({"key":"Enter"})), "Pressing a key");
    }

    #[test]
    fn long_and_multiline_targets_are_tamed() {
        let l = label_for("click", &json!({"target": format!("a\nb {}", "z".repeat(100))}));
        assert!(!l.contains('\n'));
        assert!(l.chars().count() < 60);
    }

    #[test]
    fn append_and_read_since() {
        let p = tmp().join("c.jsonl");
        append(&p, &act(1), true).unwrap();
        append(&p, &act(5), true).unwrap();
        assert_eq!(read_since(&p, 0).len(), 2);
        assert_eq!(read_since(&p, 1), vec![act(5)]);
        assert!(read_since(&p, 5).is_empty());
    }

    #[test]
    fn disabled_writes_nothing() {
        let p = tmp().join("c.jsonl");
        append(&p, &act(1), false).unwrap();
        assert!(!p.exists());
        assert!(read_since(&p, 0).is_empty());
    }

    #[test]
    fn bad_lines_are_skipped() {
        let p = tmp().join("c.jsonl");
        append(&p, &act(1), true).unwrap();
        std::fs::OpenOptions::new().append(true).open(&p).unwrap().write_all(b"junk\n").unwrap();
        append(&p, &act(2), true).unwrap();
        assert_eq!(read_since(&p, 0).len(), 2);
    }

    #[cfg(unix)]
    #[test]
    fn permissions_are_private() {
        use std::os::unix::fs::PermissionsExt;
        let d = tmp();
        let p = d.join("c.jsonl");
        append(&p, &act(1), true).unwrap();
        assert_eq!(std::fs::metadata(&d).unwrap().permissions().mode() & 0o777, 0o700);
        assert_eq!(std::fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o600);
    }
}
