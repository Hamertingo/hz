//! QR logins: the code is cropped out of the page and shown to the user as a card that refreshes, or the user pairs by phone number.
//! When the page does not look the way an adapter expects, the card asks for a takeover instead of waiting forever.
//!
//! Page description given to adapters: `{"url", "text", "elements": [{"selector", "tag", "text", "aria", "rect": {x, y, w, h}}]}`.

use std::fmt;

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A QR code older than this is replaced; sites rotate theirs about this often.
pub const REFRESH_SECONDS: i64 = 20;

/// A box on the page in CSS pixels.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// A phone number that never prints and never goes to the agent.
pub struct PhoneNumber(String);

impl PhoneNumber {
    /// Keeps digits and a leading plus; returns None when fewer than 7 digits remain.
    pub fn parse(raw: &str) -> Option<Self> {
        let digits: String = raw.chars().filter(|c| c.is_ascii_digit()).collect();
        (7..=15).contains(&digits.len()).then_some(Self(digits))
    }

    /// The digits, for typing into the page.
    pub fn digits(&self) -> &str {
        &self.0
    }
}

impl Clone for PhoneNumber {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

impl fmt::Debug for PhoneNumber {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("PhoneNumber([redacted])")
    }
}

impl fmt::Display for PhoneNumber {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[redacted]")
    }
}

/// One browser action of the pairing flow.
#[derive(Debug, Clone)]
pub enum Step {
    /// Click the element showing this text.
    ClickText(String),
    /// Type the number into the input matching `selector`.
    TypeNumber { selector: String, number: PhoneNumber },
}

/// An element the adapter needed and the page did not have.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Missing(pub String);

/// What one site looks like.
pub trait Adapter {
    /// Name shown on the card.
    fn site(&self) -> &str;
    /// Whether the page is showing a QR code to scan.
    fn is_qr_page(&self, page: &Value) -> bool;
    /// Where the QR code is on the page.
    fn qr_region(&self, page: &Value) -> Result<Rect, Missing>;
    /// The clicks and typing that switch to pairing by phone number.
    fn phone_pairing_steps(&self, number: &PhoneNumber) -> Vec<Step>;
    /// The pairing code the page shows after the number is accepted.
    fn read_pairing_code(&self, page: &Value) -> Option<String>;
    /// Whether the page is already signed in.
    fn is_signed_in(&self, _page: &Value) -> bool {
        false
    }
}

fn elements(page: &Value) -> Vec<&Value> {
    page.get("elements").and_then(|e| e.as_array()).map(|a| a.iter().collect()).unwrap_or_default()
}

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("")
}

fn page_text(page: &Value) -> String {
    let mut t = s(page, "text").to_ascii_lowercase();
    for e in elements(page) {
        t.push(' ');
        t.push_str(&s(e, "text").to_ascii_lowercase());
    }
    t
}

fn rect_of(e: &Value) -> Option<Rect> {
    let r = e.get("rect")?;
    let n = |k: &str| r.get(k).and_then(|v| v.as_f64());
    let rect = Rect { x: n("x")?, y: n("y")?, w: n("w")?, h: n("h")? };
    (rect.w > 0.0 && rect.h > 0.0).then_some(rect)
}

/// An adapter for sites in WhatsApp Web's style: a canvas labelled for scanning, a "link with phone number" switch.
pub struct WhatsAppLike;

impl WhatsAppLike {
    fn qr_element<'a>(&self, page: &'a Value) -> Option<&'a Value> {
        elements(page).into_iter().find(|e| {
            let tag = s(e, "tag");
            let label = format!("{} {}", s(e, "aria"), s(e, "text")).to_ascii_lowercase();
            matches!(tag, "canvas" | "img" | "svg") && (label.contains("qr") || label.contains("scan"))
        })
    }
}

impl Adapter for WhatsAppLike {
    fn site(&self) -> &str {
        "WhatsApp"
    }

    fn is_qr_page(&self, page: &Value) -> bool {
        let t = page_text(page);
        self.qr_element(page).is_some() || t.contains("scan the qr") || t.contains("link a device")
    }

    fn qr_region(&self, page: &Value) -> Result<Rect, Missing> {
        let e = self.qr_element(page).ok_or_else(|| Missing("the QR code".into()))?;
        rect_of(e).ok_or_else(|| Missing("the size of the QR code".into()))
    }

    fn phone_pairing_steps(&self, number: &PhoneNumber) -> Vec<Step> {
        vec![
            Step::ClickText("Link with phone number".into()),
            Step::TypeNumber { selector: "input[type=tel]".into(), number: number.clone() },
            Step::ClickText("Next".into()),
        ]
    }

