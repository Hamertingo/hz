//! HTML body to a good-looking PDF through a Chromium-family browser already on the machine.
//!
//! One design, one self-contained stylesheet, no external fetches. When there is no browser or it
//! fails, the same page is kept as an HTML file so the work is never lost.

use anyhow::{bail, Context, Result};
use regex::Regex;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

const CSS: &str = r#"
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #1d1d1f; background: #fff; font: 11pt/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Roboto, Arial, sans-serif; }
.cover { display: flex; justify-content: space-between; font-size: 8.5pt; letter-spacing: .06em; text-transform: uppercase; color: #6e6e73; border-bottom: 1px solid #e5e5ea; padding-bottom: 6pt; margin-bottom: 18pt; }
h1.title { font-size: 25pt; line-height: 1.15; margin: 0 0 14pt; letter-spacing: -.01em; }
h1, h2, h3, h4 { line-height: 1.25; break-after: avoid; }
h1 { font-size: 20pt; margin: 22pt 0 8pt; }
h2 { font-size: 15pt; margin: 18pt 0 6pt; padding-bottom: 3pt; border-bottom: 1px solid #ececf0; }
h3 { font-size: 12.5pt; margin: 14pt 0 4pt; }
h4 { font-size: 11pt; margin: 10pt 0 3pt; color: #444; }
p { margin: 0 0 8pt; orphans: 3; widows: 3; }
a { color: #0a58ca; text-decoration: none; }
ul, ol { margin: 0 0 8pt; padding-left: 18pt; }
li { margin: 2pt 0; }
blockquote { margin: 8pt 0; padding: 4pt 12pt; border-left: 3px solid #f5c400; color: #444; background: #fffbea; }
hr { border: 0; border-top: 1px solid #e5e5ea; margin: 14pt 0; }
img { max-width: 100%; height: auto; }
table { width: 100%; border-collapse: collapse; margin: 8pt 0 12pt; font-size: 10pt; }
th, td { text-align: left; padding: 5pt 8pt; border-bottom: 1px solid #e5e5ea; vertical-align: top; }
th { background: #f5f5f7; font-weight: 600; }
tr { break-inside: avoid; }
code { font: 9.5pt ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #f2f2f5; padding: 1pt 4pt; border-radius: 3pt; }
pre { font: 9pt/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #f5f5f7; border: 1px solid #e5e5ea; border-radius: 6pt; padding: 8pt 10pt; white-space: pre-wrap; word-break: break-word; break-inside: avoid; }
pre code { background: none; padding: 0; }
.card { border: 1px solid #e5e5ea; border-radius: 8pt; padding: 10pt 12pt; margin: 8pt 0; background: #fafafc; break-inside: avoid; }
.tag { display: inline-block; font-size: 8.5pt; font-weight: 600; padding: 1pt 7pt; border-radius: 999px; background: #fff3bf; color: #6b5200; margin-right: 4pt; }
"#;

/// Escapes text for an HTML text node or attribute.
pub fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn re(cell: &'static OnceLock<Regex>, pat: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pat).expect("static pattern"))
}

fn is_data_image(v: &str) -> bool {
    v.starts_with("data:image/") && !v.starts_with("data:image/svg")
}

fn allowed_attr(name: &str, value: &str) -> bool {
    let n = name.to_ascii_lowercase();
    if n.starts_with("on") {
        return false;
    }
    let v: String = value.chars().filter(|c| !c.is_control() && !c.is_whitespace()).collect::<String>().to_ascii_lowercase();
    match n.as_str() {
        "style" => !(v.contains("url(") || v.contains("expression") || v.contains("@import") || v.contains("javascript:")),
        "src" | "srcset" | "poster" | "data" | "background" | "action" | "formaction" | "xlink:href" | "ping" => {
            is_data_image(&v)
        }
        "href" => v.starts_with("http://") || v.starts_with("https://") || v.starts_with("mailto:") || v.starts_with('#'),
        _ => true,
    }
}

/// Strips scripts, event handlers, frames and every external resource from a body; only `data:image` sources survive.
pub fn sanitize_body(body: &str) -> String {
    static BLOCKS: OnceLock<Regex> = OnceLock::new();
    static COMMENTS: OnceLock<Regex> = OnceLock::new();
    static LOOSE: OnceLock<Regex> = OnceLock::new();
    static TAG: OnceLock<Regex> = OnceLock::new();
    static ATTR: OnceLock<Regex> = OnceLock::new();
    let mut s = body.to_string();
    for _ in 0..4 {
        let before = s.clone();
        s = re(&COMMENTS, r"(?s)<!--.*?-->").replace_all(&s, "").into_owned();
        s = re(&BLOCKS, r"(?is)<(script|style|iframe|object|embed|noscript|template|svg|math|form)\b[^>]*>.*?</(script|style|iframe|object|embed|noscript|template|svg|math|form)\s*>")
            .replace_all(&s, "")
            .into_owned();
        if s == before {
            break;
        }
    }
    s = re(&LOOSE, r"(?i)</?(script|style|iframe|object|embed|link|meta|base|form|frame|frameset|applet|input|button)\b[^>]*>")
        .replace_all(&s, "")
        .into_owned();
    let attr = re(&ATTR, r#"([^\s"'<>/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?"#);
    re(&TAG, r"(?s)<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)\s*(/?)>")
        .replace_all(&s, |c: &regex::Captures| {
            let mut out = format!("<{}", &c[1]);
            for a in attr.captures_iter(&c[2]) {
                let value = a.get(2).map(|m| m.as_str().trim_matches(|ch| ch == '"' || ch == '\'')).unwrap_or("");
                if allowed_attr(&a[1], value) {
                    match a.get(2) {
                        Some(_) => out.push_str(&format!(" {}=\"{}\"", &a[1], value.replace('"', "&quot;"))),
                        None => out.push_str(&format!(" {}", &a[1])),
                    }
                }
            }
            out.push_str(&c[3]);
            out.push('>');
            out
        })
        .into_owned()
}

/// A complete, self-contained page: cover line with agent and date, the title, then the sanitised body.
pub fn wrap_html(title: &str, agent_name: &str, date: &str, body_html: &str) -> String {
    format!(
        "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">\
<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'\">\
<title>{t}</title><style>{CSS}</style></head><body>\
<div class=\"cover\"><span>{a}</span><span>{d}</span></div>\
<h1 class=\"title\">{t}</h1>\n{b}\n</body></html>\n",
        t = esc(title),
        a = esc(agent_name),
        d = esc(date),
        b = sanitize_body(body_html),
    )
}

/// Every place a supported browser usually lives, in preference order: Chrome, Edge, Brave, Chromium.
pub fn candidates() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = Vec::new();
    let mac = [
        "Google Chrome.app/Contents/MacOS/Google Chrome",
        "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "Brave Browser.app/Contents/MacOS/Brave Browser",
        "Chromium.app/Contents/MacOS/Chromium",
    ];
    let home = std::env::var_os("HOME").map(PathBuf::from);
    for m in mac {
        v.push(Path::new("/Applications").join(m));
        if let Some(h) = &home {
            v.push(h.join("Applications").join(m));
        }
    }
    let linux = [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/microsoft-edge",
        "/usr/bin/microsoft-edge-stable",
        "/usr/bin/brave-browser",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/snap/bin/chromium",
        "/opt/google/chrome/chrome",
    ];
    v.extend(linux.iter().map(PathBuf::from));
    let win = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
        r"C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe",
    ];
    v.extend(win.iter().map(PathBuf::from));
    v
}

/// First installed browser, judged by `exists` so tests need no real install.
pub fn find_browser(exists: &dyn Fn(&Path) -> bool) -> Option<PathBuf> {
    candidates().into_iter().find(|p| exists(p))
}

/// True when the process is root on Unix, where Chromium refuses to start without `--no-sandbox`.
pub fn needs_no_sandbox() -> bool {
    #[cfg(unix)]
    {
        // SAFETY: geteuid takes no arguments and cannot fail.
        unsafe { libc::geteuid() == 0 }
    }
    #[cfg(not(unix))]
    {
        false
    }
}

fn file_url(p: &Path) -> String {
    let abs = if p.is_absolute() { p.to_path_buf() } else { std::env::current_dir().unwrap_or_default().join(p) };
    url::Url::from_file_path(&abs).map(String::from).unwrap_or_else(|_| format!("file://{}", abs.display()))
}

/// Throwaway profile beside the output, so a running browser of the reader's never swallows the job.
pub fn profile_dir(out_pdf: &Path) -> PathBuf {
    out_pdf.with_extension("profile")
}

/// Arguments for a headless print, with the sandbox left on.
pub fn print_args(html_path: &Path, out_pdf: &Path) -> Vec<String> {
    print_args_for(html_path, out_pdf, false)
}

/// Same, adding `--no-sandbox` only when the caller says the environment needs it (root).
pub fn print_args_for(html_path: &Path, out_pdf: &Path, no_sandbox: bool) -> Vec<String> {
    let mut a = vec![
        "--headless=new".to_string(),
        "--disable-gpu".to_string(),
        "--no-pdf-header-footer".to_string(),
        format!("--user-data-dir={}", profile_dir(out_pdf).display()),
        format!("--print-to-pdf={}", out_pdf.display()),
    ];
    if no_sandbox {
        a.push("--no-sandbox".to_string());
    }
    a.push(file_url(html_path));
    a
}

/// Where the work ended up.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Output {
    Pdf(PathBuf),
    HtmlFallback(PathBuf),
}

/// The process seam: which browser exists and how to run it.
pub trait Runner {
    fn browser(&self) -> Option<PathBuf>;
    fn run(&self, program: &Path, args: &[String]) -> impl Future<Output = Result<()>> + Send;
}

/// Runs the real browser with a 60 second limit.
pub struct SystemRunner;

impl Runner for SystemRunner {
    fn browser(&self) -> Option<PathBuf> {
        find_browser(&|p| p.exists())
    }

    async fn run(&self, program: &Path, args: &[String]) -> Result<()> {
        let mut cmd = tokio::process::Command::new(program);
        cmd.args(args).kill_on_drop(true).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
        let status = tokio::time::timeout(Duration::from_secs(60), cmd.status())
            .await
            .context("the browser took more than 60 seconds")??;
        if !status.success() {
            bail!("the browser exited with {status}");
        }
        Ok(())
    }
}

/// Writes `html` beside `out`, prints it to PDF, and falls back to the HTML file when it cannot.
pub async fn render<R: Runner>(html: &str, out: &Path, runner: &R) -> Result<Output> {
    if let Some(dir) = out.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let html_path = out.with_extension("html");
    std::fs::write(&html_path, html)?;
    let Some(browser) = runner.browser() else {
        return Ok(Output::HtmlFallback(html_path));
    };
    let _ = std::fs::remove_file(out);
    let res = runner.run(&browser, &print_args_for(&html_path, out, needs_no_sandbox())).await;
    let _ = std::fs::remove_dir_all(profile_dir(out));
    let made = std::fs::metadata(out).map(|m| m.len() > 0).unwrap_or(false);
    if res.is_ok() && made {
        let _ = std::fs::remove_file(&html_path);
        Ok(Output::Pdf(out.to_path_buf()))
    } else {
        Ok(Output::HtmlFallback(html_path))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn page_has_cover_title_and_css() {
        let h = wrap_html("Weekly <report>", "Scout", "2026-03-01", "<h2>Hi</h2><p>x</p>");
        assert!(h.starts_with("<!doctype html>"));
        assert!(h.contains("<title>Weekly &lt;report&gt;</title>"));
        assert!(h.contains("<span>Scout</span><span>2026-03-01</span>"));
        assert!(h.contains("<h2>Hi</h2>"));
        assert!(h.contains("-apple-system") && h.contains("@page"));
        assert!(h.contains("default-src 'none'"));
    }

    #[test]
    fn design_covers_every_element() {
        for sel in ["th", "code", "pre", ".card", ".tag", "blockquote", "ul, ol", "h3"] {
            assert!(CSS.contains(sel), "{sel}");
        }
    }

    #[test]
    fn scripts_and_handlers_go() {
        let s = sanitize_body(r#"<p onclick="x()" class="a">ok</p><script>alert(1)</script><img src=x onerror=alert(1)>"#);
        assert_eq!(s, r#"<p class="a">ok</p><img>"#);
        let s = sanitize_body("<SCRIPT SRC=//evil.js></SCRIPT><b>b</b>");
        assert_eq!(s, "<b>b</b>");
        assert!(!sanitize_body("<scr<script>ipt>alert(1)</scr</script>ipt>").to_lowercase().contains("<script"));
    }

    #[test]
    fn external_resources_dropped_data_images_kept() {
        let s = sanitize_body(r#"<img src="https://t.example/p.png"><img src="data:image/png;base64,AAA"><img src="data:text/html;base64,AAA">"#);
        assert_eq!(s, r#"<img><img src="data:image/png;base64,AAA"><img>"#);
        assert_eq!(sanitize_body(r#"<link rel="stylesheet" href="https://x/a.css"><b>x</b>"#), "<b>x</b>");
        assert_eq!(sanitize_body(r#"<div style="background:url(http://x/a.png)">a</div>"#), "<div>a</div>");
        assert_eq!(sanitize_body(r#"<div style="color:red">a</div>"#), r#"<div style="color:red">a</div>"#);
        assert_eq!(sanitize_body(r#"<img src="data:image/svg+xml;base64,AAA">"#), "<img>");
    }

    #[test]
    fn links_keep_safe_schemes_only() {
        assert_eq!(sanitize_body(r#"<a href="https://a.com">x</a>"#), r#"<a href="https://a.com">x</a>"#);
        assert_eq!(sanitize_body(r##"<a href="#top">x</a>"##), r##"<a href="#top">x</a>"##);
        assert_eq!(sanitize_body(r#"<a href="javascript:alert(1)">x</a>"#), "<a>x</a>");
        assert_eq!(sanitize_body(r#"<a href=" jav&#x09;ascript:alert(1)">x</a>"#), "<a>x</a>");
        assert_eq!(sanitize_body("<a href=\"java\tscript:alert(1)\">x</a>"), "<a>x</a>");
        assert_eq!(sanitize_body(r#"<a href="file:///etc/passwd">x</a>"#), "<a>x</a>");
    }

    #[test]
    fn iframes_forms_comments_and_svg_removed() {
        let s = sanitize_body(r#"a<iframe src="x"></iframe><form action="/x"><input name=q><button>go</button></form><!-- c --><svg onload=1><circle/></svg>b"#);
        assert_eq!(s, "ab");
    }

    #[test]
    fn plain_markup_survives() {
        let b = r#"<h2>T</h2><ul><li>a</li></ul><table><tr><th>h</th><td colspan="2">c</td></tr></table><pre><code>x &lt; y</code></pre><span class="tag">t</span>"#;
        assert_eq!(sanitize_body(b), b);
    }

    #[test]
    fn browser_search_order_and_none() {
        let edge = Path::new("/Applications").join("Microsoft Edge.app/Contents/MacOS/Microsoft Edge");
        let brave = Path::new("/Applications").join("Brave Browser.app/Contents/MacOS/Brave Browser");
        let e = edge.clone();
        let b = brave.clone();
        assert_eq!(find_browser(&move |p| p == e || p == b), Some(edge));
        let chrome = PathBuf::from("/usr/bin/google-chrome");
        let c = chrome.clone();
        assert_eq!(find_browser(&move |p| p == c), Some(chrome));
        assert_eq!(find_browser(&|_| false), None);
        assert!(candidates().iter().any(|p| p.to_string_lossy().contains("msedge.exe")));
        assert!(candidates().iter().any(|p| p.ends_with("chromium-browser")));
    }

    #[test]
    fn args_are_headless_without_header_or_sandbox_flag() {
        let a = print_args(Path::new("/tmp/r.html"), Path::new("/tmp/r.pdf"));
        assert!(a.contains(&"--headless=new".to_string()));
        assert!(a.contains(&"--no-pdf-header-footer".to_string()));
        assert!(a.contains(&"--print-to-pdf=/tmp/r.pdf".to_string()));
        assert!(a.contains(&"--user-data-dir=/tmp/r.profile".to_string()));
        assert!(!a.iter().any(|x| x.contains("no-sandbox")));
        assert_eq!(a.last().unwrap(), "file:///tmp/r.html");
        assert!(print_args_for(Path::new("/tmp/a b.html"), Path::new("/tmp/o.pdf"), true).iter().any(|x| x == "--no-sandbox"));
        assert!(print_args(Path::new("/tmp/a b.html"), Path::new("/tmp/o.pdf")).last().unwrap().contains("a%20b.html"));
    }

    struct Fake {
        browser: Option<PathBuf>,
        succeed: bool,
        write_pdf: bool,
        seen: Mutex<Vec<Vec<String>>>,
    }
    impl Runner for Fake {
        fn browser(&self) -> Option<PathBuf> {
            self.browser.clone()
        }
        async fn run(&self, _p: &Path, args: &[String]) -> Result<()> {
            self.seen.lock().unwrap().push(args.to_vec());
            if self.write_pdf {
                let out = args.iter().find_map(|a| a.strip_prefix("--print-to-pdf=")).unwrap();
                std::fs::write(out, b"%PDF-1.4").unwrap();
            }
            if self.succeed {
                Ok(())
            } else {
                bail!("crashed")
            }
        }
    }
    fn fake(browser: bool, succeed: bool, write_pdf: bool) -> Fake {
        Fake { browser: browser.then(|| PathBuf::from("/fake/chrome")), succeed, write_pdf, seen: Mutex::new(vec![]) }
    }
    fn out() -> PathBuf {
        let d = std::env::temp_dir().join(format!("hz-pdf-{}", uuid::Uuid::new_v4().simple()));
        d.join("sub").join("report.pdf")
    }

    #[tokio::test]
    async fn render_makes_pdf() {
        let o = out();
        let r = fake(true, true, true);
        assert_eq!(render("<p>x</p>", &o, &r).await.unwrap(), Output::Pdf(o.clone()));
        assert!(!o.with_extension("html").exists());
        assert_eq!(r.seen.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn render_without_browser_keeps_html() {
        let o = out();
        let r = fake(false, true, false);
        let res = render("<p>x</p>", &o, &r).await.unwrap();
        assert_eq!(res, Output::HtmlFallback(o.with_extension("html")));
        assert_eq!(std::fs::read_to_string(o.with_extension("html")).unwrap(), "<p>x</p>");
        assert!(r.seen.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn render_falls_back_on_failure_or_missing_output() {
        let o = out();
        assert!(matches!(render("h", &o, &fake(true, false, false)).await.unwrap(), Output::HtmlFallback(_)));
        let o2 = out();
        assert!(matches!(render("h", &o2, &fake(true, true, false)).await.unwrap(), Output::HtmlFallback(_)));
        let o3 = out();
        assert!(matches!(render("h", &o3, &fake(true, false, true)).await.unwrap(), Output::HtmlFallback(_)));
    }

    #[tokio::test]
    async fn stale_pdf_is_not_mistaken_for_success() {
        let o = out();
        std::fs::create_dir_all(o.parent().unwrap()).unwrap();
        std::fs::write(&o, b"old").unwrap();
        assert!(matches!(render("h", &o, &fake(true, true, false)).await.unwrap(), Output::HtmlFallback(_)));
    }
}
