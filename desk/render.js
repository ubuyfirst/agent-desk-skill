#!/usr/bin/env node
// The desk: renders index.html from desk.json, projects/*.json and backlog.json in one data folder.
// Contract: skill/CONTRACT.md. No dependencies; Node 16 or newer.
//
//   node desk/render.js                  data folder = the folder this script sits in
//   node desk/render.js --data example   data folder = ./example
//   DESK_DATA=some/dir node desk/render.js
//   --today YYYY-MM-DD                   pretend it is that day (demos and tests)
//
// Labels, stages and areas come from <data>/desk.config.json; everything has a default.
"use strict";
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------- inputs
const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const DIR = path.resolve(arg("--data") || process.env.DESK_DATA || __dirname);
const readJSON = (f, fallback) => { if (!fs.existsSync(f)) return fallback; try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { console.error(`could not parse ${f}: ${e.message}`); process.exit(1); } };
const readDir = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".json")).sort().map((f) => readJSON(path.join(d, f))) : []);

const DEFAULTS = {
  title: "The desk",
  owner: "you",
  command: "/desk",
  stages: ["Intake", "Prototype", "Review", "Hand off", "Build", "Done"],
  stage_short: {},
  closeout_stage: "Hand off",
  areas: [],
  max_active: 3,
  date_style: "m/d",
  tracker_label: "Task",
  labels: {
    area: "Area", subarea: "Topic",
    today: "Today", week: "This week's two", lastweek: "Last week's two", active: "Active with you",
    close: "Close out and hand off", waiting: "Waiting on you", out: "Out of your hands",
    new: "New work you didn't ask for", backlog: "Backlog", park: "Nothing moving: park these?", check: "Check this",
  },
};
const userCfg = readJSON(path.join(DIR, "desk.config.json"), {});
const CFG = Object.assign({}, DEFAULTS, userCfg, { labels: Object.assign({}, DEFAULTS.labels, userCfg.labels || {}) });
const L = CFG.labels;
const OUT = path.resolve(DIR, CFG.page || "index.html");

const DATA = path.join(DIR, "desk.json");
if (!fs.existsSync(DATA)) { console.error(`no desk.json in ${DIR}: run ${CFG.command} in a chat first, or copy the example`); process.exit(1); }
const desk = readJSON(DATA, {});
const projects = readDir(path.join(DIR, "projects"));
const backlog = readJSON(path.join(DIR, "backlog.json"), []);

const STAGES = Array.isArray(CFG.stages) && CFG.stages.length ? CFG.stages : DEFAULTS.stages;
const STAGE_SHORT = CFG.stage_short || {};
const PRI = ["urgent", "high", "normal", "low"];
const OWNER = String(CFG.owner || "you");

