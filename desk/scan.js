#!/usr/bin/env node
// The desk's setup scan. Read-only, no network, no dependencies (Node 16 or newer).
// It inventories the agent harness around a project so the agent running /desk setup can
// guess who the user is and how their work is laid out, then ask one steering question.
//
//   node desk/scan.js                         root = the current folder, home = your user folder
//   node desk/scan.js --root path/to/project  scan another project
//   node desk/scan.js --home path/to/home     read the user level from another folder
//   node desk/scan.js --no-home               skip the user level entirely
//   node desk/scan.js --out some/dir          write scan.json and scan.md there (default: the folder this script sits in)
//   node desk/scan.js --schedulers            also list scheduled jobs whose names look desk-related (read-only list command)
//
// What it records: presence, counts, paths relative to the root (or "~/..." for the user level),
// skill and agent names with their one-line descriptions, hook EVENT names and the hook's script
// file name, MCP server NAMES and their type. It never records environment values, tokens,
// arguments, headers or full hook commands, and it never opens a network connection.
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const VERSION = 1;
const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const ROOT = path.resolve(arg("--root") || process.cwd());
const NO_HOME = args.includes("--no-home");
const HOME = NO_HOME ? null : path.resolve(arg("--home") || os.homedir());
const OUT = path.resolve(arg("--out") || __dirname);
const SCHEDULERS = args.includes("--schedulers");

const LIMITS = { depth: 7, entries: 60000, ms: 12000, projects: 200, skills: 300, agents: 100, headings: 40, desc: 220, list: 60, readme_reads: 400 };
const SKIP_DIRS = new Set([
  "node_modules", "bower_components", "vendor", "venv", "env", "__pycache__", "site-packages", "dist", "build", "out",
  "target", "coverage", "Pods", "DerivedData", "AppData", "Library", "Application Data", "obj", "bin", "packages",
]);
const t0 = Date.now();
let truncated = [];
const note = (why) => { if (!truncated.includes(why)) truncated.push(why); };

