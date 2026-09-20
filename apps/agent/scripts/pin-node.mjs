/**
 * Records which Node installed this tree's dependencies.
 *
 * **A native module is built for one ABI, and `better-sqlite3` is one.** The
 * install that fetched it also chose the ABI, so the node that installed the
 * tree is the only node that can run it — and `bin/mcode` resolving a `node`
 * from `PATH` instead is how a working install breaks on a machine with two:
 * measured here, a module built under Node 26 (ABI 147) was refused by the Node
 * 24 that a launchd `PATH` finds first, as
 * `NODE_MODULE_VERSION 147 … requires 137`.
 *
 * `postinstall`, so it is written by the same node that just built the module
 * and cannot describe a different one. `bin/mcode` reads it; re-installing after
 * a Node upgrade rewrites it.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
writeFileSync(join(root, '.node-runtime'), `${process.execPath}\n`);