// ---------------------------------------------------------------- helpers
const pad = (n) => String(n).padStart(2, "0");
const forced = arg("--today") || CFG.today || null;
const now = forced ? (() => { const [y, m, d] = String(forced).split("-").map(Number); return new Date(y, m - 1, d, 9, 0); })() : new Date();
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const day = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const daysSince = (iso) => (iso ? Math.round((today0 - day(iso)) / 86400000) : null);
const md = (iso) => {
  if (!iso) return "";
  const d = day(iso);
  if (CFG.date_style === "iso") return String(iso).slice(0, 10);
  if (CFG.date_style === "d/m") return `${d.getDate()}/${d.getMonth() + 1}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
};
const list = (a) => (Array.isArray(a) ? a : []);
const ageN = (iso) => { const n = daysSince(iso); return n == null ? null : Math.max(0, n); };
const ageChip = (iso, label) => { const n = ageN(iso); if (n == null) return ""; return `<span class="age ${n >= 14 ? "old" : n >= 7 ? "mid" : ""}" title="${esc(label || "waiting")} since ${md(iso)}">${n} d</span>`; };
const dueChip = (iso) => { if (!iso) return ""; const n = -daysSince(iso); return `<span class="due ${n <= 3 ? "soon" : ""}">due ${md(iso)}${n >= 0 ? ` · ${n === 0 ? "today" : n + " d"}` : ` · ${-n} d late`}</span>`; };
const prChip = (pr) => (pr && pr.state ? ` <span class="chip ${pr.state === "MERGED" ? "ok" : ""}" title="${esc(pr.repo || "")}">#${esc(pr.number)} ${esc(String(pr.state).toLowerCase())}${pr.mergedAt ? " " + md(pr.mergedAt) : ""}</span>` : "");

const bySlug = {}; for (const p of projects) bySlug[p.slug] = p;
const areasOf = (p) => String(p.area || "Other").split(" · ");
const primaryArea = (p) => areasOf(p)[0];
const proj = (slug) => bySlug[slug];
const pri = (p) => (p && PRI.includes(p.priority) ? p.priority : "normal");
const flag = (p, slug) => `<button class="flag ${p}" ${slug ? `data-flag="${esc(slug)}"` : "disabled"} title="Priority: ${p}${slug ? ". Click to change" : ""}"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 1.5v13M3 2.5h8.5l-2 3 2 3H3" fill="currentColor" fill-opacity=".85" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/></svg></button>`;
const plink = (slug, text) => (proj(slug) ? `<a class="plink" href="#p-${esc(slug)}">${esc(text || proj(slug).name)}</a>` : esc(text || ""));
const firstReview = (p) => (p && list(p.review).length ? p.review[0] : null);
const openLink = (p) => { const r = firstReview(p); return r && r.href ? ` <a class="chip link" href="${esc(r.href)}" target="_blank" rel="noopener" title="${esc(r.note || "Open what you have to review")}">open ${esc(r.label)}</a>` : ""; };
const attrs = (p) => (p ? ` data-areas="${esc(areasOf(p).join("|"))}" data-sub="${esc(p.subarea || "")}"` : ` data-areas="" data-sub=""`);
const subOf = (p) => (p.subarea && p.subarea !== p.area ? p.subarea : "");
const crumb = (p) => `<span class="crumb">${esc(p.area || "")}${subOf(p) ? " › " + esc(subOf(p)) : ""}</span>`;

function track(stage, small) {
  const i = STAGES.indexOf(stage);
  return `<div class="track${small ? " small" : ""}" style="grid-template-columns: repeat(${STAGES.length}, 1fr)" title="Stage: ${esc(stage || "not set")}">${STAGES.map((s, k) => `<span class="${k < i ? "past" : k === i ? "now" : ""}">${small ? "" : esc(STAGE_SHORT[s] || s)}</span>`).join("")}</div>${small ? `<span class="stagename">${esc(stage || "no stage")}</span>` : ""}`;
}
const capped = (rows, n, what) => rows.length <= n ? rows.join("") : rows.slice(0, n).join("") + `<div class="more" hidden>${rows.slice(n).join("")}</div><button class="showmore" data-more="Show all ${rows.length} ${esc(what)}" data-less="Show fewer">Show all ${rows.length} ${esc(what)}</button>`;
const mod = (id, span, title, count, body, note) => `<section class="mod s${span}" id="m-${id}"><h2>${esc(title)}${count != null ? ` <span class="n">${count}</span>` : ""}</h2>${note ? `<p class="meta">${esc(note)}</p>` : ""}${body}</section>`;
const empty = (t) => `<p class="empty">${esc(t)}</p>`;

// ---------------------------------------------------------------- the dashboard
const todayBody = list(desk.today).length ? `<ul class="rows">${list(desk.today).map((t) => `<li><span class="when">${esc(t.when)}</span><span><b>${esc(t.what)}</b><span class="muted"> ${esc(t.who)}</span></span></li>`).join("")}</ul>` : empty("Nothing dated in the next five days.");

// The week band. One status scale for both panels, so a mark means the same thing on each side.
const SCALE = ["not started", "started", "partly", "done, to hand off", "handed off", "completed"];
const MARKS = ["○", "◔", "◑", "◕", "➜", "✓"];
const statusIdx = (w) => { const i = SCALE.indexOf(String((w && w.status) || "").toLowerCase()); return i < 0 ? 0 : i; };
const mark = (w) => { const i = statusIdx(w); return `<span class="wk k${i}" title="Status: ${esc(SCALE[i])}">${MARKS[i]} ${esc(SCALE[i])}</span>`; };
const legend = `<p class="wklegend">${SCALE.map((s, i) => `<span class="wk k${i}">${MARKS[i]} ${esc(s)}</span>`).join(" ")}</p>`;

// Where we are in the week: from week_start (YYYY-MM-DD), or the first date found in week_two_week.
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function weekStart() {
  if (desk.week_start) return day(desk.week_start);
  const label = String(desk.week_two_week || "");
  const iso = label.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return day(iso[0]);
  const m = label.match(/(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const [mo, dd] = CFG.date_style === "d/m" ? [m[2], m[1]] : [m[1], m[2]];
  const cands = [-1, 0, 1].map((dy) => new Date(today0.getFullYear() + dy, Number(mo) - 1, Number(dd)));
  return cands.sort((a, b) => Math.abs(a - today0) - Math.abs(b - today0))[0];
}
function weekPlace() {
  const start = weekStart();
  if (!start) return "";
  const n = Math.round((today0 - start) / 86400000);
  if (n < 0) return `starts in ${-n} d`;
  if (n > 6) return "week over";
  if (n > 4) return "weekend";
  return `${DAYS[today0.getDay()]} · day ${n + 1} of 5`;
}
const place = weekPlace();
const weekHead = [desk.week_two_week, place].filter(Boolean).map(esc).join(" · ") || null;

const weekBody = list(desk.week_two).length ? `<div class="pair">${list(desk.week_two).map((w) => { const p = proj(w.slug); return `<div class="tile"${attrs(p)}><div class="lhead"><span>${p ? flag(pri(p), p.slug) : ""}<b>${plink(w.slug, w.project)}</b></span>${mark(w)}</div>${p ? `<div>${crumb(p)}</div>` : ""}${w.status_note ? `<p class="snote">${esc(w.status_note)}</p>` : ""}<p>${esc(w.why || "")}</p>${p && p.milestone && p.milestone.what ? `<p class="ms"><b>Milestone:</b> ${esc(p.milestone.what)} ${dueChip(p.milestone.due)} <span class="on">on ${esc(p.milestone.on || "?")}</span></p>` : ""}${p ? track(p.stage, true) : ""}${p ? `<div>${openLink(p)}</div>` : ""}</div>`; }).join("")}</div>` : empty("Not set. Ask the agent to propose this week's two.");

// Last week's two: what they were, where they ended on the same scale, what got worked on, what is left.
const lastWeek = desk.week_two_last || {};
const lastItems = list(lastWeek.items);
const lastBody = lastItems.length ? `<div class="pair">${lastItems.map((w) => { const p = proj(w.slug); const line = (k, v) => (v ? `<p class="clamp" title="${esc(v)}"><b>${k}</b> ${esc(v)}</p>` : ""); return `<div class="tile last"${attrs(p)}><div class="lhead"><b>${plink(w.slug, w.project)}</b>${mark(w)}</div>${line("Meant to:", w.was)}${line("Worked on:", w.worked)}${line("Left:", w.left)}<button class="unclamp" hidden>more</button></div>`; }).join("")}</div>` : empty("No week on record yet.");
const lastCounts = SCALE.map((s, i) => [s, lastItems.filter((w) => statusIdx(w) === i).length]).filter(([, n]) => n).map(([s, n]) => `${n} ${s}`).join(" · ");
const lastNote = lastItems.length ? [lastWeek.set ? `Set ${md(lastWeek.set)}.` : "", lastCounts ? `${lastCounts}.` : ""].filter(Boolean).join(" ") : "";

const band = `<div class="grid band">${mod("week", 6, L.week, weekHead, weekBody, desk.week_note)}${mod("lastweek", 6, L.lastweek, lastItems.length && lastWeek.week ? lastWeek.week : null, lastBody, lastNote)}${legend}</div>`;

const activeRows = list(desk.active);
const overCap = activeRows.length > Number(CFG.max_active || 3);
const activeBody = activeRows.length ? `${overCap ? `<p class="banner">More than ${esc(CFG.max_active)} active. Pick one to park or hand off.</p>` : ""}<div class="stack">${activeRows.map((a) => { const p = proj(a.slug); return `<div class="line"${attrs(p)}>${p ? flag(pri(p), p.slug) : ""}<div><b>${plink(a.slug, a.project)}</b> ${p ? crumb(p) : ""}<div class="muted">${esc(a.next || "")}</div>${p ? track(p.stage, true) : ""}</div></div>`; }).join("")}</div>` : empty("Nothing active.");

// Close out and hand off: every finishing item across the projects, grouped by project; projects in that stage first.
const CLOSE = CFG.closeout_stage;
const closeItem = (p, c, i) => `<div class="item"><div><span class="kind">${esc(c.kind || "send")}</span> ${esc(c.what)}${c.to ? ` <span class="muted">to ${esc(c.to)}</span>` : ""} ${ageChip(c.since, "ready")}${c.file ? `<div class="mono muted">${c.href ? `<a href="${esc(c.href)}" target="_blank" rel="noopener">${esc(c.file)}</a>` : esc(c.file)}</div>` : ""}</div><div class="act"><label><input type="checkbox" data-id="${esc(p.slug)}.x${i + 1}" data-say="show me, then do it"> do it</label><label><input type="checkbox" data-id="${esc(p.slug)}.x${i + 1}" data-say="drop it"> drop</label></div></div>`;
const closeGroups = projects.filter((p) => list(p.closeout).length).sort((a, b) => (b.stage === CLOSE) - (a.stage === CLOSE) || PRI.indexOf(pri(a)) - PRI.indexOf(pri(b)));
const closeCount = closeGroups.reduce((n, p) => n + p.closeout.length, 0);
const closeRows = closeGroups.map((p) => `<div class="group"${attrs(p)}><div class="ghead">${flag(pri(p), p.slug)}<b>${plink(p.slug)}</b> ${crumb(p)} <span class="chip ${p.stage === CLOSE ? "hot" : "quiet"}">${esc(p.stage || "")}</span></div>${p.closeout.map((c, i) => closeItem(p, c, i)).join("")}</div>`);
const closeBody = closeRows.length ? capped(closeRows, 5, "projects") : empty("Nothing is one step from done.");

// Waiting on you: the agent's ranked rows, grouped by project in rank order.
const wGroups = []; const wIndex = {};
list(desk.waiting).forEach((w, i) => { const key = w.slug || w.project || w.id; if (!(key in wIndex)) { wIndex[key] = wGroups.length; wGroups.push({ key, slug: w.slug, name: w.project, rows: [] }); } wGroups[wIndex[key]].rows.push(Object.assign({ rank: i + 1 }, w)); });
const waitRows = wGroups.map((g) => { const p = proj(g.slug); return `<div class="group"${attrs(p)}><div class="ghead">${p ? flag(pri(p), p.slug) : ""}<b>${plink(g.slug, g.name)}</b> ${p ? crumb(p) : ""} ${p ? `<span class="chip quiet">${esc(p.stage || "")}</span>` : ""}${openLink(p)}</div>${g.rows.map((w) => `<div class="item"><div><span class="rank">${w.rank}</span> <b>${esc(w.what)}</b>${prChip(w.pr)}<div class="muted">Waiting: ${esc(w.who)} ${ageChip(w.since)}</div><div class="dflt"><span class="muted">If you say nothing:</span> ${esc(w.default || "nothing is on record")}</div></div><div class="act">${w.default_ok === false ? "" : `<label title="Rule it the way the line on the left says"><input type="checkbox" data-id="${esc(w.id)}" data-say="go with what is on record"> go with that</label>`}<input type="text" data-id="${esc(w.id)}" placeholder="your answer"></div></div>`).join("")}</div>`; });
const waitBody = waitRows.length ? capped(waitRows, 5, "projects") : empty("Nothing waits on you.");

const checkBody = list(desk.check).map((c) => `<div class="note"><b>${esc(c.title)}</b>${prChip(c.pr)}<p>${esc(c.text)}</p><input type="text" data-id="${esc(c.id)}" placeholder="what to do with it"></div>`).join("") || empty("No record disagrees with another.");

const outRows = list(desk.out).map((o) => { const p = proj(o.slug); return `<div class="line"${attrs(p)}><div><b>${plink(o.slug, o.project)}</b> ${p ? crumb(p) : ""}${list(o.prs).map(prChip).join("")}<div class="muted">${esc(o.who)} · ${esc(o.last)}</div></div></div>`; });
const outBody = outRows.length ? capped(outRows, 6, "projects") : empty("Nothing is with anyone else.");

const nw = desk.new_work || {}; const auto = desk.auto || {}; const feats = auto.features || {};
const nwRows = list(nw.items).map((n) => `<div class="item"><div><b>${esc(n.who)}</b> ${esc(n.what)}</div><div class="act"><select data-id="${esc(n.id)}"><option value="">no look</option><option>take a look</option><option>review session</option></select></div></div>`);
const autoBody = feats.by_author && Object.keys(feats.by_author).length ? `<details class="raw"><summary>Every feature pull request merged ${esc(feats.window || "")}: ${Object.entries(feats.by_author).map(([k, v]) => `${esc(k)} ${v.length}`).join(" · ")}</summary>${Object.entries(feats.by_author).map(([k, v]) => `<h4>${esc(k)}</h4><ul>${v.map((x) => `<li><span class="muted">${md(x.mergedAt)}</span> <a href="${esc(x.url)}">${esc(x.title)}</a></li>`).join("")}</ul>`).join("")}</details>` : "";
const nwBody = (nwRows.length ? capped(nwRows, 4, "items") : empty("Nothing new this week.")) + autoBody;

const parkRows = list(desk.park).map((k) => { const p = proj(k.slug); return `<div class="item"${attrs(p)}><div><b>${plink(k.slug, k.project)}</b> ${p ? crumb(p) : ""}<div class="muted">${esc(k.waiting)} ${ageChip(k.since)}</div></div><div class="act"><label><input type="checkbox" data-id="${esc(k.id)}" data-say="park it"> park</label><label><input type="checkbox" data-id="${esc(k.id)}" data-say="keep it active"> keep</label></div></div>`; });
const parkBody = parkRows.length ? capped(parkRows, 4, "projects") : empty("Nothing is stalled.");

const backlogBody = `<textarea id="dump" rows="3" placeholder="Dump anything here: an idea, a task, a thing to look at. It goes out with Copy my answers."></textarea><button id="dumpadd">Add to the backlog</button><ul class="rows" id="dumplist"></ul>${list(backlog).length ? `<h4>Filed</h4><div class="filed">${capped(list(backlog).map((b) => `<div class="frow"><span class="when">${md(b.added)}</span><span>${esc(b.text)}${b.status ? ` <span class="chip quiet">${esc(b.status)}</span>` : ""}</span></div>`), 5, "items")}</div>` : ""}`;

const home = [
  mod("today", 6, L.today, null, todayBody),
  mod("active", 6, L.active, `${activeRows.length} of ${CFG.max_active}`, activeBody, desk.active_note),
  mod("close", 6, L.close, closeCount, closeBody, "One step from off your plate: no new decision needed. A tick asks the agent to show you the text, then do it on your word."),
  mod("waiting", 6, L.waiting, list(desk.waiting).length, waitBody, "By project. Ranked: someone is blocked now, then a date this week, then age."),
  mod("out", 4, L.out, list(desk.out).length, outBody),
  mod("new", 4, L.new, list(nw.items).length, nwBody, nw.window ? `Told, not held. ${nw.window}.` : "Told, not held."),
  mod("backlog", 4, L.backlog, null, backlogBody),
  mod("park", 6, L.park, list(desk.park).length, parkBody, "A parked project keeps its open items and its way back in."),
  mod("check", 6, L.check, list(desk.check).length, checkBody, "Two records that disagree. Say which one is right."),
].join("\n");

// ---------------------------------------------------------------- one page per project
function projectPage(p) {
  const li = (a) => list(a).map((x) => `<li>${esc(x)}</li>`).join("");
  const m = p.milestone || {};
  const r = p.resume || {};
  const calls = list(p.calls).map((c, i) => `<div class="call"><div class="lead">${esc(c.lead || (p.area || "") + " · " + p.name)}</div><div class="q"><span class="rank">${i + 1}</span> ${esc(c.call)} ${ageChip(c.since, "open")}</div>${c.doc ? `<div><a class="chip link" href="${esc(c.doc)}" target="_blank" rel="noopener">read the decision doc</a></div>` : ""}<div class="dflt"><span class="muted">If you say nothing:</span> ${esc(c.default || "nothing is on record")}</div><div class="act">${c.default ? `<label title="Rule it the way the line above says"><input type="checkbox" data-id="${esc(p.slug)}.c${i + 1}" data-say="go with what is on record"> go with that</label>` : ""}<input type="text" data-id="${esc(p.slug)}.c${i + 1}" placeholder="your answer"></div></div>`);
  const close = list(p.closeout).map((c, i) => closeItem(p, c, i));
  const parts = list(p.parts).map((x) => `<div class="part"><b>${esc(x.name)}</b> <span class="on">on ${esc(x.on || "?")}</span>${track(x.stage, true)}<div class="muted">${esc(x.note || "")}</div></div>`).join("");
  const asking = list(p.asking).map((a) => `<li><b>${esc(a.who)}</b> ${esc(a.what)} ${ageChip(a.since)}</li>`).join("");
  const rv = list(p.review);
  const lk = p.links || {};
  const opens = list(r.open).map((o) => `<a class="btn" href="${esc(o.href)}" target="_blank" rel="noopener">${esc(o.label)}</a>`).join(" ");
  const review = rv.length ? `<div class="review"><h4>Review now <span class="n">${rv.length}</span></h4>${capped(rv.map((x) => `<div class="rv"><div><span class="kind">${esc(x.kind || "file")}</span> <b>${esc(x.label)}</b>${x.version ? ` <span class="chip quiet">${esc(x.version)}</span>` : ""}${x.dated ? ` <span class="muted">${md(x.dated)}</span>` : ""}<div class="muted">${esc(x.note || "")}</div></div>${x.href ? `<a class="btn" href="${esc(x.href)}" target="_blank" rel="noopener">Open</a>` : ""}</div>`), 3, "things to review")}</div>` : "";
  const other = list(lk.other).map((o) => (o && o.href ? `<a class="chip link" href="${esc(o.href)}" target="_blank" rel="noopener">${esc(o.label || o.href)}</a>` : ""));
  const refs = [lk.next_doc && lk.next_doc.href ? `<a class="chip link" href="${esc(lk.next_doc.href)}" target="_blank" rel="noopener">${esc(lk.next_doc.label || "the next document")}</a>` : "", lk.repo ? `<a class="chip link" href="${esc(lk.repo)}" target="_blank" rel="noopener">${esc(String(lk.repo).replace("https://github.com/", ""))}${lk.branch ? " · " + esc(lk.branch) : ""}</a>` : ""].concat(other).filter(Boolean).join(" ");
  const task = p.task && p.task.id ? (p.task.url ? `<a href="${esc(p.task.url)}" target="_blank" rel="noopener">${esc(CFG.tracker_label)} ${esc(p.task.id)}</a>` : `${esc(CFG.tracker_label)} ${esc(p.task.id)}`) : "";
  return `<article class="proj" id="p-${esc(p.slug)}" hidden>
  <div class="phead">
    <div><a class="back" href="#">← ${esc(CFG.title)}</a><div class="crumbs">${esc(p.area || "")}${subOf(p) ? " › " + esc(subOf(p)) : ""}${p.initiative ? " › " + esc(p.initiative) : ""}</div>
      <h1>${flag(pri(p), p.slug)} ${esc(p.name)} <span class="chip quiet">${esc(p.state || "")}</span></h1></div>
    <div class="resume">${r.kickoff ? `<button class="primary copy" data-copy="${esc(r.kickoff)}">Resume in a new chat</button><div class="muted">Copies the first message. Paste it into a new chat.${r.minutes ? ` About ${esc(r.minutes)} minutes.` : ""}</div>` : ""}${opens ? `<div class="opens">${opens}</div>` : ""}</div>
  </div>
  <div class="ptrack">${track(p.stage)}<label class="fix">Wrong stage? <select data-id="${esc(p.slug)}.stage"><option value="">it is right</option>${STAGES.map((s) => `<option>${esc(s)}</option>`).join("")}</select></label></div>
  ${review}${refs ? `<p class="refs"><span class="muted">Links:</span> ${refs}</p>` : ""}
  <div class="dash">
    <div class="tile"><h4>Scope</h4><p>${esc(p.scope || "Not written yet.")}</p></div>
    <div class="tile"><h4>Goal</h4><p>${esc(p.goal || "Not written yet.")}</p></div>
    <div class="tile ms ${m.on === OWNER ? "you" : ""}"><h4>Current milestone</h4><p><b>${esc(m.what || "None set.")}</b></p><p>${dueChip(m.due)} <span class="on">on ${esc(m.on || "?")}</span></p><p class="muted">${esc(m.note || "")}</p></div>
    <div class="tile"><h4>Age</h4><p><b>${p.opened ? ageN(p.opened) + " d" : "?"}</b> since it opened${p.opened ? " " + md(p.opened) : ""}</p><p><b>${p.last_activity ? ageN(p.last_activity) + " d" : "?"}</b> since anything moved</p><p class="muted">${esc(list(p.people).join(" · "))}</p></div>
  </div>
  ${parts ? `<h3>Parts</h3><div class="parts">${parts}</div>` : ""}
  <div class="cols">
    <div><h3>Where it stands</h3><ul>${li(p.stands)}</ul><h3>Who has it</h3><p>${esc(p.who_has || "")}</p>${asking ? `<h3>What people are asking</h3><ul>${asking}</ul>` : ""}${list(p.changed).length ? `<h3>Changed since you last looked</h3><ul>${li(p.changed)}</ul>` : ""}${list(p.pending).length ? `<h3>Flagged earlier, still pending</h3><ul>${li(p.pending)}</ul>` : ""}</div>
    <div><h3>Your decisions, in order <span class="n">${calls.length}</span></h3>${calls.length ? capped(calls, 4, "decisions") : empty("Nothing needs a decision from you.")}
      <h3>Close out <span class="n">${close.length}</span></h3>${close.length ? close.join("") : empty("Nothing drafted is waiting.")}
      ${list(r.steps).length ? `<h3>The cleanest path back in</h3><ol>${li(r.steps)}</ol>` : ""}</div>
  </div>
  <p class="mono muted">${[esc(p.folder || ""), task, esc(p.stage_evidence || "")].filter(Boolean).join(" · ")}</p>
</article>`;
}

// ---------------------------------------------------------------- the left rail
const AREAS = list(CFG.areas);
const areas = AREAS.filter((a) => projects.some((p) => primaryArea(p) === a)).concat([...new Set(projects.map(primaryArea))].filter((a) => !AREAS.includes(a)));
const subs = [...new Set(projects.map((p) => p.subarea).filter(Boolean))].sort();
const railTree = areas.map((a) => { const ps = projects.filter((p) => primaryArea(p) === a).sort((x, y) => PRI.indexOf(pri(x)) - PRI.indexOf(pri(y)) || String(x.name).localeCompare(y.name)); return `<details class="folder" open data-area="${esc(a)}"><summary>${esc(a)} <span class="n">${ps.length}</span></summary>${ps.map((p) => `<a class="leaf" href="#p-${esc(p.slug)}"${attrs(p)} data-slug="${esc(p.slug)}" title="${esc(p.stage || "")} · ${esc(p.state || "")}">${flag(pri(p))}<span class="lname">${esc(p.name)}</span><span class="dot st${STAGES.indexOf(p.stage)}" title="${esc(p.stage || "")}"></span></a>`).join("")}</details>`; }).join("");
const rail = `<aside id="rail"><a class="brand" href="#">${esc(CFG.title)}</a>
  <input type="search" id="find" placeholder="Find a project">
  <div class="filter"><h4>${esc(L.area)}</h4><div class="chips" id="f-area"><button class="on" data-v="">All</button>${areas.map((a) => `<button data-v="${esc(a)}">${esc(a)}</button>`).join("")}</div>
  ${subs.length ? `<h4>${esc(L.subarea)}</h4><div class="chips" id="f-sub"><button class="on" data-v="">All</button>${subs.map((m) => `<button data-v="${esc(m)}">${esc(m)}</button>`).join("")}</div>` : ""}</div>
  <h4>Projects <span class="n">${projects.length}</span></h4>${railTree || empty("No projects yet.")}
  <div class="legend"><h4>Stage</h4>${STAGES.map((s, i) => `<span><i class="dot st${i}"></i>${esc(s)}</span>`).join("")}</div></aside>`;

// One colour per stage, whatever the ladder's length.
const PALETTE = ["#9a948a", "#8e6bd1", "#d33b2f", "#e08a00", "#3d78d8", "#c2549b", "#2e9e6b", "#5b6b5d", "#1f8a9e", "#a0522d"];
const stageCss = STAGES.map((s, i) => `.st${i} { background: ${PALETTE[i % PALETTE.length]}; }`).join(" ");

const readAge = desk.read_at ? Math.max(0, daysSince(desk.read_at)) : null;
const stale = readAge != null && readAge >= 1;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(CFG.title)}</title>
<style>
  :root { color-scheme: light dark; --ink: #1c1915; --muted: #645d52; --line: #e2dacd; --paper: #f7f3ec; --card: #fff; --chip: #efe8dc; --ok: #dfeeda; --accent: #8a3d12; --warn: #fbefd9; --old: #b3261e; --mid: #9a6700;
    --urgent: #d33b2f; --high: #e08a00; --normal: #3d78d8; --low: #9a948a; --you: #fff4e6; }
  @media (prefers-color-scheme: dark) { :root { --ink: #f3efe6; --muted: #b7ad9e; --line: #3a342c; --paper: #171512; --card: #23201a; --chip: #3a342c; --ok: #24361f; --accent: #e7a27a; --warn: #3a2f1a; --old: #ff8a80; --mid: #f0c05a; --urgent: #ff6b5e; --high: #ffb238; --normal: #7aa7f2; --low: #8d877d; --you: #33281a; } }
  * { box-sizing: border-box; }
  html { font-size: 16px; } @media (min-width: 1900px) { html { font-size: 17.5px; } } @media (min-width: 2400px) { html { font-size: 19px; } }
  body { margin: 0; font: 1rem/1.45 "Segoe UI", system-ui, -apple-system, sans-serif; color: var(--ink); background: var(--paper); }
  #app { display: grid; grid-template-columns: 19rem minmax(0, 1fr); min-height: 100vh; }
  #rail { border-right: 1px solid var(--line); padding: 1.1rem 1rem 6rem; position: sticky; top: 0; height: 100vh; overflow-y: auto; background: var(--card); }
  .brand { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; color: var(--ink); text-decoration: none; display: block; margin-bottom: .7rem; }
  #main { padding: 1.2rem 1.6rem 7rem; min-width: 0; }
  h1 { font-size: 1.75rem; font-weight: 680; margin: .2rem 0; letter-spacing: -0.02em; }
  h2 { font-size: 1.2rem; margin: 0 0 .35rem; } h3 { font-size: 1.02rem; margin: 1.2rem 0 .4rem; }
  h4 { font-size: .72rem; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); margin: 1rem 0 .35rem; font-weight: 650; }
  p { margin: .3rem 0; } ul, ol { margin: .2rem 0; padding-left: 1.2rem; } li { margin: .2rem 0; }
  a { color: var(--accent); }
  .meta, .muted { color: var(--muted); font-size: .86rem; } .meta { margin: 0 0 .5rem; } .n { color: var(--muted); font-weight: 400; font-size: .8em; }
  .mono { font-family: Consolas, ui-monospace, monospace; font-size: .74rem; word-break: break-all; }
  .banner { background: var(--warn); border: 1px solid var(--line); border-radius: .6rem; padding: .5rem .8rem; margin: .4rem 0 .8rem; }
  .grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 1rem; align-items: start; }
  .mod { background: var(--card); border: 1px solid var(--line); border-radius: .9rem; padding: .9rem 1rem 1rem; min-width: 0; }
  .s3 { grid-column: span 3; } .s4 { grid-column: span 4; } .s5 { grid-column: span 5; } .s6 { grid-column: span 6; }
  @media (max-width: 1500px) { .s3, .s4, .s5 { grid-column: span 6; } } @media (max-width: 1000px) { #app { grid-template-columns: 1fr; } #rail { position: static; height: auto; padding-bottom: 1rem; } .mod { grid-column: span 12; } }
  ul.rows { list-style: none; padding: 0; } ul.rows li, .frow { display: flex; gap: .7rem; padding: .35rem 0; border-bottom: 1px solid var(--line); } ul.rows li:last-child { border: 0; }
  .when { color: var(--muted); min-width: 6.2rem; font-size: .88rem; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: .7rem; } .tile { border: 1px solid var(--line); border-radius: .7rem; padding: .7rem .8rem; background: var(--paper); min-width: 0; }
  .tile.you, .ms.you { background: var(--you); }
  .grid.band { align-items: stretch; margin-bottom: 1rem; } @media (max-width: 1250px) { .band > .mod { grid-column: span 12; } }
  .lhead { display: flex; justify-content: space-between; gap: .5rem; align-items: baseline; margin-bottom: .15rem; }
  .wk { flex: none; border-radius: 999px; padding: .05rem .55rem; font-size: .76rem; font-weight: 650; white-space: nowrap; background: var(--chip); color: var(--muted); }
  .wk.k1 { background: var(--warn); color: var(--muted); } .wk.k2 { background: var(--warn); color: var(--mid); } .wk.k3 { background: var(--warn); color: var(--high); }
  .wk.k4 { background: var(--ok); color: var(--muted); } .wk.k5 { background: var(--ok); color: var(--ink); }
  .wklegend { grid-column: span 12; margin: -.4rem 0 0; display: flex; flex-wrap: wrap; gap: .35rem; } .wklegend .wk { font-size: .7rem; font-weight: 500; }
  .snote { font-size: .9rem; border-left: 3px solid var(--line); padding-left: .5rem; }
  .tile.last p { font-size: .9rem; } .clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .tile.last.open .clamp { display: block; -webkit-line-clamp: unset; } .unclamp { padding: .05rem .5rem; font-size: .78rem; color: var(--muted); margin-top: .2rem; }
  .stack .line, .line { display: flex; gap: .5rem; padding: .5rem 0; border-bottom: 1px solid var(--line); } .line:last-child { border: 0; }
  .group { border: 1px solid var(--line); border-radius: .7rem; margin: 0 0 .6rem; overflow: hidden; } .ghead { background: var(--paper); padding: .45rem .7rem; display: flex; gap: .45rem; align-items: center; flex-wrap: wrap; }
  .item { display: grid; grid-template-columns: minmax(0, 1fr) 13.5rem; gap: .8rem; padding: .55rem .7rem; border-top: 1px solid var(--line); align-items: start; }
  .mod > .item, .more > .item { border: 1px solid var(--line); border-radius: .6rem; margin-bottom: .45rem; }
  .act label { font-size: .84rem; white-space: nowrap; margin-right: .6rem; display: inline-block; } .act input[type="text"], .act select { margin-top: .3rem; }
  .dflt { font-size: .9rem; margin-top: .15rem; } .rank { display: inline-block; min-width: 1.3rem; text-align: center; background: var(--chip); border-radius: 999px; font-size: .78rem; padding: 0 .3rem; }
  .kind { font-size: .7rem; text-transform: uppercase; letter-spacing: .04em; background: var(--chip); border-radius: .3rem; padding: .05rem .35rem; }
  .crumb, .crumbs { color: var(--muted); font-size: .8rem; } .crumbs { font-size: .9rem; }
  .chip { display: inline-block; background: var(--chip); border-radius: 999px; padding: .05rem .5rem; font-size: .76rem; color: var(--ink); text-decoration: none; } .chip.ok { background: var(--ok); } .chip.quiet { color: var(--muted); } .chip.hot { background: var(--accent); color: #fff; } .chip.link { text-decoration: underline; text-decoration-color: var(--line); }
  .age { font-weight: 650; font-size: .82rem; } .age.mid { color: var(--mid); } .age.old { color: var(--old); }
  .due { font-size: .82rem; font-weight: 650; } .due.soon { color: var(--old); } .on { font-size: .8rem; background: var(--chip); border-radius: .3rem; padding: .05rem .35rem; }
  a.plink { color: var(--ink); text-decoration: underline; text-decoration-color: var(--line); text-underline-offset: 3px; } a.plink:hover { color: var(--accent); }
  .flag { border: 0; background: none; padding: 0 .1rem; cursor: pointer; vertical-align: -2px; line-height: 0; } .flag:disabled { cursor: default; }
  .flag.urgent { color: var(--urgent); } .flag.high { color: var(--high); } .flag.normal { color: var(--normal); } .flag.low { color: var(--low); }
  .track { display: grid; gap: 3px; margin: .5rem 0 .1rem; } .track span { background: var(--chip); border-radius: 4px; padding: .3rem .2rem; font-size: .74rem; text-align: center; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .track .past { background: var(--ok); } .track .now { background: var(--accent); color: #fff; font-weight: 650; }
  .track.small { display: inline-grid; width: 7.5rem; vertical-align: middle; margin: .3rem .4rem 0 0; } .track.small span { padding: 0; height: .4rem; } .stagename { font-size: .8rem; color: var(--muted); }
  input[type="text"], input[type="search"], select, textarea { font: inherit; font-size: .9rem; width: 100%; padding: .3rem .5rem; border-radius: .5rem; border: 1px solid var(--line); background: var(--paper); color: var(--ink); }
  button, a.btn { font: inherit; font-size: .9rem; border: 1px solid var(--line); background: var(--paper); color: var(--ink); border-radius: .5rem; padding: .35rem .8rem; cursor: pointer; text-decoration: none; display: inline-block; }
  button.primary { background: var(--accent); color: #fff; border-color: var(--accent); font-weight: 650; padding: .55rem 1.1rem; font-size: 1rem; }
  .showmore { margin-top: .3rem; width: 100%; color: var(--muted); } #dumpadd { margin: .4rem 0; }
  .note { border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: .6rem; padding: .6rem .8rem; margin-bottom: .5rem; }
  details.raw { margin-top: .6rem; border: 1px solid var(--line); border-radius: .6rem; padding: .4rem .7rem; } details.raw summary { cursor: pointer; font-size: .88rem; }
  .empty { color: var(--muted); }
  .filter .chips { display: flex; flex-wrap: wrap; gap: .3rem; } .filter .chips button { padding: .12rem .55rem; border-radius: 999px; font-size: .8rem; } .filter .chips button.on { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  details.folder > summary { cursor: pointer; font-weight: 650; padding: .3rem 0; } a.leaf { display: flex; gap: .4rem; align-items: center; padding: .28rem .4rem; border-radius: .4rem; color: var(--ink); text-decoration: none; font-size: .9rem; }
  a.leaf:hover, a.leaf.sel { background: var(--chip); } .lname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dot { width: .6rem; height: .6rem; border-radius: 50%; display: inline-block; background: var(--low); flex: none; }
  ${stageCss}
  .legend span { display: flex; gap: .4rem; align-items: center; font-size: .8rem; color: var(--muted); padding: .1rem 0; }
  .phead { display: flex; justify-content: space-between; gap: 1.5rem; align-items: flex-start; flex-wrap: wrap; } .back { color: var(--muted); text-decoration: none; font-size: .9rem; } .resume { text-align: right; max-width: 24rem; } .resume .opens { margin-top: .4rem; display: flex; gap: .4rem; flex-wrap: wrap; justify-content: flex-end; }
  .ptrack { display: grid; grid-template-columns: minmax(0, 1fr) 15rem; gap: 1rem; align-items: center; } .ptrack .track span { padding: .5rem .2rem; font-size: .85rem; } .fix { font-size: .8rem; color: var(--muted); }
  .dash { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .8rem; margin: .8rem 0; } .dash .tile { background: var(--card); } .dash .tile.ms.you { background: var(--you); border-color: var(--high); } .dash h4 { margin-top: 0; }
  .parts { display: grid; grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr)); gap: .6rem; } .part { border: 1px solid var(--line); border-radius: .6rem; padding: .5rem .7rem; background: var(--card); }
  .cols { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 1.6rem; } @media (max-width: 1300px) { .cols, .dash { grid-template-columns: 1fr 1fr; } .cols { grid-template-columns: 1fr; } }
  .call { border: 1px solid var(--line); border-radius: .7rem; padding: .6rem .8rem; margin-bottom: .5rem; background: var(--card); } .call .lead { font-size: .8rem; color: var(--accent); font-weight: 650; letter-spacing: .01em; } .call .q { font-weight: 650; margin: .15rem 0; } .call .act { margin-top: .35rem; display: grid; grid-template-columns: auto 1fr; gap: .6rem; align-items: center; }
  .review { border: 1px solid var(--high); background: var(--you); border-radius: .8rem; padding: .6rem .9rem .7rem; margin: .8rem 0 .2rem; } .review h4 { margin: 0 0 .3rem; color: var(--ink); }
  .rv { display: flex; justify-content: space-between; gap: 1rem; align-items: center; padding: .35rem 0; border-top: 1px solid var(--line); } .review > .rv:first-of-type { border-top: 0; } .refs { margin: .5rem 0 0; }
  [data-off="1"] { display: none !important; }
  #bar { position: fixed; left: 19rem; right: 0; bottom: 0; background: var(--card); border-top: 1px solid var(--line); padding: .6rem 1.6rem; display: flex; gap: .8rem; align-items: center; justify-content: flex-end; z-index: 3; flex-wrap: wrap; }
  @media (max-width: 1000px) { #bar { left: 0; padding: .5rem 1rem; } #main { padding: 1rem 1rem 8rem; } }
  @media (max-width: 640px) { .pair, .dash, .ptrack, .call .act { grid-template-columns: 1fr; } .item { grid-template-columns: 1fr; } .resume { text-align: left; max-width: none; } .resume .opens { justify-content: flex-start; } .ptrack .track span { font-size: .62rem; padding: .4rem .1rem; } h1 { font-size: 1.4rem; } }
</style></head>
<body><div id="app">
${rail}
<div id="main">
  <div id="home">
    <header><h1>${esc(CFG.title)}</h1>
    <p class="meta">Read by the agent ${esc(desk.read_at || "never")}${readAge != null ? ` (${readAge === 0 ? "today" : readAge + " d ago"})` : ""} · pull requests checked ${esc(auto.refreshed_at || "not yet")} · page built ${stamp(now)} · ${projects.length} projects</p>
    ${desk.note ? `<p class="meta">${esc(desk.note)}</p>` : ""}
    ${stale ? `<div class="banner">The ranked list is ${readAge} day${readAge === 1 ? "" : "s"} old. Ages and pull requests are current; who is waiting and why are not. Open a chat and type <b>${esc(CFG.command)}</b> for a fresh read.</div>` : ""}
    ${auto.error ? `<div class="banner">The morning check could not reach GitHub: ${esc(auto.error)}</div>` : ""}</header>
    ${band}
    <div class="grid">${home}</div>
  </div>
  ${projects.map(projectPage).join("\n")}
</div></div>
<div id="bar"><span class="muted" id="count">No answers yet</span><button class="primary" id="copy">Copy my answers</button><button id="clear">Clear</button></div>
<script>
(function () {
  var READ = ${JSON.stringify(desk.read_at || "")}, PRI = ${JSON.stringify(PRI)}, CMD = ${JSON.stringify(CFG.command)};
  var NS = "desk:" + location.pathname + ":", KEY = NS + "answers:" + READ, FKEY = NS + "flags:" + READ, DKEY = NS + "dump";
  var saved = {}, flags = {}, dump = [];
  try { saved = JSON.parse(localStorage.getItem(KEY) || "{}"); flags = JSON.parse(localStorage.getItem(FKEY) || "{}"); dump = JSON.parse(localStorage.getItem(DKEY) || "[]"); } catch (e) {}
  var $ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var fields = $("[data-id]");
  function k(el) { return el.dataset.id + "|" + (el.dataset.say || el.type || el.tagName); }
  fields.forEach(function (el) { var v = saved[k(el)]; if (v != null) { if (el.type === "checkbox") el.checked = !!v; else el.value = v; } el.addEventListener("input", store); el.addEventListener("change", store); });
  function store() { var o = {}; fields.forEach(function (el) { if (el.type === "checkbox") { if (el.checked) o[k(el)] = 1; } else if (el.value) o[k(el)] = el.value; }); try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} count(); }
  function lines() {
    var by = {}, order = [];
    fields.forEach(function (el) { var say = el.type === "checkbox" ? (el.checked ? el.dataset.say : "") : el.value.trim(); if (say) { if (!by[el.dataset.id]) { by[el.dataset.id] = []; order.push(el.dataset.id); } if (by[el.dataset.id].indexOf(say) < 0) by[el.dataset.id].push(say); } });
    var out = order.map(function (id) { return id + ": " + by[id].join("; "); });
    Object.keys(flags).forEach(function (s) { out.push(s + ".priority: " + flags[s]); });
    dump.forEach(function (t) { out.push("backlog: " + t); });
    return out;
  }
  function count() { var n = lines().length; document.getElementById("count").textContent = n ? n + " answer" + (n === 1 ? "" : "s") + " ready" : "No answers yet"; }
  function put(text, btn, done) {
    function ok() { var t = btn.textContent; btn.textContent = done; setTimeout(function () { btn.textContent = t; }, 1800); }
    function fb() { var a = document.createElement("textarea"); a.value = text; document.body.appendChild(a); a.select(); try { document.execCommand("copy"); ok(); } catch (e) {} a.remove(); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fb); else fb();
  }
  document.getElementById("copy").addEventListener("click", function () { var l = lines(); if (l.length) put(CMD + " answers (desk read " + READ + ")\\n" + l.join("\\n"), this, "Copied. Paste it into a chat."); });
  document.getElementById("clear").addEventListener("click", function () { fields.forEach(function (el) { if (el.type === "checkbox") el.checked = false; else el.value = ""; }); flags = {}; dump = []; try { localStorage.removeItem(FKEY); localStorage.setItem(DKEY, "[]"); } catch (e) {} paintFlags(); paintDump(); store(); });
  $("button.copy").forEach(function (b) { b.addEventListener("click", function () { put(b.dataset.copy, b, "Copied. Paste it into a new chat."); }); });
  $(".showmore").forEach(function (b) { b.addEventListener("click", function () { var m = b.previousElementSibling; m.hidden = !m.hidden; b.textContent = m.hidden ? b.dataset.more : b.dataset.less; }); });
  // last week's tiles: show "more" only where a line was cut
  function clamps() { $(".unclamp").forEach(function (b) { var t = b.parentNode; if (t.classList.contains("open")) return; b.hidden = !$(".clamp", t).some(function (c) { return c.scrollHeight > c.clientHeight + 1; }); }); }
  $(".unclamp").forEach(function (b) { var t = b.parentNode; b.addEventListener("click", function () { t.classList.toggle("open"); b.textContent = t.classList.contains("open") ? "less" : "more"; }); });
  window.addEventListener("resize", clamps);

  // priority flags: click to cycle; the change travels in the answers block
  function paintFlags() { $(".flag").forEach(function (f) { var host = f.closest("[data-slug]"), s = f.dataset.flag || (host && host.dataset.slug); if (!s) return; if (!f.dataset.orig) f.dataset.orig = PRI.filter(function (p) { return f.classList.contains(p); })[0] || "normal"; var p = flags[s] || f.dataset.orig; PRI.forEach(function (x) { f.classList.toggle(x, x === p); }); f.title = "Priority: " + p + (f.dataset.flag ? ". Click to change" : ""); }); }
  $(".flag[data-flag]").forEach(function (f) { f.addEventListener("click", function (e) { e.preventDefault(); var s = f.dataset.flag, cur = flags[s] || f.dataset.orig || "normal", nx = PRI[(PRI.indexOf(cur) + 1) % PRI.length]; if (nx === f.dataset.orig) delete flags[s]; else flags[s] = nx; try { localStorage.setItem(FKEY, JSON.stringify(flags)); } catch (e2) {} paintFlags(); count(); }); });

  // the backlog: dump now, file later
  function paintDump() { var ul = document.getElementById("dumplist"); if (!ul) return; ul.innerHTML = ""; dump.forEach(function (t, i) { var li = document.createElement("li"); var s = document.createElement("span"); s.textContent = t; var x = document.createElement("button"); x.textContent = "remove"; x.addEventListener("click", function () { dump.splice(i, 1); saveDump(); }); li.appendChild(s); li.appendChild(x); ul.appendChild(li); }); }
  function saveDump() { try { localStorage.setItem(DKEY, JSON.stringify(dump)); } catch (e) {} paintDump(); count(); }
  var add = document.getElementById("dumpadd"); if (add) add.addEventListener("click", function () { var t = document.getElementById("dump"); if (t.value.trim()) { dump.push(t.value.trim()); t.value = ""; saveDump(); } });

  // filters and the rail
  var fa = "", fs = "", q = "";
  function applyFilter() {
    $("[data-areas]").forEach(function (el) { var leaf = el.classList.contains("leaf"), bare = !el.dataset.areas && !leaf, areas = el.dataset.areas ? el.dataset.areas.split("|") : []; var okA = !fa || areas.indexOf(fa) >= 0 || bare, okS = !fs || el.dataset.sub === fs || bare, okQ = !q || !leaf || el.textContent.toLowerCase().indexOf(q) >= 0; el.dataset.off = okA && okS && okQ ? "" : "1"; });
    $("details.folder").forEach(function (d) { d.dataset.off = $("a.leaf", d).some(function (a) { return a.dataset.off !== "1"; }) ? "" : "1"; });
  }
  function chips(id, set) { $("#" + id + " button").forEach(function (b) { b.addEventListener("click", function () { $("#" + id + " button").forEach(function (x) { x.classList.remove("on"); }); b.classList.add("on"); set(b.dataset.v); applyFilter(); }); }); }
  chips("f-area", function (v) { fa = v; }); chips("f-sub", function (v) { fs = v; });
  var find = document.getElementById("find"); if (find) find.addEventListener("input", function () { q = find.value.trim().toLowerCase(); applyFilter(); });

  // one view at a time: the desk, or one project
  function route() {
    var h = location.hash, pid = h.indexOf("#p-") === 0 ? h.slice(1) : "", page = pid && document.getElementById(pid);
    document.getElementById("home").hidden = !!page; $("article.proj").forEach(function (a) { a.hidden = a !== page; });
    $("a.leaf").forEach(function (a) { a.classList.toggle("sel", !!page && a.getAttribute("href") === h); });
    if (page) window.scrollTo(0, 0); else if (h.indexOf("#m-") === 0) { var m = document.getElementById(h.slice(1)); if (m) m.scrollIntoView(); }
  }
  window.addEventListener("hashchange", function () { route(); clamps(); }); route(); clamps(); paintFlags(); paintDump(); count();
})();
</script>
</body></html>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`desk rendered ${stamp(now)}: ${projects.length} project(s), ${list(desk.waiting).length} waiting, ${closeCount} to close out -> ${path.relative(process.cwd(), OUT) || OUT}`);