// ---------------------------------------------------------------- small helpers
const exists = (p) => { try { fs.accessSync(p); return true; } catch (e) { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };
const readText = (p, max) => { try { const s = fs.readFileSync(p, "utf8"); return max ? s.slice(0, max) : s; } catch (e) { return null; } };
const readJSON = (p) => { const s = readText(p); if (s == null) return null; try { return JSON.parse(s.replace(/^﻿/, "")); } catch (e) { return { __unparsed: true }; } };
const ls = (p) => { try { return fs.readdirSync(p, { withFileTypes: true }); } catch (e) { return []; } };
const real = (p) => { try { return fs.realpathSync(p); } catch (e) { return p; } };
const mtimeDay = (p) => { try { return fs.statSync(p).mtime.toISOString().slice(0, 10); } catch (e) { return null; } };
const posix = (p) => p.split(path.sep).join("/");
const rel = (p) => {
  const r = path.relative(ROOT, p);
  if (!r) return ".";
  if (!r.startsWith("..") && !path.isAbsolute(r)) return posix(r);
  if (HOME) { const h = path.relative(HOME, p); if (!h.startsWith("..") && !path.isAbsolute(h)) return "~/" + posix(h); }
  return "(outside root)/" + path.basename(p);
};
const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const lineCount = (s) => (s ? s.split(/\r?\n/).length : 0);
const headingsOf = (s) => (s || "").split(/\r?\n/).filter((l) => /^#{1,4}\s+\S/.test(l)).slice(0, LIMITS.headings).map((l) => clip(l, 100));
const firstHeading = (s) => { const h = (s || "").split(/\r?\n/).find((l) => /^#{1,3}\s+\S/.test(l)); return h ? clip(h.replace(/^#+\s*/, ""), 100) : null; };
const cap = (arr, n, why) => { if (arr.length > n) { note(why || "list capped"); return arr.slice(0, n); } return arr; };

function frontmatter(text) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text || "");
  if (!m) return {};
  const out = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v === ">" || v === "|" || v === ">-" || v === "|-" || v === "") {
      const parts = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) parts.push(lines[++i].trim());
      v = parts.join(" ");
    }
    out[kv[1]] = v.replace(/^["']|["']$/g, "");
  }
  return out;
}

// The script a hook runs, by file name only. Never the full command, never its arguments.
function scriptOf(command) {
  const c = String(command || "");
  const m = c.match(/[\w.\-]+\.(?:js|mjs|cjs|ts|py|sh|bash|ps1|psm1|bat|cmd|rb|pl|exe)\b/i);
  if (m) return m[0];
  const first = c.trim().replace(/^["']/, "").split(/[\s"']/)[0];
  return first ? path.basename(first.replace(/\\/g, "/")) : null;
}

// ---------------------------------------------------------------- 1. harness: instruction files
const harness = { detected: [], markers: {} };
const mark = (key, p) => { harness.markers[key] = rel(p); };
const instructions = [];
function addInstruction(p, kind) {
  if (!isFile(p)) return;
  const s = readText(p);
  instructions.push({ path: rel(p), kind, lines: lineCount(s), headings: headingsOf(s) });
}
for (const [f, kind] of [["CLAUDE.md", "claude"], ["CLAUDE.local.md", "claude"], ["AGENTS.md", "agents"], ["GEMINI.md", "gemini"], [".cursorrules", "cursor"], [".windsurfrules", "windsurf"], [".github/copilot-instructions.md", "copilot"]]) {
  addInstruction(path.join(ROOT, f), kind);
}
if (HOME) { addInstruction(path.join(HOME, ".claude", "CLAUDE.md"), "claude-user"); addInstruction(path.join(HOME, ".codex", "AGENTS.md"), "codex-user"); }

const cursorRules = [];
for (const d of ls(path.join(ROOT, ".cursor", "rules"))) {
  if (!d.isFile() || !/\.mdc?$/i.test(d.name)) continue;
  const p = path.join(ROOT, ".cursor", "rules", d.name);
  const fm = frontmatter(readText(p, 4000));
  cursorRules.push({ name: d.name.replace(/\.mdc?$/i, ""), path: rel(p), always_apply: String(fm.alwaysApply) === "true", description: clip(fm.description, LIMITS.desc) || null });
}

const workspaces = ls(ROOT).filter((d) => d.isFile() && /\.code-workspace$/i.test(d.name)).map((d) => d.name);
if (exists(path.join(ROOT, ".claude")) || exists(path.join(ROOT, "CLAUDE.md"))) harness.detected.push("claude-code");
if (exists(path.join(ROOT, ".codex")) || (HOME && exists(path.join(HOME, ".codex")))) harness.detected.push("codex");
if (exists(path.join(ROOT, ".cursor")) || exists(path.join(ROOT, ".cursorrules"))) harness.detected.push("cursor");
if (exists(path.join(ROOT, "AGENTS.md")) || exists(path.join(ROOT, ".agents"))) harness.detected.push("agents-md");
if (exists(path.join(ROOT, "GEMINI.md"))) harness.detected.push("gemini");
if (exists(path.join(ROOT, ".github", "copilot-instructions.md"))) harness.detected.push("copilot");
if (workspaces.length || exists(path.join(ROOT, ".vscode"))) harness.detected.push("vscode-family-editor");
if (HOME && exists(path.join(HOME, ".claude")) && !harness.detected.includes("claude-code")) harness.detected.push("claude-code (user level only)");
for (const [k, p] of [["claude_dir", ".claude"], ["agents_dir", ".agents"], ["codex_dir", ".codex"], ["cursor_dir", ".cursor"], ["vscode_dir", ".vscode"], ["skills_lock", "skills-lock.json"], ["mcp_json", ".mcp.json"]]) {
  if (exists(path.join(ROOT, p))) mark(k, path.join(ROOT, p));
}

// ---------------------------------------------------------------- 2. skills, agents, commands
const skills = [];
const seenSkill = new Set();
function scanSkills(dir, scope, store) {
  if (!isDir(dir)) return;
  const linked = real(dir) !== path.resolve(dir);
  for (const d of ls(dir)) {
    const sd = path.join(dir, d.name);
    if (!isDir(sd)) continue;
    const f = path.join(sd, "SKILL.md");
    if (!isFile(f)) continue;
    const key = real(f).toLowerCase();
    if (seenSkill.has(key)) continue;
    seenSkill.add(key);
    const fm = frontmatter(readText(f, 8000));
    skills.push({ name: fm.name || d.name, scope, store, path: rel(sd), via_link: linked || real(sd) !== path.resolve(sd), description: clip(fm.description, LIMITS.desc) || null, manual_only: String(fm["disable-model-invocation"]) === "true" });
  }
}
scanSkills(path.join(ROOT, ".claude", "skills"), "project", ".claude/skills");
scanSkills(path.join(ROOT, ".agents", "skills"), "project", ".agents/skills");
scanSkills(path.join(ROOT, ".codex", "skills"), "project", ".codex/skills");
scanSkills(path.join(ROOT, ".cursor", "skills"), "project", ".cursor/skills");
scanSkills(path.join(ROOT, "skills"), "project", "skills/");
if (HOME) {
  scanSkills(path.join(HOME, ".claude", "skills"), "user", "~/.claude/skills");
  scanSkills(path.join(HOME, ".agents", "skills"), "user", "~/.agents/skills");
  scanSkills(path.join(HOME, ".codex", "skills"), "user", "~/.codex/skills");
}
const skillLinks = {};
for (const p of [".claude/skills", ".agents/skills"]) {
  const abs = path.join(ROOT, p);
  if (isDir(abs) && real(abs) !== path.resolve(abs)) skillLinks[p] = rel(real(abs));
}

const skillPacks = [];
{
  const lock = readJSON(path.join(ROOT, "skills-lock.json"));
  if (lock && !lock.__unparsed) {
    const entries = lock.skills || lock.packages || lock;
    const add = (name, v) => {
      let src = v && (v.source || v.repo || v.url || v.from) || null;
      if (typeof src === "string") { const gm = /github\.com[/:]([^/]+)\/([^/#?.]+)/i.exec(src); src = gm ? `${gm[1]}/${gm[2]}` : clip(src.replace(/^https?:\/\//, ""), 80); }
      skillPacks.push({ name, source: src });
    };
    if (Array.isArray(entries)) entries.forEach((v, i) => add((v && v.name) || String(i), v));
    else if (entries && typeof entries === "object") for (const [k, v] of Object.entries(entries)) if (k !== "version" && k !== "lockfileVersion") add(k, v);
  }
}

const agents = [];
function scanAgents(dir, scope) {
  for (const d of ls(dir)) {
    if (!d.isFile() || !/\.md$/i.test(d.name)) continue;
    const fm = frontmatter(readText(path.join(dir, d.name), 8000));
    agents.push({ name: fm.name || d.name.replace(/\.md$/i, ""), scope, path: rel(path.join(dir, d.name)), description: clip(fm.description, LIMITS.desc) || null });
  }
}
scanAgents(path.join(ROOT, ".claude", "agents"), "project");
if (HOME) scanAgents(path.join(HOME, ".claude", "agents"), "user");

const commands = [];
function scanCommands(dir, scope, prefix) {
  for (const d of ls(dir)) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) scanCommands(p, scope, (prefix ? prefix + ":" : "") + d.name);
    else if (/\.md$/i.test(d.name)) commands.push({ name: (prefix ? prefix + ":" : "") + d.name.replace(/\.md$/i, ""), scope, path: rel(p) });
  }
}
scanCommands(path.join(ROOT, ".claude", "commands"), "project", "");
if (HOME) scanCommands(path.join(HOME, ".claude", "commands"), "user", "");

// ---------------------------------------------------------------- 3. hooks, permissions, plugins
const hooks = [];
const EVENT_RE = /^(SessionStart|SessionEnd|Stop|SubagentStop|PreToolUse|PostToolUse|UserPromptSubmit|Notification|PreCompact|[a-z]+[A-Z]\w*)$/;
function collectHooks(obj, scope, file) {
  if (!obj || typeof obj !== "object") return;
  const root = obj.hooks && typeof obj.hooks === "object" && !Array.isArray(obj.hooks) ? obj.hooks : obj.version !== undefined ? {} : obj;
  for (const [event, groups] of Object.entries(root)) {
    if (!EVENT_RE.test(event) || !Array.isArray(groups)) continue;
    for (const g of groups) {
      const inner = g && Array.isArray(g.hooks) ? g.hooks : [g];
      for (const h of inner) {
        if (!h) continue;
        const cmd = typeof h === "string" ? h : h.command || h.cmd || h.script || "";
        if (!cmd && !(h && h.type)) continue;
        hooks.push({ event, scope, file: rel(file), matcher: g && g.matcher ? clip(g.matcher, 60) : null, script: scriptOf(cmd) });
      }
    }
  }
}
const permissions = { allow: 0, deny: 0, ask: 0, mcp_servers_with_denied_tools: {}, mcp_servers_allowed: {} };
const plugins = [];
const settingsFiles = [];
function readSettings(p, scope) {
  const s = readJSON(p);
  if (!s) return;
  settingsFiles.push({ path: rel(p), scope, parsed: !s.__unparsed });
  if (s.__unparsed) return;
  if (s.hooks && typeof s.hooks === "object") collectHooks({ hooks: s.hooks }, scope, p);
  const perm = s.permissions || {};
  for (const k of ["allow", "deny", "ask"]) {
    const list = Array.isArray(perm[k]) ? perm[k] : [];
    permissions[k] += list.length;
    for (const rule of list) {
      const m = /^mcp__(.+?)(?:__|\(|$)/.exec(String(rule));
      if (!m) continue;
      const bucket = k === "deny" ? permissions.mcp_servers_with_denied_tools : k === "allow" ? permissions.mcp_servers_allowed : null;
      if (bucket) bucket[m[1]] = (bucket[m[1]] || 0) + 1;
    }
  }
  if (s.enabledPlugins && typeof s.enabledPlugins === "object") {
    for (const [name, on] of Object.entries(s.enabledPlugins)) plugins.push({ name, enabled: !!on, scope });
  }
  if (Array.isArray(s.enabledMcpjsonServers)) mcpPolicy.enabled.push(...s.enabledMcpjsonServers);
  if (Array.isArray(s.disabledMcpjsonServers)) mcpPolicy.disabled.push(...s.disabledMcpjsonServers);
}
const mcpPolicy = { enabled: [], disabled: [] };
readSettings(path.join(ROOT, ".claude", "settings.json"), "project");
readSettings(path.join(ROOT, ".claude", "settings.local.json"), "project-local");
if (HOME) { readSettings(path.join(HOME, ".claude", "settings.json"), "user"); readSettings(path.join(HOME, ".claude", "settings.local.json"), "user-local"); }
for (const [p, scope] of [[path.join(ROOT, ".codex", "hooks.json"), "codex-project"], [path.join(ROOT, ".cursor", "hooks.json"), "cursor-project"]].concat(HOME ? [[path.join(HOME, ".codex", "hooks.json"), "codex-user"], [path.join(HOME, ".cursor", "hooks.json"), "cursor-user"]] : [])) {
  const j = readJSON(p);
  if (j && !j.__unparsed) collectHooks(j, scope, p);
}

// ---------------------------------------------------------------- 4. MCP servers (names and type only)
const mcp = [];
const CATEGORIES = [
  ["tracker", /linear|jira|clickup|trello|asana|notion|monday|shortcut|height|todoist|basecamp|youtrack|github|gitlab|atlassian/i],
  ["calendar", /calendar|gcal|cal\.com|calendly/i],
  ["mail", /gmail|mail|outlook|fastmail/i],
  ["docs", /drive|docs|confluence|dropbox|onedrive|sharepoint|box|obsidian|guru/i],
  ["meeting notes", /granola|fireflies|otter|fathom|zoom|meet|tldv|transcri/i],
  ["browser", /browser|playwright|puppeteer|chrome|selenium/i],
  ["desktop automation", /windows|desktop|computer|applescript|macos|autohotkey/i],
  ["cms", /wordpress|\bwp\b|webflow|contentful|sanity|ghost|shopify|strapi/i],
  ["design", /figma|canva|excalidraw|penpot|sketch/i],
  ["automation", /zapier|\bmake\b|n8n|ifttt|pipedream/i],
  ["chat", /slack|discord|teams|telegram|intercom/i],
  ["data", /postgres|mysql|sqlite|bigquery|snowflake|supabase|hex|database|sql/i],
  ["docs search", /docs|context7|devdocs/i],
];
const category = (name) => { for (const [c, re] of CATEGORIES) if (re.test(name)) return c; return "other"; };
function addServers(obj, scope, file) {
  if (!obj || typeof obj !== "object") return;
  for (const [name, v] of Object.entries(obj)) {
    const type = (v && (v.type || v.transport)) || (v && (v.url || v.httpUrl || v.serverUrl) ? "http" : v && v.command ? "stdio" : "unknown");
    mcp.push({ name, type: String(type), scope, file: rel(file), category: category(name), disabled: !!(v && v.disabled) || mcpPolicy.disabled.includes(name) });
  }
}
{
  const pj = readJSON(path.join(ROOT, ".mcp.json"));
  if (pj && !pj.__unparsed) addServers(pj.mcpServers || pj.servers, "project", path.join(ROOT, ".mcp.json"));
  const cj = readJSON(path.join(ROOT, ".cursor", "mcp.json"));
  if (cj && !cj.__unparsed) addServers(cj.mcpServers || cj.servers, "cursor-project", path.join(ROOT, ".cursor", "mcp.json"));
  const vj = readJSON(path.join(ROOT, ".vscode", "mcp.json"));
  if (vj && !vj.__unparsed) addServers(vj.servers || vj.mcpServers, "vscode-project", path.join(ROOT, ".vscode", "mcp.json"));
}
function tomlServers(p, scope) {
  const s = readText(p);
  if (!s) return;
  const re = /^\s*\[mcp_servers\.("?)([^\]"]+)\1\]\s*$/gm;
  let m;
  const found = [];
  while ((m = re.exec(s))) found.push({ name: m[2], at: m.index });
  found.forEach((f, i) => {
    const body = s.slice(f.at, i + 1 < found.length ? found[i + 1].at : s.length);
    const type = /^\s*url\s*=/m.test(body) ? "http" : /^\s*command\s*=/m.test(body) ? "stdio" : "unknown";
    if (f.name.includes(".")) return; // a sub-table such as [mcp_servers.x.env]: its values are never read
    mcp.push({ name: f.name, type, scope, file: rel(p), category: category(f.name), disabled: /^\s*enabled\s*=\s*false/m.test(body) });
  });
}
tomlServers(path.join(ROOT, ".codex", "config.toml"), "codex-project");
if (HOME) {
  tomlServers(path.join(HOME, ".codex", "config.toml"), "codex-user");
  const cu = readJSON(path.join(HOME, ".cursor", "mcp.json"));
  if (cu && !cu.__unparsed) addServers(cu.mcpServers, "cursor-user", path.join(HOME, ".cursor", "mcp.json"));
  const cj = readJSON(path.join(HOME, ".claude.json"));
  if (cj && !cj.__unparsed) {
    addServers(cj.mcpServers, "user", path.join(HOME, ".claude.json"));
    // Hosted connectors this user has connected at least once (names only). At runtime their tools look like mcp__claude_ai_<Name>__*.
    for (const c of Array.isArray(cj.claudeAiMcpEverConnected) ? cj.claudeAiMcpEverConnected : []) {
      const name = String(c).replace(/^claude\.ai\s+/i, "");
      mcp.push({ name, type: "hosted connector", scope: "claude.ai", file: rel(path.join(HOME, ".claude.json")), category: category(name), disabled: false });
    }
    const norm = (p) => posix(path.resolve(p)).toLowerCase().replace(/\/+$/, "");
    for (const [p, v] of Object.entries(cj.projects || {})) {
      if (norm(p) !== norm(ROOT) || !v) continue;
      addServers(v.mcpServers, "local", path.join(HOME, ".claude.json"));
      if (Array.isArray(v.disabledMcpjsonServers)) mcpPolicy.disabled.push(...v.disabledMcpjsonServers);
      if (Array.isArray(v.enabledMcpjsonServers)) mcpPolicy.enabled.push(...v.enabledMcpjsonServers);
    }
  }
  // Plugins synced from an account (installed; whether each is on is a runtime fact).
  const synced = path.join(HOME, ".claude", "plugins", "synced");
  for (const a of ls(synced)) {
    if (!a.isDirectory()) continue;
    for (const d of ls(path.join(synced, a.name))) {
      if (!d.isDirectory() || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(d.name)) continue;
      const pname = d.name.replace(/~.*$/, "");
      if (plugins.some((x) => x.name.split("@")[0] === pname)) continue;
      plugins.push({ name: pname, enabled: null, scope: "synced" });
      const f = path.join(synced, a.name, d.name, ".mcp.json");
      const j = isFile(f) ? readJSON(f) : null;
      if (j && !j.__unparsed) addServers(j.mcpServers || j, `plugin:${pname}`, f);
    }
  }
  // Servers bundled with enabled Claude Code plugins.
  const mk = path.join(HOME, ".claude", "plugins", "marketplaces");
  for (const pl of plugins.filter((x) => x.enabled)) {
    const [pname, market] = pl.name.split("@");
    if (!market) continue;
    for (const sub of ["plugins", "external_plugins", "."]) {
      const dir = path.join(mk, market, sub, pname);
      const f = path.join(dir, ".mcp.json");
      const j = isFile(f) ? readJSON(f) : null;
      if (j && !j.__unparsed) { addServers(j.mcpServers || j, `plugin:${pname}`, f); break; }
      const pj = isFile(path.join(dir, ".claude-plugin", "plugin.json")) ? readJSON(path.join(dir, ".claude-plugin", "plugin.json")) : null;
      if (pj && pj.mcpServers && typeof pj.mcpServers === "object") { addServers(pj.mcpServers, `plugin:${pname}`, path.join(dir, ".claude-plugin", "plugin.json")); break; }
    }
  }
}
for (const s of mcp) if (mcpPolicy.disabled.includes(s.name)) s.disabled = true;
for (const s of mcp) if (permissions.mcp_servers_with_denied_tools[s.name]) s.write_tools_denied = permissions.mcp_servers_with_denied_tools[s.name];

// ---------------------------------------------------------------- 5. memory (file names only)
const memory = [];
if (HOME) {
  const pdir = path.join(HOME, ".claude", "projects");
  const slug = ROOT.replace(/[^A-Za-z0-9]/g, "-").toLowerCase();
  for (const d of ls(pdir)) {
    if (!d.isDirectory() || d.name.toLowerCase() !== slug) continue;
    const mdir = path.join(pdir, d.name, "memory");
    const idx = readText(path.join(mdir, "MEMORY.md"));
    const files = ls(mdir).filter((f) => f.isFile() && /\.md$/i.test(f.name) && f.name !== "MEMORY.md").map((f) => f.name.replace(/\.md$/i, ""));
    memory.push({ path: rel(mdir), index_entries: idx ? idx.split(/\r?\n/).filter((l) => /^\s*-\s+\S/.test(l)).length : 0, files: files.length, file_names: cap(files.sort(), LIMITS.list, "memory names capped"), feedback_files: files.filter((n) => /^feedback/i.test(n)).length });
  }
}

// ---------------------------------------------------------------- 6. walk the project tree
const P = {
  status: /^(status|state|progress)\.md$|overview[\w.\-]*\.md$/i,
  kickoff: /^(next[-_ ]?session[-_ ]?prompt|kickoff|resume[-_ ](prompt|here|card)|handoff|start[-_]here)[\w.\- ]*\.md$|next[-_]session|kickoff/i,
  decision: /decision|decide|rulings?|yours[-_ ]to|open[-_ ]questions|choices/i,
  board: /(^|[-_. ])board(s)?([-_. ]|$)|kanban/i,
  sessions: /^sessions?(\.md|[-_](log|ledger|table)\.md)$|session[-_](log|ledger|index)\.md$/i,
  ledger: /ledger|queue/i,
  goals: /^(goals?|okrs?|objectives|lanes?|roadmap|priorities|north[-_ ]star)[\w.\-]*\.md$/i,
  weekly: /^\d{4}-W\d{2}[\w.\-]*\.md$/i,
  glossary: /^(context|glossary|terms|vocabulary)\.md$/i,
  open_items: /open[-_ ]items|owed|asks|blockers|registers?/i,
  contract: /^contract\.md$/i,
};
const found = { status: [], kickoffs: [], decision_sheets: [], boards: [], sessions_tables: [], ledgers: [], goals: [], weekly: [], adr: [], glossary: [], open_items: [], exchange: [], intake: [], contracts: [] };
const projects = new Map();
const repos = [];
const typeWords = {};
const cueHits = {};
let entries = 0, dirs = 0, readmeReads = 0;
const TYPE_WORDS = ["prototype", "proto", "design", "mockup", "report", "class", "course", "capstone", "assignment", "homework", "planning", "plan", "research", "paperwork", "handoff", "site", "website", "app", "api", "mcp", "extension", "onboarding", "lab", "thesis", "client", "brief", "audit", "migration", "launch", "pilot", "hire", "package"];
const CUES = {
  student: /capstone|assignment|homework|syllabus|semester|lecture|thesis|midterm|final[-_]exam|course(work)?\b|\bclass\b|problem[-_]set|\bpset/i,
  instructor: /roster|students|grading|rubric|cohort|office[-_]hours|\bseats?\b|teaching|curriculum|lesson[-_]plan/i,
  "founder / lead / PM": /handoff|hand[-_]off|contractor|roadmap|lanes?\b|okrs?|\bprd\b|stakeholder|weekly|brief|board|product|hire|hiring|pipeline|vendor/i,
  "solo developer": /^(src|lib|tests?|__tests__|spec)$|coding[-_]standards|\btdd\b|changelog|package\.json|cargo\.toml|pyproject|contributing/i,
  researcher: /research|literature|paper|sources|findings|citations|dataset|experiment/i,
  "client work": /clients?\b|customer|engagement|proposal|invoice|retainer|\bsow\b/i,
};
// A few fields from the first block of a status file: the stage word, a date, a due date. Nothing else is kept.
const stagesSeen = {};
function statusHead(text) {
  const head = (text || "").split(/\r?\n/).slice(0, 25).join("\n");
  const pick = (re) => { const m = re.exec(head); return m ? clip(m[1].replace(/[*_`]/g, ""), 40) : null; };
  const out = {
    stage: pick(/^\s*(?:[-*>|]\s*)?\**\s*(?:stage|phase)\s*\**\s*[:|]\s*\**\s*([^\n|]+)/im),
    updated: pick(/(?:updated|last (?:activity|session|touched)|as of)\s*\**\s*[:|]?\s*\**\s*(\d{4}-\d{2}-\d{2})/i),
    due: pick(/\bdue\s*\**\s*[:|]?\s*\**\s*(\d{4}-\d{2}-\d{2})/i),
  };
  if (out.stage) stagesSeen[out.stage] = (stagesSeen[out.stage] || 0) + 1;
  return out;
}
const touchProject = (dir) => {
  const k = rel(dir);
  if (!projects.has(k)) projects.set(k, { path: k, markers: [], title: null, status_file: null, status: null, kickoffs: 0, decision_sheets: 0, newest: null });
  return projects.get(k);
};
const bump = (p, f) => { const d = mtimeDay(f); if (d && (!p.newest || d > p.newest)) p.newest = d; };
const cueSeen = new Set();
const cue = (name, p) => {
  const key = name.toLowerCase().replace(/\.[a-z0-9]+$/, "");
  if (cueSeen.has(key)) return;
  cueSeen.add(key);
  for (const [k, re] of Object.entries(CUES)) if (re.test(name)) { const c = (cueHits[k] = cueHits[k] || { hits: 0, examples: [] }); c.hits++; if (c.examples.length < 3) c.examples.push(rel(p)); }
};
function tableInfo(text) {
  const rows = (text || "").split(/\r?\n/).filter((l) => /^\s*\|.*\|\s*$/.test(l));
  const body = rows.filter((l) => !/^\s*\|[\s:|-]+\|\s*$/.test(l));
  const header = body[0] ? body[0].split("|").slice(1, -1).map((c) => clip(c, 30)) : [];
  return { rows: Math.max(0, body.length - 1), columns: header, checkboxes: { open: ((text || "").match(/☐|\[ \]/g) || []).length, done: ((text || "").match(/☑|✅|\[x\]/gi) || []).length } };
}
function gitInfo(dir) {
  let gdir = path.join(dir, ".git");
  if (isFile(gdir)) { const m = /gitdir:\s*(.+)/.exec(readText(gdir) || ""); if (!m) return; gdir = path.resolve(dir, m[1].trim()); }
  const cfg = readText(path.join(gdir, "config")) || readText(path.join(gdir, "..", "..", "config")) || "";
  const head = (readText(path.join(gdir, "HEAD")) || "").trim();
  const remotes = [];
  const re = /\[remote "([^"]+)"\]([\s\S]*?)(?=\n\[|$)/g;
  let m;
  while ((m = re.exec(cfg))) {
    const u = /url\s*=\s*(\S+)/.exec(m[2]);
    if (!u) continue;
    const gm = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(u[1]);
    remotes.push(gm ? { name: m[1], host: gm[1], owner: gm[2], repo: gm[3] } : { name: m[1], host: "local or unparsed" });
  }
  repos.push({ path: rel(dir), branch: head.startsWith("ref:") ? head.replace(/^ref:\s*refs\/heads\//, "") : "detached", remotes });
}
function walk(dir, depth) {
  if (Date.now() - t0 > LIMITS.ms) { note("time budget reached: the walk stopped early"); return; }
  if (entries > LIMITS.entries) { note("entry cap reached: the walk stopped early"); return; }
  dirs++;
  const list = ls(dir);
  entries += list.length;
  const names = new Set(list.map((d) => d.name));
  if (names.has(".git")) gitInfo(dir);
  const base = path.basename(dir);
  if (depth > 0) {
    cue(base, dir);
    if (/^(intake|inbox)$/i.test(base)) { found.intake.push(rel(dir)); touchProject(path.dirname(dir)).markers.push("intake"); }
    if (/^(adr|adrs|decisions)$/i.test(base)) found.adr.push({ path: rel(dir), files: list.filter((d) => d.isFile() && /\.md$/i.test(d.name)).length });
    if (/^(to|from)[-_]/i.test(base)) found.exchange.push(rel(dir));
    if (/^weekly$/i.test(base)) found.weekly.push({ path: rel(dir), files: list.filter((d) => d.isFile() && /\.md$/i.test(d.name)).length });
    if (/^(ledger|ledgers|queue|sessions?)$/i.test(base)) found.ledgers.push({ path: rel(dir), files: list.length });
    if (/[-_]\d{4}-\d{2}(-\d{2})?$/.test(base)) touchProject(dir).markers.push("dated folder name");
  }
  for (const d of list) {
    const p = path.join(dir, d.name);
    if (d.isFile() || (d.isSymbolicLink() && isFile(p))) {
      const n = d.name;
      if (/\.(md|json|mdc|txt|html)$/i.test(n)) cue(n, p);
      if (P.status.test(n)) {
        const pr = touchProject(dir);
        if (!pr.status_file) { const t = readText(p, 3000); pr.status_file = n; pr.title = firstHeading(t); pr.status = statusHead(t); }
        pr.markers.push("status file"); bump(pr, p);
        found.status.push(rel(p));
      } else if (/^readme\.md$/i.test(n) && depth > 0 && readmeReads < LIMITS.readme_reads) {
        readmeReads++;
        const head = (readText(p, 2500) || "").split(/\r?\n/).slice(0, 20).join("\n");
        if (/^\s*(\*\*|>|-|\|)?\s*(status|stage|state|next|last (updated|session)|updated|owner)\b\s*(\*\*)?\s*[:|]/im.test(head)) {
          const pr = touchProject(dir);
          if (!pr.status_file) { pr.status_file = n; pr.title = firstHeading(head); pr.status = statusHead(head); }
          pr.markers.push("README with a status block"); bump(pr, p);
        }
      }
      if (/\.md$/i.test(n) && P.kickoff.test(n)) { const pr = touchProject(dir); pr.kickoffs++; pr.markers.push("kickoff"); bump(pr, p); found.kickoffs.push({ path: rel(p), dated: mtimeDay(p) }); }
      if (/\.(md|json|html)$/i.test(n) && P.decision.test(n)) { const pr = depth > 0 ? touchProject(dir) : null; if (pr) { pr.decision_sheets++; pr.markers.push("decision sheet"); } found.decision_sheets.push(rel(p)); }
      if (/\.(md|json)$/i.test(n) && P.board.test(n)) {
        const info = { path: rel(p), kind: /\.json$/i.test(n) ? "json" : "markdown", dated: mtimeDay(p) };
        if (info.kind === "json") { const j = readJSON(p); if (j && !j.__unparsed) { info.top_keys = Object.keys(j).slice(0, 12); const arr = Object.values(j).find(Array.isArray); info.rows = Array.isArray(j) ? j.length : arr ? arr.length : null; } }
        else info.rows = tableInfo(readText(p, 200000)).rows;
        found.boards.push(info);
      }
      if (P.sessions.test(n)) { const t = tableInfo(readText(p, 400000)); found.sessions_tables.push({ path: rel(p), rows: t.rows, columns: t.columns, dated: mtimeDay(p) }); }
      else if (/\.md$/i.test(n) && P.ledger.test(n)) { const t = tableInfo(readText(p, 200000)); found.ledgers.push({ path: rel(p), rows: t.rows, open: t.checkboxes.open, done: t.checkboxes.done }); }
      if (P.goals.test(n)) found.goals.push(rel(p));
      if (P.weekly.test(n) && !/^weekly$/i.test(base)) found.weekly.push({ path: rel(p) });
      if (P.glossary.test(n) && depth <= 2) found.glossary.push(rel(p));
      if (/\.md$/i.test(n) && P.open_items.test(n)) found.open_items.push(rel(p));
      if (P.contract.test(n)) found.contracts.push(rel(p));
    } else if (d.isDirectory() || d.isSymbolicLink()) {
      if (d.name.startsWith(".") || SKIP_DIRS.has(d.name) || /^(\.?venv|env\d*|.*\.egg-info)$/i.test(d.name)) continue;
      if (d.isSymbolicLink()) continue; // links are followed only for skill stores
      if (depth + 1 > LIMITS.depth) { note(`depth cap (${LIMITS.depth}) reached in places`); continue; }
      walk(p, depth + 1);
    }
  }
}
walk(ROOT, 0);
if (HOME) {
  // Repos one level under common code folders in the home dir, without walking the home dir.
  for (const sub of ["", "code", "src", "dev", "projects", "repos", "git", "github", "work"]) {
    const base = path.join(HOME, sub);
    if (!isDir(base)) continue;
    for (const d of ls(base)) {
      if (!d.isDirectory() || d.name.startsWith(".")) continue;
      const p = path.join(base, d.name);
      if (!rel(p).startsWith("~")) continue; // inside the root: already walked
      if (exists(path.join(p, ".git")) && !repos.some((r) => r.path === rel(p))) { gitInfo(p); if (repos.length > LIMITS.list) { note("repo list capped"); break; } }
    }
  }
}

// ---------------------------------------------------------------- 7. gh and schedulers (no network)
function onPath(bin) {
  const exts = process.platform === "win32" ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const d of (process.env.PATH || "").split(path.delimiter)) for (const e of exts) if (d && isFile(path.join(d, bin + e.toLowerCase())) || (d && isFile(path.join(d, bin + e)))) return true;
  return false;
}
const tools = { gh: onPath("gh"), git: onPath("git"), node: process.version, claude: onPath("claude"), codex: onPath("codex"), cursor: onPath("cursor") };

let schedulers = null;
if (SCHEDULERS) {
  const want = /desk|daily|morning|weekly|close|session|claude|codex|agent/i;
  schedulers = { os: process.platform, jobs: [], error: null };
  try {
    if (process.platform === "win32") {
      const r = spawnSync("schtasks", ["/query", "/fo", "csv", "/nh"], { encoding: "utf8", timeout: 8000, windowsHide: true });
      for (const line of (r.stdout || "").split(/\r?\n/)) { const name = (line.split('","')[0] || "").replace(/^"/, ""); if (name && want.test(name) && !/\\Microsoft\\/i.test(name)) schedulers.jobs.push(name.replace(/^\\/, "")); }
    } else if (process.platform === "darwin") {
      const r = spawnSync("launchctl", ["list"], { encoding: "utf8", timeout: 8000 });
      for (const line of (r.stdout || "").split(/\n/)) { const name = line.trim().split(/\s+/).pop(); if (name && want.test(name) && !/^com\.apple\./.test(name)) schedulers.jobs.push(name); }
    } else {
      const r = spawnSync("crontab", ["-l"], { encoding: "utf8", timeout: 8000 });
      for (const line of (r.stdout || "").split(/\n/)) { if (!line.trim() || line.trim().startsWith("#") || !want.test(line)) continue; schedulers.jobs.push(`${line.trim().split(/\s+/).slice(0, 5).join(" ")} → ${scriptOf(line.trim().split(/\s+/).slice(5).join(" "))}`); }
    }
    schedulers.jobs = [...new Set(schedulers.jobs)].slice(0, LIMITS.list);
  } catch (e) { schedulers.error = e.message; }
}

// ---------------------------------------------------------------- 8. assemble
const projList = [...projects.values()].map((p) => ({ ...p, markers: [...new Set(p.markers)] }))
  .filter((p) => p.path !== "." && (p.status_file || p.kickoffs || p.markers.includes("dated folder name") || p.decision_sheets))
  .sort((a, b) => (b.newest || "").localeCompare(a.newest || "") || a.path.localeCompare(b.path));
// A folder whose parent is also a project is usually a part (a prototype, a version), not a project.
const projPaths = new Set(projList.map((p) => p.path));
for (const p of projList) { const parent = p.path.split("/").slice(0, -1).join("/"); if (parent && projPaths.has(parent)) p.part_of = parent; }
const TYPE_RES = TYPE_WORDS.map((w) => [w, new RegExp(`(^|[-_ .])${w}s?($|[-_ .])`, "i")]);
for (const p of projList) { const base = p.path.split("/").pop(); for (const [w, re] of TYPE_RES) if (re.test(base)) typeWords[w] = (typeWords[w] || 0) + 1; }

const hookEvents = {};
for (const h of hooks) hookEvents[h.event] = (hookEvents[h.event] || 0) + 1;
const lifecycle = {
  session_end_hooks: hooks.filter((h) => /^(sessionend|stop|subagentstop)$/i.test(h.event)).map((h) => ({ event: h.event, script: h.script, scope: h.scope })),
  session_start_hooks: hooks.filter((h) => /^(sessionstart|userpromptsubmit|beforesubmitprompt)$/i.test(h.event)).map((h) => ({ event: h.event, script: h.script, scope: h.scope })),
  session_gate_candidates: skills.filter((s) => /session|gate|name (the|this) chat|first message/i.test(`${s.name} ${s.description || ""}`)).map((s) => s.name)
    .concat(cursorRules.filter((r) => r.always_apply && /session|gate|chat|first message/i.test(`${r.name} ${r.description || ""}`)).map((r) => `cursor rule: ${r.name}`)),
  close_step_candidates: skills.filter((s) => /close|end of session|wrap|daily|nightly|ledger|reporter/i.test(`${s.name} ${s.description || ""}`)).map((s) => s.name),
  sessions_tables: found.sessions_tables.length,
  kickoffs: found.kickoffs.length,
  memory_files: memory.reduce((n, m) => n + m.files, 0),
};

const scan = {
  scanner: "desk/scan.js", version: VERSION, scanned_at: new Date().toISOString().slice(0, 16).replace("T", " "),
  root: ".", root_name: path.basename(ROOT), home_scanned: !!HOME, platform: process.platform,
  harness: { ...harness, workspaces, instructions, cursor_rules: cursorRules, settings_files: settingsFiles, skill_links: skillLinks },
  skills: cap(skills, LIMITS.skills, "skills capped"),
  skill_packs: cap(skillPacks, LIMITS.list, "skill packs capped"),
  agents: cap(agents, LIMITS.agents, "agents capped"),
  commands: cap(commands, LIMITS.list, "commands capped"),
  hooks, hook_events: hookEvents,
  permissions,
  plugins: cap(plugins, LIMITS.list, "plugins capped"),
  mcp_servers: mcp,
  memory,
  lifecycle,
  projects: cap(projList, LIMITS.projects, "project list capped"),
  org: {
    boards: cap(found.boards, LIMITS.list), sessions_tables: found.sessions_tables, ledgers: cap(found.ledgers, LIMITS.list),
    kickoffs: cap(found.kickoffs.sort((a, b) => (b.dated || "").localeCompare(a.dated || "")), LIMITS.list * 2, "kickoff list capped"),
    decision_sheets: { count: found.decision_sheets.length, sample: found.decision_sheets.slice(0, 15) },
    goals: cap(found.goals, LIMITS.list), weekly: cap(found.weekly, LIMITS.list), adr: found.adr, glossary: found.glossary,
    open_items: { count: found.open_items.length, sample: found.open_items.slice(0, 15) },
    exchange: cap(found.exchange, LIMITS.list), intake: cap(found.intake, LIMITS.list), contracts: cap(found.contracts, LIMITS.list),
  },
  git: { repos: cap(repos, LIMITS.list), tools },
  schedulers,
  cues: { user_type: cueHits, stages_seen: Object.fromEntries(Object.entries(stagesSeen).sort((a, b) => b[1] - a[1]).slice(0, 20)), project_type_words: Object.fromEntries(Object.entries(typeWords).sort((a, b) => b[1] - a[1])) },
  stats: { projects_total: projList.length, kickoffs_total: found.kickoffs.length, dirs_walked: dirs, entries_seen: entries, readme_reads: readmeReads, ms: Date.now() - t0, truncated },
};

// ---------------------------------------------------------------- 9. write scan.json and scan.md
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "scan.json"), JSON.stringify(scan, null, 2) + "\n");

const n = (a) => (Array.isArray(a) ? a.length : 0);
const names = (a, k = "name", max = 12) => { const xs = [...new Set(a.map((x) => x[k]))]; return xs.length ? xs.slice(0, max).join(", ") + (xs.length > max ? `, +${xs.length - max} more` : "") : "none"; };
const byCat = {};
for (const s of mcp) (byCat[s.category] = byCat[s.category] || []).push(s.name + (s.disabled ? " (disabled)" : "") + (s.write_tools_denied ? " (writes denied)" : ""));
const topCue = Object.entries(cueHits).sort((a, b) => b[1].hits - a[1].hits).map(([k, v]) => `${k} ${v.hits}`).join(" · ") || "none";
const mdOut = [
  `# Harness scan (${scan.scanned_at})`,
  "",
  `Read-only inventory by desk/scan.js v${VERSION}. Root: \`${scan.root_name}\`. User level: ${HOME ? "scanned" : "skipped"}. ${scan.stats.dirs_walked} folders in ${scan.stats.ms} ms.${truncated.length ? " Stopped short: " + truncated.join("; ") + "." : ""}`,
  "",
  "## Harness",
  `- Detected: ${harness.detected.join(", ") || "nothing recognised"}`,
  `- Instruction files: ${instructions.map((i) => `${i.path} (${i.lines} lines)`).join(", ") || "none"}`,
  `- Skills: ${n(skills)} (${names(skills)})${Object.keys(skillLinks).length ? `; linked stores: ${Object.entries(skillLinks).map(([a, b]) => `${a} → ${b}`).join(", ")}` : ""}`,
  `- Skill packs (lock file): ${n(skillPacks)}`,
  `- Agents: ${n(agents)} (${names(agents)}) · commands: ${n(commands)} · Cursor rules: ${n(cursorRules)} · plugins enabled: ${plugins.filter((p) => p.enabled).length}`,
  `- Hooks: ${Object.entries(hookEvents).map(([e, c]) => `${e} ×${c}`).join(", ") || "none"}`,
  "",
  "## Session lifecycle",
  `- End of session: ${lifecycle.session_end_hooks.map((h) => `${h.event} → ${h.script}`).join(", ") || "no hook"}`,
  `- Start of session: ${lifecycle.session_start_hooks.map((h) => `${h.event} → ${h.script}`).join(", ") || "no hook"}`,
  `- Session-gate-looking skills or rules: ${lifecycle.session_gate_candidates.join(", ") || "none"}`,
  `- Close-step-looking skills: ${lifecycle.close_step_candidates.join(", ") || "none"}`,
  `- Sessions tables: ${found.sessions_tables.map((s) => `${s.path} (${s.rows} rows)`).join(", ") || "none"}`,
  `- Kickoff / resume files: ${found.kickoffs.length} · memory files: ${lifecycle.memory_files}`,
  "",
  "## Work structure",
  `- Project folders: ${projList.length} (${projList.filter((p) => !p.part_of).length} top-level), ${projList.filter((p) => p.status_file).length} with a status file, ${projList.filter((p) => p.kickoffs).length} with a kickoff file`,
  `- Boards: ${found.boards.map((b) => b.path).join(", ") || "none"}`,
  `- Goals / lanes: ${found.goals.join(", ") || "none"} · weekly roll-ups: ${found.weekly.reduce((s, w) => s + (w.files || 1), 0)} · ADR folders: ${found.adr.length} · glossary: ${found.glossary.join(", ") || "none"}`,
  `- Decision sheets: ${found.decision_sheets.length} · open-items files: ${found.open_items.length} · ledgers/queues: ${found.ledgers.length} · exchange folders: ${found.exchange.length} · intake folders: ${found.intake.length}`,
  "",
  "## Data sources",
  `- MCP servers: ${n(mcp)}${Object.keys(byCat).length ? "" : " (none configured in files; check the tools you actually have at runtime)"}`,
  ...Object.entries(byCat).map(([c, xs]) => `  - ${c}: ${[...new Set(xs)].join(", ")}`),
  `- Permission rules: allow ${permissions.allow} · deny ${permissions.deny} · ask ${permissions.ask}`,
  `- Git repos: ${repos.length} (${[...new Set(repos.flatMap((r) => r.remotes.map((x) => x.host)))].join(", ") || "no remotes"}) · gh on PATH: ${tools.gh ? "yes" : "no"}`,
  `- Scheduled jobs: ${schedulers ? (schedulers.jobs.join(", ") || "none matching") : "not checked (pass --schedulers)"}`,
  "",
  "## Cues",
  `- User type signals: ${topCue}`,
  `- Stage words in status files: ${Object.entries(scan.cues.stages_seen).slice(0, 10).map(([k, v]) => `${k} ${v}`).join(" · ") || "none"}`,
  `- Project type words: ${Object.entries(scan.cues.project_type_words).slice(0, 10).map(([k, v]) => `${k} ${v}`).join(" · ") || "none"}`,
  "",
  "This file and scan.json stay local. The agent reads them, samples a few files, and writes SETUP-NOTES.md.",
  "",
].join("\n");
fs.writeFileSync(path.join(OUT, "scan.md"), mdOut);
console.log(`scan written: ${rel(path.join(OUT, "scan.json"))} (${scan.stats.ms} ms, ${projList.length} project folders, ${n(skills)} skills, ${n(mcp)} MCP servers, ${hooks.length} hooks)`);
