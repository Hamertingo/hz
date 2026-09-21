import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Code, File as FileGlyph, Search, Terminal } from "lucide-react";

import FileIcon from "@/components/FileIcon";
import Spinner from "@/components/ui/spinner";
import { highlight } from "@/lib/palette";
import { HITS_PER_KIND, SCOPES, searchHits, type SearchHit, type SearchScope } from "@/lib/search";
import { cn } from "@/lib/utils";
import type { ContentMatches, ContentMatch, FileMatch, SessionIndexItem, TranscriptMatch } from "@/types/events";

/// Everything this app can be searched for, as one screen.
///
/// **A view rather than a box over the window**, which is the shape it follows:
/// the palette answers "take me there" in the middle of something else, where this
/// is a place the reader settles into — the scope row, the results and the
/// keyboard are all things a modal has no room for, and a search that replaces the
/// window is the one a reader leaves open while they work.
///
/// **Four searches behind one box**, because a reader does not know which of them
/// answers them: sessions and messages come from the logs the app already keeps,
/// files from the index the `@` picker uses, and lines of code from `git grep` in
/// the session's own checkout. Three of the four are reads, all three are debounced
/// together, and a read that fails is no results rather than an error — the same
/// bargain the palette makes.
export default function SearchView({
  active,
  sessions,
  cwd,
  onClose,
  onOpen,
}: {
  /// Whether this is the view on screen. Reads are gated on it, and focus follows
  /// it: a hidden page that kept polling would search for a reader who left.
  active: boolean;
  /// The session index, already in memory — a search over sessions costs no round
  /// trip, and the sidebar is drawing the same list.
  sessions: readonly SessionIndexItem[];
  /// Where the file and code searches look. The selected session's own checkout,
  /// because that is where a hit opens.
  cwd: string | null;
  onClose: () => void;
  onOpen: (hit: SearchHit) => void;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("all");
  const [messages, setMessages] = useState<TranscriptMatch[]>([]);
  const [files, setFiles] = useState<FileMatch[]>([]);
  const [code, setCode] = useState<ContentMatch[]>([]);
  const [reading, setReading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const gen = useRef(0);

  useEffect(() => {
    if (active) input.current?.focus();
  }, [active]);

  useEffect(() => {
    // Two characters before any read, the same bar the palette takes: one letter
    // matches most of a life's work and costs three walks to say so.
    if (!active || query.trim().length < 2 || !cwd) {
      gen.current += 1;
      setMessages([]);
      setFiles([]);
      setCode([]);
      setReading(false);
      return;
    }

    const mine = ++gen.current;
    setReading(true);
    const timer = setTimeout(() => {
      void Promise.all([
        invoke<TranscriptMatch[]>("search_transcripts", { query, limit: HITS_PER_KIND }),
        invoke<FileMatch[]>("search_files", { cwd, query, limit: HITS_PER_KIND }),
        invoke<ContentMatches>("search_content", { cwd, query }),
      ])
        .then(([found, names, lines]) => {
          if (gen.current !== mine) return;
          setMessages(found);
          setFiles(names);
          setCode(lines.matches.slice(0, HITS_PER_KIND));
        })
        .catch(() => {
          if (gen.current !== mine) return;
          setMessages([]);
          setFiles([]);
          setCode([]);
        })
        .finally(() => {
          if (gen.current === mine) setReading(false);
        });
    }, 180);

    return () => clearTimeout(timer);
  }, [query, active, cwd]);

  const hits = useMemo(
    () => searchHits({ sessions, messages, files, code }, query, scope),
    [sessions, messages, files, code, query, scope],
  );

  // The cursor is a row index, so it has to be re-anchored when the list changes
  // under it — otherwise the top row is selected after the reader narrows to two.
  useEffect(() => setCursor(0), [query, scope]);

  const typed = query.trim().length > 0;

  return (
    <div role="search" aria-label="Search" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <label className="flex h-10 shrink-0 select-none items-center gap-2 border-b border-border px-3 text-muted-foreground">
        <Search className="size-3.5 shrink-0" aria-hidden />
        <input
          ref={input}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
              return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setCursor((at) => Math.min(Math.max(at + step, 0), Math.max(hits.length - 1, 0)));
              return;
            }
            if (event.key === "Enter" && hits[cursor]) {
              event.preventDefault();
              onOpen(hits[cursor]);
            }
          }}
          placeholder="Search everything…"
          aria-label="Search everything"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-ui text-foreground outline-none placeholder:text-muted-foreground/60"
        />
        {reading && <Spinner className="size-3.5 shrink-0 text-muted-foreground/60" />}
      </label>

      {/* The scopes, as the pages' own tab row draws them: a word each, no track,
          and the chosen one takes the fill every selected row in the app takes. */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-3">
        {SCOPES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={scope === item.id}
            onClick={() => setScope(item.id)}
            className={cn(
              "cursor-pointer rounded-md px-2 py-1 text-ui",
              scope === item.id
                ? "bg-surface-selected text-foreground"
                : "text-muted-foreground hover:bg-muted/50",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
        {!typed ? (
          <p className="flex items-center gap-2 px-2 py-3 text-ui text-muted-foreground">
            <Search className="size-3.5 shrink-0" aria-hidden />
            Sessions, messages, files and lines of code — all four at once.
          </p>
        ) : hits.length === 0 ? (
          // Said plainly, and the two reasons are told apart: a read that has not
          // answered yet is not the same sentence as a search that found nothing.
          <p className="px-2 py-3 text-ui text-muted-foreground">
            {reading ? "Searching…" : "No results."}
          </p>
        ) : (
          <div role="listbox" aria-label="Search results">
            {hits.map((hit, index) => {
              const marked = highlight(hit.title, query);
              return (
                <button
                  key={`${hit.kind}:${hit.id}`}
                  type="button"
                  role="option"
                  aria-selected={index === cursor}
                  onMouseMove={() => setCursor(index)}
                  onClick={() => onOpen(hit)}
                  className={cn(
                    "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-ui",
                    index === cursor ? "bg-surface-selected text-foreground" : "text-foreground",
                  )}
                >
                  <span className="grid size-4 shrink-0 place-items-center text-muted-foreground/70">
                    {hit.kind === "session" ? (
                      <Terminal className="size-3.5" aria-hidden />
                    ) : hit.kind === "message" ? (
                      <Code className="size-3.5" aria-hidden />
                    ) : hit.kind === "file" ? (
                      <FileIcon path={hit.path} className="size-4" />
                    ) : (
                      <FileGlyph className="size-3.5" aria-hidden />
                    )}
                  </span>

                  {/* The row is found by its words, so the query is drawn inside
                      them — the same service the box does for the file it found. */}
                  <span className="min-w-0 flex-1 truncate">
                    {marked ? (
                      <>
                        {marked.before}
                        <span className="text-accent-mention">{marked.match}</span>
                        {marked.after}
                      </>
                    ) : (
                      hit.title
                    )}
                  </span>

                  <span className="min-w-0 max-w-[45%] shrink-0 truncate font-mono text-[0.7rem] text-muted-foreground/60">
                    {hit.meta}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
