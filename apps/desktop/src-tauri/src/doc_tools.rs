//! The `docs` MCP tools: documents an agent makes for the person. Today one, `make_pdf`, which
//! prints an HTML body to a PDF through a Chromium-family browser on the Mac (`agentkit::pdf`) and
//! keeps the HTML instead when there is none. Served at `/mcp/<agent>/docs` (see `kit_mcp`).

use anyhow::{bail, Result};
use serde_json::{json, Value};

pub fn tools() -> Value {
    json!([{
        "name": "make_pdf",
        "description": "Make a good-looking PDF from an HTML body (headings, paragraphs, lists, tables, code, \
                        blockquotes; images only as data: URLs; no scripts or outside files). Returns the file's path \
                        on this Mac, which you can attach to a draft. Without a Chrome, Edge, Brave or Chromium on the \
                        Mac it saves the page as HTML and says so.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "The document's title, printed at the top."},
                "html": {"type": "string", "description": "The body only, without <html> or <head>."},
            },
            "required": ["title", "html"],
            "additionalProperties": false,
        },
    }])
}

/// What the agent is told about the file it got.
pub fn outcome(path: &str) -> String {
    if path.ends_with(".pdf") {
        format!("PDF saved: {path}")
    } else {
        format!("No Chromium-family browser is installed, so the page was saved as HTML instead: {path}")
    }
}

pub async fn call(agent_id: &str, name: &str, args: &Value) -> Result<String> {
    if name != "make_pdf" {
        bail!("no tool {name}");
    }
    let s = |k: &str| args.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
    let (title, html) = (s("title"), s("html"));
    if html.trim().is_empty() {
        bail!("`html` is empty");
    }
    let path = crate::kit_cmds::kit_pdf(title, agent_id.to_string(), html).await.map_err(anyhow::Error::msg)?;
    Ok(outcome(&path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tool_takes_a_title_and_a_body() {
        let t = tools();
        assert_eq!(t[0]["name"], "make_pdf");
        assert_eq!(t[0]["inputSchema"]["required"], json!(["title", "html"]));
    }

    #[test]
    fn the_outcome_says_when_it_fell_back_to_html() {
        assert_eq!(outcome("/x/a.pdf"), "PDF saved: /x/a.pdf");
        assert!(outcome("/x/a.html").contains("saved as HTML"));
    }

    #[tokio::test]
    async fn an_empty_body_or_an_unknown_tool_is_refused() {
        assert!(call("a", "make_pdf", &json!({"title": "t", "html": " "})).await.is_err());
        assert!(call("a", "nope", &json!({})).await.is_err());
    }
}
