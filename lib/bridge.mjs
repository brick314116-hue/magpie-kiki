// The sync itself, shared by the two ways this package can run it:
//
//   lib/bridge.mjs  <- hooks/sync.mjs      (Kiki's SessionStart hook)
//                   <- kiki.host.js        (magpie's Bun plugin host)
//
// It reads ~/.kiki/magpie.json and turns it into Kiki's TOML files. It
// never reads stdin and never exits: the callers own that.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const PROVIDER = "magpie-kiki"
const START = "# >>> magpie-bridge >>>"
const END = "# <<< magpie-bridge <<<"
const FALLBACK_CONTEXT = 262144
const CATALOG_TIMEOUT = 2500
const CATALOG_LIMIT = 8 * 1024 * 1024
const KNOWN_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"])

const HOME = process.env.KIKI_HOME || path.join(os.homedir(), ".kiki")
const CONFIG = path.join(HOME, "config.toml")
const CREDS = path.join(HOME, "credentials", "credentials.toml")
const HANDOFF = path.join(HOME, "magpie.json")
const STATE_DIR = path.join(HOME, ".magpie-bridge")
const STATE = path.join(STATE_DIR, "state.json")
const LOG = path.join(STATE_DIR, "last.log")
const LOCK = path.join(STATE_DIR, "sync.lock")

function log(message) {
  try {
    fs.appendFileSync(LOG, "[" + new Date().toISOString() + "] " + message + "\n")
  } catch (e) {
    // the log is a courtesy, never a reason to fail
  }
}

// readToml returns a file as LF text, remembering a BOM and CRLF endings so
// the write puts them back. A missing file is empty and exists=false.
function readToml(file) {
  let raw
  try {
    raw = fs.readFileSync(file, "utf8")
  } catch (e) {
    if (e && e.code === "ENOENT") return { exists: false, bom: false, crlf: false, text: "" }
    throw e
  }
  const bom = raw.charCodeAt(0) === 0xfeff
  if (bom) raw = raw.slice(1)
  const crlf = raw.indexOf("\r\n") >= 0
  return { exists: true, bom: bom, crlf: crlf, text: raw.replace(/\r\n/g, "\n") }
}

function writeToml(file, doc) {
  let text = doc.text
  if (doc.crlf) text = text.replace(/\n/g, "\r\n")
  writeAtomic(file, (doc.bom ? String.fromCharCode(0xfeff) : "") + text)
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + ".magpie-" + process.pid + ".tmp"
  fs.writeFileSync(tmp, text, "utf8")
  try {
    fs.renameSync(tmp, file)
  } catch (e) {
    // a file another program holds open on Windows: write in place
    fs.writeFileSync(file, text, "utf8")
    try { fs.rmSync(tmp, { force: true }) } catch (e2) {}
  }
}

// tomlString is a TOML basic string for one value. JSON's escaping is a
// subset of TOML's ("\\", "\"", "\n", "\uXXXX"), and our values are one
// line, so this is enough here.
function tomlString(value) {
  return JSON.stringify(String(value))
}

function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// firstTableIndex is where the first [table] header starts, so top-level
// keys (default_model among them) are found only in front of it.
function firstTableIndex(text) {
  let at = 0
  while (at < text.length) {
    let end = text.indexOf("\n", at)
    if (end < 0) end = text.length
    if (/^[ \t]*\[/.test(text.slice(at, end))) return at
    at = end + 1
  }
  return text.length
}

// valueOf reads the value of a `key = value` line: a double-quoted TOML
// string (through JSON), a literal one, or an unquoted token.
function valueOf(line) {
  const eq = line.indexOf("=")
  if (eq < 0) return ""
  const v = line.slice(eq + 1).trim()
  if (v.startsWith('"')) {
    let i = 1
    let esc = false
    for (; i < v.length; i++) {
      const c = v[i]
      if (esc) { esc = false; continue }
      if (c === "\\") { esc = true; continue }
      if (c === '"') { i++; break }
    }
    try { return JSON.parse(v.slice(0, i)) } catch (e) { return v.slice(0, i) }
  }
  if (v.startsWith("'")) {
    const end = v.indexOf("'", 1)
    return end < 0 ? v : v.slice(1, end)
  }
  const hash = v.indexOf("#")
  return (hash < 0 ? v : v.slice(0, hash)).trim()
}

// scanDefault finds the top-level default_model line before any table.
function scanDefault(text) {
  const limit = firstTableIndex(text)
  const re = /^[ \t]*default_model[ \t]*=[^\n]*/gm
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index >= limit) break
    return { index: m.index, length: m[0].length, line: m[0], value: valueOf(m[0]) }
  }
  return null
}

