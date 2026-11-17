#!/usr/bin/env node
// The desk's scrub. Read-only, no network, no dependencies (Node 16 or newer).
// Before you share or push anything (this skill, your desk, a project folder), it looks for
// what should not leave your machine: keys and tokens, private keys, email addresses, phone
// numbers, your home path and user name, the names of people you list, and desk data that
// git would publish.
//
//   node desk/scrub.js                      scan the current folder
//   node desk/scrub.js path/to/folder       scan another folder (or one file)
//   node desk/scrub.js --names names.txt    also look for these words (one per line: people, clients, products)
//   node desk/scrub.js --json               print the findings as JSON
//   node desk/scrub.js --all                show low findings too (IP addresses, long numbers)
//
// It also reads, when present: `scrub.names` and `github.people` in desk/desk.config.json (names to look for),
// and a `.scrubignore` file in the scanned folder: one rule per line, `path-glob` or `path-glob:regex`,
// to accept a finding you have checked (e.g. `docs/example.md:jane@example\.org`).
//
// Exit code: 0 = nothing high or medium, 1 = something to look at, 2 = bad arguments.
// It prints where each finding is and a masked sample. It never prints a full secret.
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const arg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--names"].includes(args[i - 1])));
const TARGET = path.resolve(positional[0] || process.cwd());
const AS_JSON = flag("--json");
const SHOW_LOW = flag("--all");

if (!fs.existsSync(TARGET)) { console.error(`scrub: no such path: ${TARGET}`); process.exit(2); }
const ROOT = fs.statSync(TARGET).isDirectory() ? TARGET : path.dirname(TARGET);

const SKIP_DIRS = new Set([".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next", ".cache", "target", "coverage"]);
const MAX_FILE = 5 * 1024 * 1024;
const TEXT_EXT = /\.(md|mdx|txt|json|jsonl|js|mjs|cjs|ts|tsx|jsx|py|ps1|sh|bash|zsh|toml|ya?ml|ini|cfg|conf|env|html?|css|csv|tsv|xml|plist|sql|rb|go|rs|java|cs|php|mdc|lock|gitignore|gitattributes)$/i;

// ---------- what to look for
const SAFE_EMAIL_DOMAINS = /(^|\.)(example\.(com|org|net)|test|invalid|localhost|users\.noreply\.github\.com)$/i;
const PLACEHOLDER_USER = /^(you|your-?name|yourname|user(name)?|me|name|<[^>]+>|\$\w+|%\w+%|\{[^}]+\}|\.\.\.|x+)$/i;

