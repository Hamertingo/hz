import { Check, Play, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { fieldClassName } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { FieldLabel, Hint, Modal } from "@/components/ui/modal";
import Spinner from "@/components/ui/spinner";
import { testServer } from "@/hooks/usePlugins";
import { cn } from "@/lib/utils";
import type { CustomInput, EnvVar, PluginTest } from "@/types/events";

type Runs = "stdio" | "http";

const MONO = cn(fieldClassName, "font-mono text-xs");

/// Add any server that speaks MCP: a command on this Mac or a URL. Test starts it
/// for real and lists the tools it offers, before anything is saved.
export default function AddServerDialog({
  open,
  initialName,
  onClose,
  onAdd,
}: {
  open: boolean;
  initialName: string;
  onClose: () => void;
  /// Saves it; resolves to whether that worked. The page says what happened.
  onAdd: (input: CustomInput, tested: boolean) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [runs, setRuns] = useState<Runs>("stdio");
  const [target, setTarget] = useState("");
  const [env, setEnv] = useState<EnvVar[]>([{ key: "", value: "" }]);
  const [result, setResult] = useState<PluginTest | null>(null);
  const [testing, setTesting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setRuns("stdio");
    setTarget("");
    setEnv([{ key: "", value: "" }]);
    setResult(null);
    setError(null);
  }, [open, initialName]);

  const input = (): CustomInput => ({ name, transport: runs, target, env });
  // Anything changed after a test makes that test about something else.
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setResult(null);
  };

  const test = async () => {
    setTesting(true);
    setError(null);
    try {
      setResult(await testServer(input()));
    } catch (e) {
      setResult({ ok: false, tools: [], error: String(e), ms: 0 });
    } finally {
      setTesting(false);
    }
  };

  const add = async () => {
    if (!name.trim()) {
      setError("Give the server a name");
      return;
    }
    setAdding(true);
    setError(null);
    const done = await onAdd(input(), result?.ok === true);
    setAdding(false);
    if (!done) setError("It could not be added. See the message at the bottom of the page.");
  };

  const setVar = (i: number, patch: Partial<EnvVar>) =>
    edit(setEnv)(env.map((e, j) => (j === i ? { ...e, ...patch } : e)));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add MCP server"
      footer={
        <>
          <Button variant="outline" className="mr-auto" disabled={testing || !target.trim()} onClick={() => void test()}>
            <Play className="size-2.5" /> Test connection
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="solid" disabled={adding || testing || !name.trim()} onClick={() => void add()}>
            {adding && <Spinner className="size-3.5" />}
            Add server
          </Button>
        </>
      }
    >
      <FieldLabel>Name</FieldLabel>
      <input autoFocus className={fieldClassName} placeholder="My server" value={name} onChange={(e) => setName(e.target.value)} />

      <FieldLabel>Runs as</FieldLabel>
      <Segmented<Runs>
        label="Runs as"
        value={runs}
        onChange={edit(setRuns)}
        options={[
          { value: "stdio", label: "Command" },
          { value: "http", label: "URL" },
        ]}
      />

      <FieldLabel>{runs === "http" ? "URL" : "Command or URL"}</FieldLabel>
      <input
        className={MONO}
        placeholder={runs === "http" ? "https://mcp.example.com/mcp" : "npx -y @acme/mcp  or  https://mcp.acme.com"}
        value={target}
        onChange={(e) => edit(setTarget)(e.target.value)}
      />

      <FieldLabel>{runs === "http" ? "Headers · optional" : "Environment variable · optional"}</FieldLabel>
      <div className="flex flex-col gap-1.5">
        {env.map((e, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              className={cn(MONO, "w-2/5")}
              placeholder={runs === "http" ? "Authorization" : "ACME_TOKEN"}
              value={e.key}
              onChange={(ev) => setVar(i, { key: ev.target.value })}
            />
            <input
              className={MONO}
              placeholder={runs === "http" ? "Bearer …" : "…"}
              value={e.value}
              onChange={(ev) => setVar(i, { value: ev.target.value })}
            />
            {env.length > 1 && (
              <button
                type="button"
                aria-label="Remove"
                className="grid size-6 shrink-0 cursor-pointer place-items-center text-ink4 hover:text-ink"
                onClick={() => edit(setEnv)(env.filter((_, j) => j !== i))}
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        className="mt-2 ml-0.5 cursor-pointer text-xs text-ink2 underline decoration-ink4 underline-offset-[3px] hover:text-ink"
        onClick={() => setEnv([...env, { key: "", value: "" }])}
      >
        + Add {runs === "http" ? "header" : "variable"}
      </button>
      <Hint>It starts with no agent allowed. You choose who may use it. Values are kept in your Keychain, not in a file.</Hint>

      <div className="px-1 text-xs leading-normal text-ink3" aria-live="polite">
        {testing ? (
          <span className="flex items-center gap-1.5">
            <Spinner className="size-3" /> Starting it. The first run of an npx package can take a minute.
          </span>
        ) : result === null ? null : result.ok ? (
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <Check className="size-[11px] text-green" strokeWidth={3} /> Connected. {result.tools.length} tool
            {result.tools.length === 1 ? "" : "s"} found:
            {result.tools.slice(0, 6).map((t) => (
              <code key={t.name} className="font-mono">
                {t.name}
              </code>
            ))}
            {result.tools.length > 6 && <span>and {result.tools.length - 6} more</span>}
          </span>
        ) : (
          <span className="break-words text-red">{result.error}</span>
        )}
      </div>
      {error && <p className="mt-1 px-1 text-xs text-red">{error}</p>}
    </Modal>
  );
}
