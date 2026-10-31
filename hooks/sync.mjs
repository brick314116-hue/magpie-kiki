#!/usr/bin/env node
// Kiki's side of this package: the SessionStart hook.
//
// Kiki writes the session payload to stdin and closes it. Read it (we don't
// need it) so Kiki isn't blocked writing, but a manual run without stdin
// must not wait forever. The sync itself lives in lib/bridge.mjs, shared
// with kiki.host.js (magpie's side).
//
// A session is never blocked: every failure is written to
// ~/.kiki/.magpie-bridge/last.log and the process exits 0.

import { syncOnce } from "../lib/bridge.mjs"

let done = false
async function run() {
  if (done) return
  done = true
  try {
    await syncOnce()
  } catch (e) {
    // syncOnce already logs; this only guards the unexpected
  }
  process.exit(0)
}
setTimeout(run, 1500)
process.stdin.setEncoding("utf8")
process.stdin.on("data", () => {})
process.stdin.on("end", run)
process.stdin.on("error", run)
