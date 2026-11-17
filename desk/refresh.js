#!/usr/bin/env node
// The desk's morning check. No model, no judgment: it updates the mechanical facts in desk.json
// (the state of each pull request the desk names, and feature pull requests merged in the last 7 days),
// then runs render.js so every age on the page is counted from today.
// It never touches the ranked list or anything the agent wrote.
//
//   node desk/refresh.js                  data folder = the folder this script sits in
//   node desk/refresh.js --data my-desk
//   node desk/refresh.js --offline        skip GitHub, just re-render (ages move on by a day)
//
// GitHub is optional. Without the gh CLI (or without `gh auth login`), it says so in the log and still renders.
// Settings in <data>/desk.config.json, key "github": { "repos": ["owner/name"], "people": { "login": "Name" }, "feature_pattern": "^\\s*feat[(:!]" }
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const DIR = path.resolve(arg("--data") || process.env.DESK_DATA || __dirname);
const DATA = path.join(DIR, "desk.json");
const LOG = path.join(DIR, "refresh.log");
const cfgFile = path.join(DIR, "desk.config.json");
const CFG = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, "utf8")) : {};
const GHCFG = CFG.github || {};
const REPOS = Array.isArray(GHCFG.repos) ? GHCFG.repos : [];
const PEOPLE = GHCFG.people || {};
const FEATURE = new RegExp(GHCFG.feature_pattern || "^\\s*feat[(:!]", "i");
const GH = process.env.GH_PATH || "gh";

const pad = (n) => String(n).padStart(2, "0");
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const log = (m) => { const line = `${stamp(new Date())} ${m}`; console.log(line); try { fs.appendFileSync(LOG, line + "\n"); } catch (e) {} };

function gh(ghArgs) {
  const r = spawnSync(GH, ghArgs, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error(String((r.error && r.error.message) || r.stderr || "gh failed").trim().split("\n")[0]);
  return JSON.parse(r.stdout);
}
function ghReady() {
  const v = spawnSync(GH, ["--version"], { encoding: "utf8" });
  if (v.error || v.status !== 0) return "the gh CLI is not installed (or not on PATH)";
  const a = spawnSync(GH, ["auth", "status"], { encoding: "utf8" });
  if (a.status !== 0) return "gh is installed but not signed in (run: gh auth login)";
  return "";
}

if (!fs.existsSync(DATA)) { log("no desk.json yet: nothing to refresh"); process.exit(0); }
const desk = JSON.parse(fs.readFileSync(DATA, "utf8"));
desk.auto = desk.auto || {};
delete desk.auto.error;

const named = [];
for (const key of ["waiting", "check"]) for (const it of desk[key] || []) if (it.pr && it.pr.repo) named.push(it.pr);
for (const o of desk.out || []) for (const pr of o.prs || []) if (pr && pr.repo) named.push(pr);

if (args.includes("--offline")) {
  log("--offline: GitHub skipped");
} else if (!named.length && !REPOS.length) {
  log("no pull requests named and no repos configured: GitHub skipped");
} else {
  const why = ghReady();
  if (why) {
    log(`GitHub skipped: ${why}`);
  } else {
    try {
      // 1. Every pull request the desk names: its state today.
      for (const pr of named) {
        const v = gh(["pr", "view", String(pr.number), "-R", pr.repo, "--json", "state,mergedAt,updatedAt"]);
        pr.state = v.state; pr.mergedAt = v.mergedAt || null; pr.updatedAt = v.updatedAt || null;
      }
      // 2. Feature pull requests merged in the last 7 days, by person (only for the repos in the config).
      if (REPOS.length) {
        const from = new Date(Date.now() - 7 * 86400000);
        const by = {};
        let total = 0;
        for (const repo of REPOS) {
          const prs = gh(["pr", "list", "-R", repo, "--state", "merged", "--search", `merged:>=${isoDay(from)}`, "--limit", "500", "--json", "number,title,author,mergedAt,url"]);
          total += prs.length;
          for (const p of prs) {
            if (!FEATURE.test(p.title)) continue;
            const login = (p.author || {}).login;
            const who = PEOPLE[login] || login || "unknown";
            (by[who] = by[who] || []).push({ title: p.title, mergedAt: p.mergedAt, url: p.url, repo: repo.split("/")[1] });
          }
        }
        for (const k of Object.keys(by)) by[k].sort((a, b) => (a.mergedAt < b.mergedAt ? 1 : -1));
        desk.auto.features = { window: `since ${isoDay(from)}`, merged_total: total, by_author: by };
        log(`${total} merged in 7 days across ${REPOS.length} repo(s), ${Object.values(by).reduce((n, a) => n + a.length, 0)} titled as features`);
      }
      desk.auto.refreshed_at = stamp(new Date());
      log(`checked ${named.length} named pull request(s)`);
    } catch (e) {
      desk.auto.error = `${stamp(new Date())}: ${e.message}`;
      log(`GitHub check failed: ${e.message}`);
    }
  }
}

fs.writeFileSync(DATA, JSON.stringify(desk, null, 2) + "\n");
const r = spawnSync(process.execPath, [path.join(__dirname, "render.js"), "--data", DIR], { encoding: "utf8" });
log(r.status === 0 ? (r.stdout || "").trim() : `render failed: ${(r.stderr || r.stdout || "").trim()}`);
process.exit(r.status === 0 ? 0 : 1);
