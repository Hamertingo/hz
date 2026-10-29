//! Live pages: HTML split into top-level blocks with stable ids, numbered versions, conflict on stale writes.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;

const BLOCK_TAGS: [&str; 16] = [
    "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table", "pre", "blockquote", "div", "section", "dl", "figure",
];
/// A rewritten block keeps its id when its words overlap the old one at least this much.
const KEEP_SIMILARITY: f64 = 0.5;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Block {
    pub id: String,
    pub tag: String,
    /// The block's own markup, without the `data-b` attribute.
    pub html: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Version {
    pub n: u32,
    /// The page as served: every top-level block carries `data-b="<id>"`.
    pub html: String,
    pub at: i64,
    pub blocks: Vec<Block>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Page {
    pub id: String,
    pub title: String,
    pub versions: Vec<Version>,
    #[serde(default)]
    pub next_block: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Update {
    pub version: u32,
    pub changed_block_ids: Vec<String>,
}

/// The write was based on an older version than the page now has.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Conflict {
    pub current_version: u32,
}

/// Drops `<script>` elements, `on*` attributes and `javascript:` URLs.
pub fn sanitize(html: &str) -> String {
    let script = Regex::new(r"(?is)<script\b.*?(</script\s*>|$)").unwrap();
    let on_attr = Regex::new(r#"(?is)(<[^>]*?)\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)"#).unwrap();
    let js_url = Regex::new(r#"(?i)(href|src)\s*=\s*(["']?)\s*javascript:[^"'\s>]*"#).unwrap();
    let mut s = script.replace_all(html, "").into_owned();
    // An attribute list can hold several handlers; each pass removes one per tag.
    loop {
        let next = on_attr.replace_all(&s, "$1").into_owned();
        if next == s {
            break;
        }
        s = next;
    }
    js_url.replace_all(&s, "$1=$2#").into_owned()
}

fn strip_data_b(html: &str) -> String {
    Regex::new(r#"(?i)\s+data-b\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)"#).unwrap().replace_all(html, "").into_owned()
}

fn text_of(html: &str) -> String {
    let t = Regex::new(r"(?s)<[^>]*>").unwrap().replace_all(html, " ");
    t.split_whitespace().collect::<Vec<_>>().join(" ")
}

struct Tag {
    start: usize,
    end: usize,
    name: String,
    close: bool,
    selfclose: bool,
}

fn next_tag(s: &str, from: usize) -> Option<Tag> {
    let b = s.as_bytes();
    let mut i = from;
    while i < b.len() {
        if b[i] == b'<' {
            if s[i..].starts_with("<!--") {
                i = s[i..].find("-->").map(|e| i + e + 3)?;
                continue;
            }
            let close = b.get(i + 1) == Some(&b'/');
            let ns = i + 1 + close as usize;
            let mut ne = ns;
            while ne < b.len() && (b[ne].is_ascii_alphanumeric()) {
                ne += 1;
            }
            if ne > ns {
                let end = s[ne..].find('>').map(|e| ne + e + 1)?;
                return Some(Tag {
                    start: i,
                    end,
                    name: s[ns..ne].to_ascii_lowercase(),
                    close,
                    selfclose: s[..end].ends_with("/>"),
                });
            }
        }
        i += 1;
    }
    None
}

/// Splits sanitised HTML into top-level blocks (ids left empty); loose text becomes a paragraph.
fn split_blocks(html: &str) -> Vec<Block> {
    let mut out = Vec::new();
    let mut pos = 0;
    let mut loose_start: Option<usize> = None;
    let flush_loose = |out: &mut Vec<Block>, from: usize, to: usize| {
        let chunk = &html[from..to];
        let text = text_of(chunk);
        if !text.is_empty() {
            out.push(Block { id: String::new(), tag: "p".into(), html: format!("<p>{}</p>", chunk.trim()), text });
        }
    };
    while pos < html.len() {
        let Some(t) = next_tag(html, pos) else { break };
        if !t.close && BLOCK_TAGS.contains(&t.name.as_str()) {
            flush_loose(&mut out, loose_start.take().unwrap_or(pos), t.start);
            let mut depth = 1;
            let mut cur = t.end;
            let mut end = html.len();
            if !t.selfclose {
                while let Some(n) = next_tag(html, cur) {
                    cur = n.end;
                    if n.name == t.name && !n.selfclose {
                        depth += if n.close { -1 } else { 1 };
                        if depth == 0 {
                            end = n.end;
                            break;
                        }
                    }
                }
                if depth != 0 {
                    end = html.len();
                }
            } else {
                end = t.end;
            }
            let raw = &html[t.start..end];
            out.push(Block { id: String::new(), tag: t.name.clone(), html: raw.to_string(), text: text_of(raw) });
            pos = end;
        } else {
            loose_start.get_or_insert(pos);
            pos = t.end;
        }
    }
    let tail_from = loose_start.unwrap_or(pos);
    if tail_from < html.len() {
        flush_loose(&mut out, tail_from, html.len());
    }
    out
}

fn words(s: &str) -> HashSet<String> {
    s.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(String::from).collect()
}

fn similarity(a: &str, b: &str) -> f64 {
    let (wa, wb) = (words(a), words(b));
    if wa.is_empty() && wb.is_empty() {
        return if a == b { 1.0 } else { 0.0 };
    }
    let inter = wa.intersection(&wb).count() as f64;
    inter / (wa.len() + wb.len()) as f64 * 2.0
}

fn with_id(block: &Block) -> String {
    let h = &block.html;
    match h.find(|c: char| c.is_whitespace() || c == '>' || c == '/') {
        Some(i) if h.starts_with('<') => format!("{} data-b=\"{}\"{}", &h[..i], block.id, &h[i..]),
        _ => h.clone(),
    }
}

fn assemble(blocks: &[Block]) -> String {
    blocks.iter().map(with_id).collect::<Vec<_>>().join("\n")
}

/// Carries ids from `prev` to `next` by content (exact first, then best word overlap) and mints the rest.
fn assign_ids(prev: &[Block], next: &mut [Block], counter: &mut u64) {
    let mut used: HashSet<usize> = HashSet::new();
    let mut done: Vec<bool> = vec![false; next.len()];
    for (i, nb) in next.iter_mut().enumerate() {
        let hit = prev.iter().enumerate().position(|(j, pb)| !used.contains(&j) && pb.tag == nb.tag && pb.text == nb.text);
        if let Some(j) = hit {
            used.insert(j);
            nb.id = prev[j].id.clone();
            done[i] = true;
        }
    }
    let mut pairs: Vec<(f64, usize, usize)> = Vec::new();
    for (i, nb) in next.iter().enumerate().filter(|(i, _)| !done[*i]) {
        for (j, pb) in prev.iter().enumerate().filter(|(j, _)| !used.contains(j)) {
            if pb.tag == nb.tag {
                let s = similarity(&pb.text, &nb.text);
                if s >= KEEP_SIMILARITY {
                    pairs.push((s, i, j));
                }
            }
        }
    }
    // Best pairs first; ties go to the pair closest in position so reordered twins do not swap.
    pairs.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap().then((a.1 as i64 - a.2 as i64).abs().cmp(&(b.1 as i64 - b.2 as i64).abs())));
    for (_, i, j) in pairs {
        if !done[i] && !used.contains(&j) {
            next[i].id = prev[j].id.clone();
            used.insert(j);
            done[i] = true;
        }
    }
    for (i, nb) in next.iter_mut().enumerate() {
        if !done[i] {
            *counter += 1;
            nb.id = format!("b{counter}");
        }
    }
}

/// Ids in `next` that are new or whose markup changed, then ids that vanished from `prev`.
pub fn diff(prev: &[Block], next: &[Block]) -> Vec<String> {
    let old: HashMap<&str, &Block> = prev.iter().map(|b| (b.id.as_str(), b)).collect();
    let mut out: Vec<String> = next
        .iter()
        .filter(|b| old.get(b.id.as_str()).is_none_or(|o| o.html != b.html))
        .map(|b| b.id.clone())
        .collect();
    let now: HashSet<&str> = next.iter().map(|b| b.id.as_str()).collect();
    out.extend(prev.iter().filter(|b| !now.contains(b.id.as_str())).map(|b| b.id.clone()));
    out
}

impl Page {
    /// An empty page with no versions.
    pub fn new(id: &str, title: &str) -> Page {
        Page { id: id.into(), title: title.into(), versions: vec![], next_block: 0 }
    }

    /// The newest version number, 0 for an empty page.
    pub fn current_version(&self) -> u32 {
        self.versions.last().map_or(0, |v| v.n)
    }

    /// Stores `html` as the next version if `base_version` is current; otherwise returns the conflict.
    pub fn update(&mut self, html: &str, base_version: u32, at: i64) -> Result<Update, Conflict> {
        let cur = self.current_version();
        if base_version < cur {
            return Err(Conflict { current_version: cur });
        }
        Ok(self.push(html, at))
    }

    fn push(&mut self, html: &str, at: i64) -> Update {
        let clean = strip_data_b(&sanitize(html));
        let mut blocks = split_blocks(&clean);
        let prev: Vec<Block> = self.versions.last().map(|v| v.blocks.clone()).unwrap_or_default();
        assign_ids(&prev, &mut blocks, &mut self.next_block);
        let changed = if self.versions.is_empty() { blocks.iter().map(|b| b.id.clone()).collect() } else { diff(&prev, &blocks) };
        let n = self.current_version() + 1;
        self.versions.push(Version { n, html: assemble(&blocks), at, blocks });
        Update { version: n, changed_block_ids: changed }
    }

    /// `(version, time)` pairs, newest first.
    pub fn history(&self) -> Vec<(u32, i64)> {
        self.versions.iter().rev().map(|v| (v.n, v.at)).collect()
    }

    /// Writes version `n`'s content as a new version; history is never rewritten.
    pub fn restore(&mut self, n: u32, at: i64) -> Result<Update, String> {
        let html = self.versions.iter().find(|v| v.n == n).map(|v| v.html.clone()).ok_or_else(|| format!("no version {n}"))?;
        Ok(self.push(&html, at))
    }

    /// Blocks changed between two version numbers, as `diff` reports them.
    pub fn changed_between(&self, a: u32, b: u32) -> Option<Vec<String>> {
        let va = self.versions.iter().find(|v| v.n == a)?;
        let vb = self.versions.iter().find(|v| v.n == b)?;
        Some(diff(&va.blocks, &vb.blocks))
    }
}

/// Saves the page atomically (temp file, then rename).
pub fn save(page: &Page, path: &Path) -> anyhow::Result<()> {
    if let Some(d) = path.parent() {
        std::fs::create_dir_all(d)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(page)?)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

/// Loads a page; a missing file is an error so callers choose whether to start fresh.
pub fn load(path: &Path) -> anyhow::Result<Page> {
    Ok(serde_json::from_slice(&std::fs::read(path)?)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "<h1>Weekly report</h1><p>Sales grew by ten percent this week across all regions.</p><ul><li>one</li><li>two</li></ul>";

    fn page() -> Page {
        let mut p = Page::new("p1", "Report");
        p.update(A, 0, 1).unwrap();
        p
    }

    #[test]
    fn splits_blocks_and_stamps_ids() {
        let p = page();
        let v = &p.versions[0];
        assert_eq!(v.blocks.len(), 3);
        assert!(v.html.contains("data-b=\"b1\""));
        assert!(v.html.starts_with("<h1 data-b=\"b1\">"));
        assert_eq!(v.blocks[2].tag, "ul");
    }

    #[test]
    fn first_version_marks_everything_changed() {
        let mut p = Page::new("p", "t");
        let u = p.update(A, 0, 1).unwrap();
        assert_eq!(u.version, 1);
        assert_eq!(u.changed_block_ids.len(), 3);
    }

    #[test]
    fn unchanged_blocks_keep_ids_on_full_rewrite() {
        let mut p = page();
        let ids: Vec<_> = p.versions[0].blocks.iter().map(|b| b.id.clone()).collect();
        let u = p.update(A, 1, 2).unwrap();
        assert!(u.changed_block_ids.is_empty());
        let ids2: Vec<_> = p.versions[1].blocks.iter().map(|b| b.id.clone()).collect();
        assert_eq!(ids, ids2);
    }

    #[test]
    fn lightly_edited_block_keeps_id_and_is_changed() {
        let mut p = page();
        let id = p.versions[0].blocks[1].id.clone();
        let u = p
            .update("<h1>Weekly report</h1><p>Sales grew by twelve percent this week across all regions.</p><ul><li>one</li><li>two</li></ul>", 1, 2)
            .unwrap();
        assert_eq!(u.changed_block_ids, vec![id.clone()]);
        assert_eq!(p.versions[1].blocks[1].id, id);
    }

    #[test]
    fn rewritten_block_gets_new_id() {
        let mut p = page();
        let old = p.versions[0].blocks[1].id.clone();
        let u = p.update("<h1>Weekly report</h1><p>Completely different sentence here.</p><ul><li>one</li><li>two</li></ul>", 1, 2).unwrap();
        let new = &p.versions[1].blocks[1].id;
        assert_ne!(*new, old);
        assert!(u.changed_block_ids.contains(new));
        assert!(u.changed_block_ids.contains(&old));
    }

    #[test]
    fn reordering_keeps_ids() {
        let mut p = page();
        let ids: HashMap<String, String> = p.versions[0].blocks.iter().map(|b| (b.tag.clone(), b.id.clone())).collect();
        p.update("<ul><li>one</li><li>two</li></ul><h1>Weekly report</h1><p>Sales grew by ten percent this week across all regions.</p>", 1, 2).unwrap();
        for b in &p.versions[1].blocks {
            assert_eq!(ids[&b.tag], b.id);
        }
    }

    #[test]
    fn stale_base_conflicts() {
        let mut p = page();
        p.update("<p>x y z</p>", 1, 2).unwrap();
        let e = p.update("<p>mine</p>", 1, 3).unwrap_err();
        assert_eq!(e, Conflict { current_version: 2 });
        assert_eq!(p.current_version(), 2);
        assert!(p.update("<p>mine</p>", 2, 3).is_ok());
    }

    #[test]
    fn sanitizes_scripts_and_handlers() {
        let mut p = Page::new("p", "t");
        p.update("<p onclick=\"x()\" onmouseover='y()' class=a>hi</p><script>alert(1)</script><div><a href=\"javascript:evil()\">l</a></div>", 0, 1).unwrap();
        let h = &p.versions[0].html;
        assert!(!h.contains("script"));
        assert!(!h.to_lowercase().contains("onclick"));
        assert!(!h.to_lowercase().contains("onmouseover"));
        assert!(!h.contains("javascript:"));
        assert!(h.contains("class=a"));
    }

    #[test]
    fn nested_same_tag_stays_one_block() {
        let mut p = Page::new("p", "t");
        p.update("<div>outer <div>inner</div> tail</div><p>next</p>", 0, 1).unwrap();
        assert_eq!(p.versions[0].blocks.len(), 2);
        assert!(p.versions[0].blocks[0].html.ends_with("tail</div>"));
    }

    #[test]
    fn loose_text_becomes_paragraph() {
        let mut p = Page::new("p", "t");
        p.update("hello <b>there</b><h2>Head</h2>tail", 0, 1).unwrap();
        let b = &p.versions[0].blocks;
        assert_eq!(b.len(), 3);
        assert_eq!(b[0].tag, "p");
        assert_eq!(b[2].text, "tail");
    }

    #[test]
    fn incoming_data_b_is_ignored() {
        let mut p = page();
        let u = p.update("<h1 data-b=\"zzz\">Weekly report</h1>", 1, 2).unwrap();
        assert_eq!(p.versions[1].blocks[0].id, "b1");
        assert!(!p.versions[1].html.contains("zzz"));
        assert_eq!(u.changed_block_ids, vec!["b2".to_string(), "b3".to_string()]);
    }

    #[test]
    fn history_and_restore() {
        let mut p = page();
        p.update("<p>Something else entirely</p>", 1, 5).unwrap();
        assert_eq!(p.history(), vec![(2, 5), (1, 1)]);
        let u = p.restore(1, 9).unwrap();
        assert_eq!(u.version, 3);
        assert_eq!(p.versions[2].blocks.len(), 3);
        assert_eq!(p.versions.len(), 3);
        assert!(p.restore(99, 9).is_err());
        assert_eq!(p.changed_between(1, 2).unwrap().len(), 4);
    }

    #[test]
    fn empty_html_gives_empty_version() {
        let mut p = Page::new("p", "t");
        let u = p.update("", 0, 1).unwrap();
        assert!(u.changed_block_ids.is_empty());
        assert!(p.versions[0].blocks.is_empty());
    }

    #[test]
    fn save_load_roundtrip() {
        let dir = std::env::temp_dir().join(format!("hz-pages-{}", uuid::Uuid::new_v4()));
        let f = dir.join("p.json");
        let p = page();
        save(&p, &f).unwrap();
        assert_eq!(load(&f).unwrap(), p);
        assert!(load(&dir.join("none.json")).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