    fn read_pairing_code(&self, page: &Value) -> Option<String> {
        let re = Regex::new(r"\b[A-Z0-9]{4}-[A-Z0-9]{4}\b").ok()?;
        let mut text = s(page, "text").to_string();
        for e in elements(page) {
            text.push(' ');
            text.push_str(s(e, "text"));
        }
        re.find(&text).map(|m| m.as_str().to_string())
    }

    fn is_signed_in(&self, page: &Value) -> bool {
        !self.is_qr_page(page) && page_text(page).contains("chats")
    }
}

/// Where a QR login stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum QrState {
    Waiting,
    Scanned,
    Expired,
    NeedsTakeover,
}

/// What the user sees: the cropped code and its state. `refreshed_at` is unix seconds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct QrCard {
    pub site: String,
    pub image_rect: Rect,
    pub refreshed_at: i64,
    pub state: QrState,
    /// Set with `NeedsTakeover`: what was missing, in words for the user.
    pub reason: Option<String>,
}

impl QrCard {
    /// A waiting card for a code captured at `now`.
    pub fn waiting(site: &str, image_rect: Rect, now: i64) -> Self {
        Self { site: site.into(), image_rect, refreshed_at: now, state: QrState::Waiting, reason: None }
    }

    fn takeover(&self, reason: String) -> Self {
        Self { state: QrState::NeedsTakeover, reason: Some(reason), ..self.clone() }
    }
}

/// True when the code should be captured again: expired, or waiting longer than the refresh interval.
pub fn needs_refresh(card: &QrCard, now: i64) -> bool {
    match card.state {
        QrState::Expired => true,
        QrState::Waiting => now - card.refreshed_at >= REFRESH_SECONDS,
        QrState::Scanned | QrState::NeedsTakeover => false,
    }
}

/// Reads a fresh page and moves the card on. Anything unexpected becomes `NeedsTakeover` with a reason, never a wait.
pub fn advance(adapter: &dyn Adapter, page: &Value, card: &QrCard, now: i64) -> QrCard {
    if adapter.is_signed_in(page) {
        return QrCard { state: QrState::Scanned, reason: None, ..card.clone() };
    }
    if adapter.is_qr_page(page) {
        return match adapter.qr_region(page) {
            Ok(rect) => QrCard { image_rect: rect, refreshed_at: now, state: QrState::Waiting, reason: None, ..card.clone() },
            Err(Missing(what)) => card.takeover(format!("{} could not be found on the page", what)),
        };
    }
    let t = page_text(page);
    if t.contains("expired") || t.contains("click to reload") || t.contains("reload qr") {
        return QrCard { state: QrState::Expired, reason: None, ..card.clone() };
    }
    card.takeover(format!("the {} page looks different than expected", adapter.site()))
}

/// The steps to pair by phone number, after checking the first control is on the page. The number only ever goes into the page.
pub fn plan_phone_pairing(adapter: &dyn Adapter, page: &Value, number: &PhoneNumber) -> Result<Vec<Step>, Missing> {
    let steps = adapter.phone_pairing_steps(number);
    if let Some(Step::ClickText(t)) = steps.first() {
        if !page_text(page).contains(&t.to_ascii_lowercase()) {
            return Err(Missing(format!("the \"{t}\" button")));
        }
    }
    Ok(steps)
}