function setDefault(text, alias) {
  const line = "default_model = " + tomlString(alias)
  const cur = scanDefault(text)
  if (cur) {
    return text.slice(0, cur.index) + line + text.slice(cur.index + cur.length)
  }
  return line + "\n" + text
}

function restoreDefault(text, state) {
  const cur = scanDefault(text)
  if (!cur || cur.value !== state.alias) return text
  const prev = state.previousDefault || { had: false }
  if (prev.had && typeof prev.line === "string") {
    return text.slice(0, cur.index) + prev.line + text.slice(cur.index + cur.length)
  }
  let after = text.slice(cur.index + cur.length)
  if (after.startsWith("\n\n")) after = after.slice(1)
  else if (after.startsWith("\n")) after = after.slice(1)
  return text.slice(0, cur.index) + after
}

// stripBlock removes the block this plugin wrote, marker lines included.
// A start marker with no end marker takes the rest of the file with it,
// since the tail is ours.
function stripBlock(text) {
  const lines = text.split(/\r?\n/)
  const out = []
  let inside = false
  for (const line of lines) {
    const t = line.trim()
    if (!inside && t === START) { inside = true; continue }
    if (inside) {
      if (t === END) inside = false
      continue
    }
    if (t === END) continue
    out.push(line)
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n")
}

function appendBlock(text, block) {
  let head = text.replace(/[ \t\r\n]+$/, "")
  if (head) head += "\n\n"
  return head + block + "\n"
}

// oursHeader says a table header is one this plugin writes: the unique
// magpie-kiki provider (and its subtables) or a model alias under it.
function oursHeader(line) {
  if (/^[ \t]*\[[ \t]*providers[ \t]*\.[ \t]*(?:"magpie-kiki"|magpie-kiki)(?:[ \t]*[.\]])/.test(line)) {
    return true
  }
  return /^[ \t]*\[[ \t]*models[ \t]*\.[ \t]*"magpie-kiki\//.test(line)
}

// stripOurs removes the marker block, and, when this plugin wrote before
// (a state is on disk), our tables too. Kiki may rewrite config.toml and
// drop comments; the tables stay, and a marker-only cleanup would then see
// them as someone else's and refuse to write. Only magpie-kiki tables are
// ours, so the user's own tables are never touched.
function stripOurs(text, own) {
  let out = stripBlock(text)
  if (!own) return out
  const lines = out.split("\n")
  const kept = []
  let skipping = false
  for (const line of lines) {
    if (/^[ \t]*\[/.test(line)) skipping = oursHeader(line)
    if (!skipping) kept.push(line)
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n")
}

function hasTable(text, quotedName, bareName) {
  const q = new RegExp("^[ \\t]*\\[[ \\t]*" + quotedName + "[ \\t]*\\]", "m")
  if (q.test(text)) return true
  if (!bareName) return false
  const b = new RegExp("^[ \\t]*\\[[ \\t]*" + bareName + "[ \\t]*\\]", "m")
  return b.test(text)
}

function providerBlock(gateway) {
  return [
    START,
    "# Written from ~/.kiki/magpie.json by the Magpie Bridge Kiki plugin.",
    "# magpie owns these values; edits here last until the next session.",
    "[providers.\"" + PROVIDER + "\"]",
    "type = \"openai\"",
    "base_url = " + tomlString(gateway.v1),
    "",
  ].join("\n")
}

function modelBlock(model) {
  const lines = [
    "[models." + tomlString(model.alias) + "]",
    "provider = " + tomlString(PROVIDER),
    "model = " + tomlString(model.id),
    "max_context_size = " + String(model.context),
  ]
  // Kiki currently honors max_output_size for the anthropic provider only.
  // It is still the truthful per-model ceiling and costs nothing to keep.
  if (model.output) lines.push("max_output_size = " + String(model.output))
  if (model.name) lines.push("display_name = " + tomlString(model.name))
  if (model.capabilities.length) {
    lines.push("capabilities = [" + model.capabilities.map(tomlString).join(", ") + "]")
  }
  if (model.efforts.length) {
    lines.push("support_efforts = [" + model.efforts.map(tomlString).join(", ") + "]")
    lines.push("default_effort = " + tomlString(defaultEffort(model.efforts)))
  }
  return lines
}

function credentialsBlock(key) {
  return [
    START,
    "[providers.\"" + PROVIDER + "\"]",
    "api_key = " + tomlString(key),
    END,
  ].join("\n")
}

function readState() {
  try {
    const raw = fs.readFileSync(STATE, "utf8")
    const state = JSON.parse(raw)
    if (state && typeof state === "object") return state
  } catch (e) {}
  return null
}

function writeState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  writeAtomic(STATE, JSON.stringify(state, null, 2) + "\n")
}

function readHandoff() {
  let raw
  try {
    raw = fs.readFileSync(HANDOFF, "utf8")
  } catch (e) {
    return { present: false }
  }
  if (!raw.trim()) return { present: true, data: null }
  try {
    const data = JSON.parse(raw)
    return { present: true, data: data && typeof data === "object" ? data : null }
  } catch (e) {
    return { present: true, invalid: true }
  }
}

function numberOr(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function cleanText(value, max) {
  if (typeof value !== "string") return ""
  const text = value.trim()
  if (!text || text.length > (max || 2048)) return ""
  return /[\x00-\x1f]/.test(text) ? "" : text
}

// catalogEndpoint turns magpie's gateway address into /v1/models only when
// it is a loopback URL. The gateway key is never sent to another host.
function catalogEndpoint(v1) {
  try {
    const url = new URL(v1)
    if (url.protocol !== "http:" && url.protocol !== "https:") return ""
    if (!["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)) return ""
    if (url.username || url.password || url.search || url.hash) return ""
    if (!/^\/v1\/?$/.test(url.pathname)) return ""
    return url.href.replace(/\/$/, "") + "/models"
  } catch (e) {
    return ""
  }
}

function effortsOf(row) {
  const advertised = []
  const levels = Array.isArray(row.supported_reasoning_levels) ? row.supported_reasoning_levels : []
  for (const level of levels) {
    const effort = cleanText(level && level.effort, 32)
    if (effort && !advertised.includes(effort)) advertised.push(effort)
  }
  return { advertised: advertised, efforts: advertised.filter((e) => KNOWN_EFFORTS.has(e)) }
}

// modelFromRow maps one magpie /v1/models entry to a Kiki model table.
function modelFromRow(row) {
  const id = cleanText(row.id)
  if (!id) return null
  const levels = effortsOf(row)
  const reasoning = row.reasoning === true || levels.efforts.length > 0
  const capabilities = []
  // Kiki needs a resolvable default_effort to launch a thinking model, so
  // only claim thinking when magpie named at least one known level.
  if (levels.efforts.length) capabilities.push("thinking")
  if (reasoning && levels.advertised.length
      && levels.advertised.every((e) => KNOWN_EFFORTS.has(e))
      && !levels.advertised.includes("none")) {
    capabilities.push("always_thinking")
  }
  const inputs = Array.isArray(row.modalities && row.modalities.input) ? row.modalities.input : []
  if (inputs.includes("image")) capabilities.push("image_in")
  if (inputs.includes("video")) capabilities.push("video_in")
  if (inputs.includes("audio")) capabilities.push("audio_in")
  return {
    id: id,
    alias: PROVIDER + "/" + id,
    context: numberOr(row.context_window || row.context_length, FALLBACK_CONTEXT),
    output: numberOr(row.max_output_tokens, 0),
    name: cleanText(row.magpie_label) || cleanText(row.display_name) || id,
    capabilities: capabilities,
    efforts: levels.efforts,
  }
}

// handoffModel is the fallback for the one model magpie selected, used when
// the catalog cannot be read (gateway closed, old magpie, malformed reply).
function handoffModel(handoff) {
  const id = handoff.model
  const efforts = Array.isArray(handoff.efforts)
    ? handoff.efforts.filter((e) => typeof e === "string" && KNOWN_EFFORTS.has(e))
    : []
  const capabilities = []
  if (efforts.length) capabilities.push("thinking")
  if (handoff.images === true) capabilities.push("image_in")
  return {
    id: id,
    alias: PROVIDER + "/" + id,
    context: numberOr(handoff.context, FALLBACK_CONTEXT),
    output: numberOr(handoff.output, 0),
    name: cleanText(handoff.name) || id,
    capabilities: capabilities,
    efforts: efforts,
  }
}

function withSelected(models, handoff) {
  if (models.some((m) => m.id === handoff.model)) return models
  log("the selected model is not in the model catalog; adding it")
  return models.concat([handoffModel(handoff)])
}

async function fetchCatalog(gateway) {
  const endpoint = catalogEndpoint(gateway.v1)
  if (!endpoint) {
    log("gateway.v1 is not a loopback /v1 URL; not fetching the model catalog")
    return null
  }
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer " + gateway.key,
        "User-Agent": "kiki-cli",
      },
      signal: AbortSignal.timeout(CATALOG_TIMEOUT),
      redirect: "error",
    })
    if (!response.ok) {
      log("model catalog returned HTTP " + response.status)
      return null
    }
    const declared = Number(response.headers.get("content-length") || 0)
    if (declared > CATALOG_LIMIT) {
      log("model catalog is too large")
      return null
    }
    const text = await response.text()
    if (Buffer.byteLength(text) > CATALOG_LIMIT) {
      log("model catalog is too large")
      return null
    }
    const payload = JSON.parse(text)
    if (!payload || !Array.isArray(payload.data) || payload.has_more || payload.data.length > 50000) {
      log("model catalog has an unexpected shape")
      return null
    }
    const models = []
    const seen = new Set()
    for (const row of payload.data) {
      if (!row || typeof row !== "object") continue
      const model = modelFromRow(row)
      if (!model || seen.has(model.id)) continue
      seen.add(model.id)
      models.push(model)
    }
    return models
  } catch (e) {
    log("could not fetch the model catalog: " + (e && e.message ? e.message : String(e)))
    return null
  }
}

// defaultEffort picks the level Kiki starts at. Kiki refuses to launch a
// thinking model with no resolvable default when the user's config has no
// global [thinking].effort, so one must be written. High is Kiki's own
// example default; when a model lacks it, step down before taking the
// last level the model names.
function defaultEffort(efforts) {
  for (const want of ["high", "medium", "low"]) {
    if (efforts.includes(want)) return want
  }
  return efforts[efforts.length - 1]
}

async function sync(handoff) {
  const gateway = handoff.gateway || {}
  const model = handoff.model
  if (typeof model !== "string" || !model) { cleanup(); return }
  if (typeof gateway.v1 !== "string" || !gateway.v1) { cleanup(); return }
  if (typeof gateway.key !== "string" || !gateway.key) { cleanup(); return }

  let state = readState()
  const cfg = readToml(CONFIG)
  const base = stripOurs(cfg.text, !!state)
  const cred = readToml(CREDS)
  const credBase = stripOurs(cred.text, !!state)

  // Magpie decides which models this agent may see. /v1/models is the
  // same catalog its Agents page uses, so every checked model lands in
  // Kiki, not only the one the handoff names. If the gateway is closed,
  // reuse the last catalog; if there is none, fall back to that one model.
  const fresh = await fetchCatalog(gateway)
  let models = fresh && fresh.length ? fresh : null
  if (!models && state && Array.isArray(state.catalog) && state.catalog.length) {
    models = state.catalog
    log("using the last model catalog")
  }
  if (!models) models = []
  models = withSelected(models, handoff)

  const alias = PROVIDER + "/" + model

  // Both files are checked before either is written: a table named
  // magpie-kiki that predates this plugin is the user's, and taking it
  // over would be worse than doing nothing. This includes every catalog
  // model, since one collision would make the whole block ambiguous.
  if (hasTable(base, "providers\\.\"" + escapeRe(PROVIDER) + "\"", "providers\\." + escapeRe(PROVIDER))) {
    log("config.toml already has a " + PROVIDER + " provider table; leaving it alone")
    return
  }
  for (const item of models) {
    if (hasTable(base, "models\\.\"" + escapeRe(item.alias) + "\"", null)) {
      log("config.toml already has a " + item.alias + " model table; leaving it alone")
      return
    }
  }
  if (hasTable(credBase, "providers\\.\"" + escapeRe(PROVIDER) + "\"", "providers\\." + escapeRe(PROVIDER))) {
    log("credentials.toml already has a " + PROVIDER + " provider table; leaving it alone")
    return
  }

  if (!state) {
    const cur = scanDefault(base)
    let previous = { had: false }
    // if default_model is already ours, the original is unknown; don't
    // claim to restore it later
    if (cur && cur.value !== alias) previous = { had: true, line: cur.line }
    state = { version: 1, provider: PROVIDER, alias: alias, previousDefault: previous }
  } else {
    state.version = 1
    state.provider = PROVIDER
    state.alias = alias
  }
  if (fresh && fresh.length) state.catalog = fresh
  // state first: a failed config write is retried, and the original
  // default_model isn't lost on the retry
  writeState(state)

  let next = setDefault(base, alias)
  let block = providerBlock(gateway)
  for (const item of models) {
    block += "\n" + modelBlock(item).join("\n") + "\n"
  }
  block += END
  next = appendBlock(next, block)
  if (next !== cfg.text) {
    cfg.text = next
    writeToml(CONFIG, cfg)
  }

  const credNext = appendBlock(credBase, credentialsBlock(gateway.key))
  if (!cred.exists || credNext !== cred.text) {
    cred.text = credNext
    writeToml(CREDS, cred)
    try { fs.chmodSync(CREDS, 0o600) } catch (e) {}
  }
}

function cleanup() {
  const state = readState()
  if (!state) return
  const cfg = readToml(CONFIG)
  if (cfg.exists) {
    const next = restoreDefault(stripOurs(cfg.text, true), state)
    if (next !== cfg.text) {
      cfg.text = next
      writeToml(CONFIG, cfg)
    }
  }
  const cred = readToml(CREDS)
  if (cred.exists) {
    const next = stripOurs(cred.text, true)
    if (next !== cred.text) {
      cred.text = next
      writeToml(CREDS, cred)
    }
  }
  try { fs.rmSync(STATE, { force: true }) } catch (e) {}
}

// withLock keeps two sessions starting at once from interleaving writes.
// A lock older than a minute is a crashed run, not a slow one. The log is
// cleared once per process: magpie's watcher calls this for days.
let logCleared = false

async function withLock(fn, attempt) {
  attempt = attempt || 0
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true })
    if (!logCleared) {
      logCleared = true
      fs.writeFileSync(LOG, "")
    }
  } catch (e) {}
  let fd = null
  try {
    fd = fs.openSync(LOCK, "wx")
    fs.writeSync(fd, String(process.pid))
  } catch (e) {
    try {
      const st = fs.statSync(LOCK)
      if (Date.now() - st.mtimeMs > 60000 && attempt < 2) {
        fs.rmSync(LOCK, { force: true })
        return withLock(fn, attempt + 1)
      }
    } catch (e2) {}
    log("another session is syncing; skipped")
    return
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd) } catch (e) {}
    }
  }
  try {
    await fn()
  } catch (e) {
    log("failed: " + (e && e.stack ? e.stack : String(e)))
  } finally {
    try { fs.rmSync(LOCK, { force: true }) } catch (e) {}
  }
}

// syncOnce applies the handoff now, or takes back what this package wrote
// when magpie's keys are gone. Every failure is logged and swallowed, so a
// session and magpie's plugin host both keep going.
async function applyHandoff() {
  const handoff = readHandoff()
  if (handoff.invalid) {
    log("magpie.json is not valid JSON; leaving Kiki's config alone")
    return
  }
  if (!handoff.present || !handoff.data) {
    cleanup()
    return
  }
  await sync(handoff.data)
}

export async function syncOnce() {
  await withLock(applyHandoff)
}
