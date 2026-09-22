// Turn on Node's compile cache for the agent's ESM bundle.
//
// **Worth a file because the flag alone does not work here.** `NODE_COMPILE_CACHE`
// is the documented way and writes nothing for this tree; `enableCompileCache`
// is the API that does, and it has to run *before* the first module of the
// bundle is parsed — hence a preload rather than a line inside the CLI.
//
// Measured on the shipped build: 11MB across 65 files written on the first run,
// and `initialize` down from 1.33s to 0.96s on every run after — a quarter of the
// boot, which is the whole of what a reader waits for before a session can speak.
//
// **And it is only written on a clean exit.** Node flushes this cache as the
// process ends, so a child that is killed with SIGKILL leaves nothing behind —
// which is why an earlier measurement of this found zero bytes: the harness
// killed the child rather than letting it leave. The app already does the right
// thing: `harness::mcode::shutdown` sends `session/close`, closes the pipe and
// waits out `SHUTDOWN_GRACE` before killing, and every path that drops a session
// goes through it.
import { enableCompileCache } from "node:module";

const dir = process.env.HZ_COMPILE_CACHE;
if (dir) {
  const result = enableCompileCache(dir);
  // Visible under `HZ_AGENT_DEBUG` like everything else the agent says on stderr,
  // since a cache that silently stops working costs the boot it was meant to save.
  if (process.env.HZ_AGENT_DEBUG) console.error("hz-agent compile cache:", JSON.stringify(result));
}
