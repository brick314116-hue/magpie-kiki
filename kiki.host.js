// Magpie's side of this package: the Bun plugin-host entry.
//
// package.json "main" names this file, so magpie's plugin host loads it
// alongside the agent part. The host is a long-lived Bun process with
// node:fs and timers, so this watcher turns magpie's JSON handoff
// (~/.kiki/magpie.json) into Kiki's TOML files while magpie runs.
//
// The Kiki-side plugin (kimi.plugin.json + hooks/sync.mjs) does the same
// thing at session start. Both paths share lib/bridge.mjs, and a lock
// keeps them from interleaving. Installing only this one is enough while
// magpie runs; the Kiki-side hook covers the case where magpie is closed.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { syncOnce } from "./lib/bridge.mjs"

const HOME = process.env.KIKI_HOME || path.join(os.homedir(), ".kiki")
const HANDOFF = path.join(HOME, "magpie.json")
const EVERY = 1000
const FORCE_EVERY = 10

let started = false
let seen = null
let ticks = 0

// readHandoff is what the watcher compares: the handoff's text, or null
// when it isn't there. The file is small; reading it is cheaper than
// trusting mtime granularity on Windows.
function readHandoff() {
  try {
    return fs.readFileSync(HANDOFF, "utf8")
  } catch (e) {
    return null
  }
}

let running = false
async function tick() {
  ticks++
  const now = readHandoff()
  const changed = now !== seen
  if (!changed && ticks % FORCE_EVERY !== 0) return
  if (running) return
  running = true
  try {
    await syncOnce()
  } catch (e) {
    // syncOnce logs its own failures; never let one end the host
  } finally {
    running = false
    seen = now
  }
}

export default {
  id: "magpie-kiki-host",
  server() {
    if (started) return {}
    started = true
    tick()
    const timer = setInterval(tick, EVERY)
    // a watcher must not be what keeps a process alive on its own
    if (timer && typeof timer.unref === "function") timer.unref()
    return {}
  },
}
