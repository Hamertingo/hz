/// A message's Markdown as the plain HTML body `kit_pdf` prints: headings, paragraphs, lists, quotes,
/// fenced code, bold, italics, inline code and links. Everything is escaped first, so the only markup
/// in the result is what this file writes; the backend's sanitiser runs over it again anyway.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

export function markdownToHtml(md: string): string {
  const out: string[] = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    para = [];
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = /^```/.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      for (i += 1; i < lines.length && !/^```/.test(lines[i]); i += 1) code.push(lines[i]);
      out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);
    if (h) {
      flush();
      out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`);
    } else if (ul || ol) {
      const tag = ul ? "ul" : "ol";
      if (para.length || (list && list.tag !== tag)) flush();
      list ??= { tag, items: [] };
      list.items.push((ul ?? ol)![1]);
    } else if (quote) {
      flush();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
    } else if (!line.trim()) {
      flush();
    } else if (/^---+$/.test(line.trim())) {
      flush();
      out.push("<hr>");
    } else {
      if (list) flush();
      para.push(line);
    }
  }
  flush();
  return out.join("\n");
}

/// A title for the PDF: the message's first heading, else its first words.
export function pdfTitle(md: string): string {
  const head = /^#{1,4}\s+(.+)$/m.exec(md)?.[1];
  const first = head ?? md.trim().split("\n")[0] ?? "";
  const plain = first.replace(/[*`_#>[\]]/g, "").trim();
  return plain.length > 60 ? `${plain.slice(0, 57)}…` : plain || "Message";
}