/// The pairing code to show the user once the number was accepted; a missing code asks for a takeover.
pub fn pairing_code(adapter: &dyn Adapter, page: &Value) -> Result<String, Missing> {
    adapter.read_pairing_code(page).ok_or_else(|| Missing("the pairing code".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn qr_page() -> Value {
        json!({
            "url": "https://web.example/",
            "text": "Use WhatsApp on your computer. Scan the QR code to link a device.",
            "elements": [
                {"selector":"canvas","tag":"canvas","aria":"Scan this QR code","rect":{"x":100,"y":200,"w":264,"h":264}},
                {"selector":"a","tag":"a","text":"Link with phone number"}
            ]
        })
    }
    fn card() -> QrCard {
        QrCard::waiting("WhatsApp", Rect { x: 0.0, y: 0.0, w: 1.0, h: 1.0 }, 1000)
    }

    #[test]
    fn recognises_qr_page_and_region() {
        let a = WhatsAppLike;
        assert!(a.is_qr_page(&qr_page()));
        assert_eq!(a.qr_region(&qr_page()).unwrap(), Rect { x: 100.0, y: 200.0, w: 264.0, h: 264.0 });
        assert!(!a.is_qr_page(&json!({"text":"hello","elements":[]})));
    }

    #[test]
    fn missing_region_is_reported() {
        let a = WhatsAppLike;
        let page = json!({"text":"scan the qr code","elements":[]});
        assert!(a.is_qr_page(&page));
        assert!(a.qr_region(&page).is_err());
        let zero = json!({"elements":[{"tag":"canvas","aria":"qr","rect":{"x":0,"y":0,"w":0,"h":0}}]});
        assert!(a.qr_region(&zero).is_err());
    }

    #[test]
    fn refresh_timing() {
        let c = card();
        assert!(!needs_refresh(&c, 1019));
        assert!(needs_refresh(&c, 1020));
        let mut e = c.clone();
        e.state = QrState::Expired;
        assert!(needs_refresh(&e, 1001));
        e.state = QrState::Scanned;
        assert!(!needs_refresh(&e, 99999));
        e.state = QrState::NeedsTakeover;
        assert!(!needs_refresh(&e, 99999));
    }

    #[test]
    fn advance_refreshes_rect_and_time() {
        let next = advance(&WhatsAppLike, &qr_page(), &card(), 1030);
        assert_eq!(next.state, QrState::Waiting);
        assert_eq!(next.refreshed_at, 1030);
        assert_eq!(next.image_rect.w, 264.0);
    }

    #[test]
    fn advance_detects_signed_in() {
        let page = json!({"text":"Chats","elements":[]});
        assert_eq!(advance(&WhatsAppLike, &page, &card(), 1001).state, QrState::Scanned);
    }

    #[test]
    fn advance_detects_expired_qr() {
        let page = json!({"text":"Code expired. Click to reload","elements":[]});
        let next = advance(&WhatsAppLike, &page, &card(), 1001);
        assert_eq!(next.state, QrState::Expired);
        assert!(needs_refresh(&next, 1001));
    }

    #[test]
    fn advance_without_expected_elements_asks_for_takeover() {
        let weird = json!({"text":"Welcome back","elements":[]});
        let c = advance(&WhatsAppLike, &weird, &card(), 1001);
        assert_eq!(c.state, QrState::NeedsTakeover);
        assert!(c.reason.unwrap().contains("different"));
        let no_canvas = json!({"text":"scan the qr code","elements":[]});
        let c = advance(&WhatsAppLike, &no_canvas, &card(), 1001);
        assert_eq!(c.state, QrState::NeedsTakeover);
        assert!(c.reason.unwrap().contains("QR code"));
    }

    #[test]
    fn phone_number_never_prints() {
        let n = PhoneNumber::parse("+1 (555) 123-4567").unwrap();
        assert_eq!(n.digits(), "15551234567");
        assert!(!format!("{n:?}").contains("5551234567"));
        assert!(!format!("{n}").contains("5551234567"));
        let steps = WhatsAppLike.phone_pairing_steps(&n);
        assert!(!format!("{steps:?}").contains("5551234567"));
    }

    #[test]
    fn phone_number_validation() {
        assert!(PhoneNumber::parse("123").is_none());
        assert!(PhoneNumber::parse("not a number").is_none());
        assert!(PhoneNumber::parse("1234567890123456").is_none());
    }

    #[test]
    fn pairing_plan_checks_first_control() {
        let n = PhoneNumber::parse("5551234567").unwrap();
        let steps = plan_phone_pairing(&WhatsAppLike, &qr_page(), &n).unwrap();
        assert_eq!(steps.len(), 3);
        assert!(matches!(&steps[1], Step::TypeNumber { selector, .. } if selector == "input[type=tel]"));
        let err = plan_phone_pairing(&WhatsAppLike, &json!({"text":"nothing","elements":[]}), &n).unwrap_err();
        assert!(err.0.contains("Link with phone number"));
    }

    #[test]
    fn reads_pairing_code() {
        let page = json!({"text":"Enter this code on your phone: AB12-CD34","elements":[]});
        assert_eq!(pairing_code(&WhatsAppLike, &page).unwrap(), "AB12-CD34");
        assert_eq!(pairing_code(&WhatsAppLike, &json!({"text":"waiting","elements":[]})).unwrap_err(), Missing("the pairing code".into()));
    }

    #[test]
    fn card_serialises() {
        let j = serde_json::to_string(&card()).unwrap();
        let back: QrCard = serde_json::from_str(&j).unwrap();
        assert_eq!(back, card());
    }
}