const RULES = [
  // high: secrets
  { id: "private-key", sev: "high", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g, what: "a private key" },
  { id: "aws-key", sev: "high", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, what: "an AWS access key" },
  { id: "github-token", sev: "high", re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g, what: "a GitHub token" },
  { id: "anthropic-key", sev: "high", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, what: "an Anthropic API key" },
  { id: "openai-key", sev: "high", re: /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{32,}/g, what: "an OpenAI-style API key" },
  { id: "google-key", sev: "high", re: /\bAIza[0-9A-Za-z_-]{35}\b/g, what: "a Google API key" },
  { id: "slack-token", sev: "high", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, what: "a Slack token" },
  { id: "stripe-key", sev: "high", re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g, what: "a payment-provider secret key" },
  { id: "jwt", sev: "high", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, what: "a signed token (JWT)" },
  { id: "url-credentials", sev: "high", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"'<>]+:[^\s@/"'<>]{3,}@[^\s"'<>]+/gi, what: "a URL with a password in it" },
  { id: "assigned-secret", sev: "high",
    re: /\b(?:api[_-]?key|secret|token|passw(?:or)?d|client[_-]?secret|access[_-]?key|auth)\b["']?\s*[:=]\s*["']([^"'\s]{12,})["']/gi,
    what: "a key, token or password written into a setting",
    keep: (m) => !/^(\$\{?|<|your|xxx|changeme|example|placeholder|\*{3,}|env:|process\.env)/i.test(m[1]) },
  { id: "url-token", sev: "medium", re: /[?&](?:token|key|apikey|api_key|access_token|sig|signature|auth)=[A-Za-z0-9._~%-]{12,}/gi, what: "a token in a link" },
  // medium: personal
  { id: "email", sev: "medium", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g, what: "an email address",
    keep: (m) => !SAFE_EMAIL_DOMAINS.test(m[0].split("@")[1]) && !/\.(png|jpe?g|gif|svg|webp)$/i.test(m[0]) },
  { id: "home-path", sev: "medium", re: /(?:[A-Za-z]:[\\/]+Users[\\/]+|\/Users\/|\/home\/)([^\\/\s"'`<>:*?|]+)/g, what: "a home folder path (it shows your user name)",
    keep: (m) => !PLACEHOLDER_USER.test(m[1]) && !/^(Public|Default|Shared|runner)$/i.test(m[1]) },
  { id: "phone", sev: "medium", re: /(?<![\w.-])(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\w.-])/g, what: "what looks like a phone number" },
  // low: context
  { id: "ip-address", sev: "low", re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, what: "an IP address",
    keep: (m) => !/^(127\.|0\.0\.0\.0|255\.|1\.2\.3\.4)/.test(m[0]) },
];

// ---------- names to look for: the machine's, git's, and the user's list
function sh(cmd, a) { try { const r = spawnSync(cmd, a, { cwd: ROOT, encoding: "utf8", timeout: 5000 }); return r.status === 0 ? r.stdout.trim() : ""; } catch { return ""; } }
const names = new Map(); // lowercased -> where it came from
function addName(n, from) {
  n = String(n || "").trim();
  if (n.length < 3 || /^(root|admin|user|runner|the contributors)$/i.test(n)) return;
  if (!names.has(n.toLowerCase())) names.set(n.toLowerCase(), { name: n, from });
}
try { addName(os.userInfo().username, "your computer user name"); } catch {}
addName(os.hostname(), "your computer name");
const gitName = sh("git", ["config", "user.name"]);
const gitEmail = sh("git", ["config", "user.email"]);
addName(gitName, "git user.name");
if (gitEmail && !SAFE_EMAIL_DOMAINS.test(gitEmail.split("@")[1] || "")) addName(gitEmail, "git user.email");
const namesFile = arg("--names");
if (namesFile) {
  if (!fs.existsSync(namesFile)) { console.error(`scrub: no such names file: ${namesFile}`); process.exit(2); }
  for (const line of fs.readFileSync(namesFile, "utf8").split(/\r?\n/)) if (line.trim() && !line.startsWith("#")) addName(line, "your names list");
}
for (const cfgPath of [path.join(ROOT, "desk", "desk.config.json"), path.join(ROOT, "desk.config.json")]) {
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    for (const n of (cfg.scrub && cfg.scrub.names) || []) addName(n, "scrub.names in the config");
    const people = Object.assign({}, cfg.people || {}, (cfg.github && cfg.github.people) || {});
    for (const [k, v] of Object.entries(people)) { addName(k, "people in the config"); if (typeof v === "string") addName(v, "people in the config"); }
  } catch {}
}
const nameRules = [...names.values()].map(({ name, from }) => ({
  id: "name", sev: "medium", what: `"${name}" (${from})`,
  re: new RegExp(`(?<![A-Za-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "gi"),
}));

// ---------- the accept list
const ignores = [];
try {
  for (const line of fs.readFileSync(path.join(ROOT, ".scrubignore"), "utf8").split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const i = t.indexOf(":");
    const glob = i >= 0 ? t.slice(0, i) : t, rx = i >= 0 ? new RegExp(t.slice(i + 1), "i") : null;
    const g = new RegExp("^" + glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*").replace(/\?/g, ".") + "$");
    ignores.push({ g, rx });
  }
} catch {}
const ignored = (rel, sample) => ignores.some(({ g, rx }) => g.test(rel) && (!rx || rx.test(sample)));

// ---------- walk
const files = [];
(function walk(dir) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); }
    else if (e.isFile()) files.push(p);
  }
})(fs.statSync(TARGET).isDirectory() ? TARGET : null);
if (!fs.statSync(TARGET).isDirectory()) files.push(TARGET);

const mask = (s) => s.length <= 8 ? s[0] + "***" : s.slice(0, 4) + "…" + s.slice(-2) + ` (${s.length} chars)`;
const findings = [];
let scannedText = 0, scannedBinary = 0;
for (const f of files) {
  const rel = path.relative(ROOT, f).split(path.sep).join("/") || path.basename(f);
  let st; try { st = fs.statSync(f); } catch { continue; }
  if (st.size > MAX_FILE) { findings.push({ sev: "low", id: "skipped", file: rel, line: 0, what: `not read: over ${MAX_FILE / 1048576} MB`, sample: "" }); continue; }
  const buf = fs.readFileSync(f);
  const isText = TEXT_EXT.test(f) || /^[^.]+$/.test(path.basename(f)) || !buf.subarray(0, 8000).includes(0);
  if (isText) {
    scannedText++;
    const lines = buf.toString("utf8").split(/\r?\n/);
    lines.forEach((ln, i) => {
      if (ln.length > 20000) ln = ln.slice(0, 20000);
      for (const r of [...RULES, ...nameRules]) {
        r.re.lastIndex = 0; let m;
        while ((m = r.re.exec(ln))) {
          if (r.keep && !r.keep(m)) continue;
          const hit = m[0];
          if (ignored(rel, hit)) continue;
          findings.push({ sev: r.sev, id: r.id, file: rel, line: i + 1, what: r.what, sample: r.sev === "high" ? mask(hit) : hit.slice(0, 80) });
        }
      }
    });
  } else {
    // images, PDFs and other binaries: look only for names, emails and keys left in metadata
    scannedBinary++;
    const s = buf.toString("latin1");
    for (const r of [...RULES.filter((x) => ["email", "home-path", "private-key", "github-token", "aws-key", "anthropic-key"].includes(x.id)), ...nameRules]) {
      r.re.lastIndex = 0; let m;
      while ((m = r.re.exec(s))) {
        if (r.keep && !r.keep(m)) continue;
        if (ignored(rel, m[0])) continue;
        findings.push({ sev: r.sev, id: r.id, file: rel, line: 0, what: r.what + " (inside a binary file, often its metadata)", sample: r.sev === "high" ? mask(m[0]) : m[0].slice(0, 80) });
        break;
      }
    }
  }
}

// ---------- desk data that git would publish
const tracked = sh("git", ["ls-files"]).split(/\r?\n/).filter(Boolean);
const DATA = /(^|\/)desk\/(desk\.json|desk\.config\.json|backlog\.json|index\.html|scan\.json|scan\.md|SETUP-NOTES\.md|projects\/|answers\/)/;
for (const t of tracked) if (DATA.test(t) && !/^example\//.test(t) && !ignored(t, t))
  findings.push({ sev: "medium", id: "desk-data-in-git", file: t, line: 0, what: "desk data that git tracks, so a push publishes it (add it to .gitignore, then git rm --cached)", sample: "" });

// ---------- report
const order = { high: 0, medium: 1, low: 2 };
findings.sort((a, b) => order[a.sev] - order[b.sev] || a.file.localeCompare(b.file) || a.line - b.line);
const shown = findings.filter((f) => SHOW_LOW || f.sev !== "low");
const count = (s) => findings.filter((f) => f.sev === s).length;
const result = {
  scanned: path.relative(process.cwd(), TARGET) || ".", files_text: scannedText, files_binary: scannedBinary,
  names_checked: [...names.values()].map((n) => n.from + (n.from.startsWith("your") || n.from.startsWith("git") ? "" : `: ${n.name}`)),
  high: count("high"), medium: count("medium"), low: count("low"), findings: shown,
};
if (AS_JSON) { console.log(JSON.stringify(result, null, 2)); }
else {
  console.log(`scrub: ${scannedText} text and ${scannedBinary} binary files in ${result.scanned}`);
  console.log(`names checked: ${names.size} (${[...new Set([...names.values()].map((n) => n.from))].join(", ") || "none"})`);
  if (!shown.length) console.log("nothing found" + (count("low") ? ` (${count("low")} low; --all shows them)` : ""));
  for (const f of shown) console.log(`${f.sev.toUpperCase().padEnd(6)} ${f.file}${f.line ? ":" + f.line : ""}  ${f.what}${f.sample ? "  [" + f.sample + "]" : ""}`);
  if (shown.length) console.log(`\n${count("high")} high, ${count("medium")} medium, ${count("low")} low. Check each one; accept a checked one in .scrubignore (path-glob:regex).`);
}
process.exit(count("high") + count("medium") > 0 ? 1 : 0);
