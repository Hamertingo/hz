import { describe, expect, it } from "vitest";

import { markdownToHtml, pdfTitle } from "./pdfHtml";

describe("markdownToHtml", () => {
  it("draws headings, lists, code and inline marks", () => {
    const html = markdownToHtml("# Plan\n\nShip **today**, see `x`.\n\n- one\n- two\n\n1. a\n2. b\n\n```\nlet a = 1 < 2;\n```\n> said");
    expect(html).toContain("<h2>Plan</h2>");
    expect(html).toContain("<p>Ship <strong>today</strong>, see <code>x</code>.</p>");
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).toContain("<ol><li>a</li><li>b</li></ol>");
    expect(html).toContain("<pre><code>let a = 1 &lt; 2;</code></pre>");
    expect(html).toContain("<blockquote>said</blockquote>");
  });

  it("escapes markup the message carried and keeps only web links", () => {
    const html = markdownToHtml('<script>x()</script> [ok](https://a.com) [bad](javascript:alert(1))');
    expect(html).not.toContain("<script");
    expect(html).toContain('<a href="https://a.com">ok</a>');
    expect(html).not.toContain('href="javascript');
  });

  it("names the file from the first heading or line", () => {
    expect(pdfTitle("intro\n# Weekly report")).toBe("Weekly report");
    expect(pdfTitle("**Hello** there")).toBe("Hello there");
    expect(pdfTitle("")).toBe("Message");
  });
});
