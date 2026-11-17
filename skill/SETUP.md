# /desk setup

The first run. You look around the user's harness, work out who they are and how their work is laid out, and ask **one** steering question. Then you write a light config and do the first read.

No interview, no multi-round wizard. One message of numbered guesses the user can fix in one reply, or answer with "go".

## When it runs

- `desk/desk.config.json` does not exist: setup runs on its own, then Fresh read.
- The user types `/desk setup`: run it again. Keep every value in the current config unless the scan or the user's reply changes it, and show what changed.

## Rules for setup

1. **Read only.** The scan and your sampling read files and list things. They never change a file outside `desk/`, never call a write tool, never post, never install anything.
2. **Write only inside `desk/`:** `scan.json`, `scan.md`, `SETUP-NOTES.md`, `desk.config.json`, `desk.json`, `projects/`.
3. **No secrets.** Never copy an environment value, token, header, URL with a key in it, or full hook command into anything you write. Server names, file paths and script file names are enough.
4. **It stays local.** The scan and the notes describe the user's setup. Suggest these lines for their `.gitignore`: `desk/scan.json`, `desk/scan.md`, `desk/SETUP-NOTES.md`.
5. **Suggestions are offers.** You may suggest a hook, a skill or a file (see "Gaps worth offering"). You build none of them without a yes, and setup never waits on them.

## Steps

### 1. Scan

Run `node desk/scan.js --schedulers` from the project root. It is read-only and opens no network connection. Add `--no-home` if the user does not want their user folder read. It writes `desk/scan.json` and a short `desk/scan.md`, and prints one line. Done when it exits 0.

Read `scan.md` first, then the parts of `scan.json` you need. `stats.truncated` tells you where it stopped short (a depth cap, a list cap); sample those places yourself if they matter.

### 2. Check what you can actually reach

The scan sees configuration. You see the runtime. Compare the two:

- List the MCP tool prefixes you have in this session (`mcp__<server>__*`, hosted connectors as `mcp__claude_ai_<Service>__*`). Group them: tracker, calendar, mail, docs, meeting notes, browser, desktop automation, CMS, design, automation, chat, data.
- A server that is configured but needs sign-in, or failed to connect, is **present, not authorized**. It is not absent. Say so, and do not plan a source on it until the user signs in.
- A server whose write tools are denied in settings (`write_tools_denied` in the scan) is **read-only by policy**. That is good for the desk: say it plainly.
- If `gh` is on PATH, `gh auth status` says whether GitHub is readable.

Do not call the tools yet. The first read does that.

### 3. Sample a handful of files

At most eight, top block only (about the first 30 lines):

- the main instruction file (`CLAUDE.md` or `AGENTS.md`): its opening and the headings the scan listed;
- the status files of the three most recently touched projects;
- the newest kickoff or resume file;
- the sessions table: its header and its last five rows;
- a board: its keys or columns and three rows;
- a goals or lanes file;
- the memory index, if there is one (entry titles only).

You are looking for the shape (what a status block holds, what a row in the sessions table holds, the stage words), not the content.

### 4. Work out who they are

Use "What to look for" and "From what you find to the config" below. Decide:

- **user type** and the project types;
- **areas** (the groups the rail filters by) and the **stage ladder**;
- **where each project lives** and how you will read where it stands and where it left off;
- **the sources**, each with how you reach it and whether it is readable now;
- **the lifecycle pieces** you can lean on (sessions table, end-of-session hook, kickoffs).

### 5. Write `desk/SETUP-NOTES.md`

Five sections, short:

1. **What I found:** the harness, its skills, agents and hooks in counts and a few names; the lifecycle pieces; the work structure; the sources, with which are reachable now.
2. **What I think you are:** the user type, the project types, and the two or three cues that made you think so.
3. **How the desk will read your work:** for each source, what you read and how often; where each project's status, kickoff and activity come from.
4. **Gaps and suggestions:** from "Gaps worth offering", only the ones that fit, each as an offer with what it would take.
5. **What I won't touch:** the read-only list (trackers, mail, calendar, repos, instruction files, hooks), and anything the user's own rules forbid.

### 6. Send the one steering message

At most ten numbered guesses. Each guess states your reading and the default you will use. Lead with the guesses most likely to be wrong. Use the user's own words for their projects and stages. Shape:

```
I read your setup (notes in desk/SETUP-NOTES.md). Here is what I'll do unless you say otherwise:

1. You're a student with three projects: the capstone, DS assignment 4, the robotics club site.
2. Areas: School, Club.
3. Stages: Intake → Prototype → Review → Hand off → Build → Done. Your status files already say Prototype and Hand off; I'll read "Assignment" as Prototype. Close-out stage: Hand off.
4. A project's status comes from the first block of its STATUS.md; where it left off from NEXT-SESSION-PROMPT.md.
5. Activity comes from sessions.md (your session gate writes it).
6. Trello: read-only (your settings already deny its writes). School calendar: the next five days.
7. GitHub: none found, so I'll skip it.
8. At most three active projects; dates as m/d.
9. Suggestion, not done: a close step that turns your SessionEnd markers into rows. Say "yes 9" if you want it.

Reply with fixes by number, or "go".
```

Then stop and wait for the reply.

### 7. On the reply

- **"go"**, or fixes by number: apply every fix literally. A fix you cannot apply (a source that is not reachable) goes in `SETUP-NOTES.md` under "Open after setup", and you use the safest default. Do not ask a second round of questions.
- Write `desk/desk.config.json` from `desk.config.example.json`: only the keys you have a value for, plus `profile`, `lifecycle` and `sources`. Keep it light. Anything you are unsure of stays out and the defaults apply.
- Create `desk/desk.json` with every key from the contract, set to empty, and an empty `desk/projects/`.
- Suggest the `.gitignore` lines (the data, plus the three setup files).
- A "yes" to a suggestion: say what you will build and where, then build it after the first read, not before.
- Go on to **Fresh read** in `SKILL.md`. It ends by opening the page.

## What to look for

### 1. The harness

| Harness | Look for |
|---|---|
| Claude Code, project | `CLAUDE.md`; `.claude/settings.json` and `settings.local.json` (hooks, permissions); `.claude/skills/<name>/SKILL.md`; `.claude/agents/*.md`; `.claude/commands/`; `.mcp.json` |
| Claude Code, user | `~/.claude/settings.json` (hooks, plugins); `~/.claude/skills/`; `~/.claude/agents/`; `~/.claude/projects/<slug>/memory/MEMORY.md`; user and local MCP servers in `~/.claude.json` |
| Cross-agent | `AGENTS.md`; `.agents/skills/` (often the real store, with `.claude/skills` a link to it: follow links); `skills-lock.json` (installed skill packs and where they came from) |
| Codex | `.codex/config.toml` (`[mcp_servers.<name>]`), `.codex/hooks.json`, `~/.codex/` |
| Cursor | `.cursor/rules/*.mdc` (note the always-apply ones), `.cursor/hooks.json`, `.cursor/mcp.json` |
| Editor | a `*.code-workspace` file or `.vscode/` means a VS Code-family editor |

Hook events worth noting: SessionStart, SessionEnd, Stop, PreToolUse, UserPromptSubmit (and the camelCase forms other harnesses use).

### 2. The session lifecycle

- **End of session.** A SessionEnd (or Stop) hook that drops a marker, plus a separate close step (a skill run by hand or a nightly job) that writes one row per ended session to a ledger. That ledger is an **activity source**.
- **A session gate.** An always-apply rule or skill that names the chat on the first message and appends a row (time, title, project, stage) to a sessions table, perhaps also updating a JSON board. That table is a **map from chats to projects**, and the best activity record there is.
- **Kickoff or resume prompts.** `NEXT-SESSION-PROMPT*.md`-style files in each project. The newest one is the best "where it left off", and the seed of each record's `resume.kickoff`.
- **Session queues.** Tables of ☐ and ☑ rows: what is lined up next.
- **Memory files.** Their names show the active projects and the user's standing preferences.

### 3. How the work is organised

- **Project folders**, often named `<slug>-<date>`, with a status block at the top of an overview or `STATUS.md`; an `intake/` folder; decision sheets ("yours to decide"); ledgers.
- **Boards:** markdown or JSON keyed by project, with stage, last activity and priority.
- **A stage ladder**, written down somewhere or visible in the status blocks.
- **A lane map or goals file** (quarterly goals G1…Gn).
- **Weekly roll-ups**, **open-items registers**, an `adr/` folder and a glossary or `CONTEXT.md`.
- **Exchange folders** (`to-<someone>/`, `from-<someone>/`) and per-skill contract docs.

### 4. Data sources

- **MCP servers** from every config the scan lists, plus plugin-bundled servers, plus what you see at runtime. Group them by kind.
- **Policy.** A deny list over a tracker's write tools means read-only by policy.
- **Present, not authorized.** Listed but signed out, or failed to connect.
- **Git and GitHub:** repos, remotes, whether `gh` is signed in, open pull requests.
- **Local markdown:** status files, boards, sessions tables.
- **Scheduled jobs** whose names look like morning, daily, weekly, close or session runs (read-only listing).

### 5. Who the user is

| Cues | Likely | Defaults that fit |
|---|---|---|
| class, course, capstone, assignment folders; due dates; a syllabus | **Student** | course ladder; areas like School, Club, Side projects; calendar matters most |
| a roster, per-student seats or folders, class roll-ups, rubrics | **Instructor or mentor** | areas per class or cohort; "waiting on you" is mostly reviews and replies |
| several products on a board, lanes owned by others, weekly briefs, prototype → handoff → build pipelines, contractor briefs, read-only trackers | **Founder, lead or PM** | project ladder; areas per product; closeout matters (sends, posts, sign-offs); `max_active` 3 |
| one repo, coding-standards, TDD or review skills, nothing org-level | **Solo developer** | stages like Issue → Branch → PR → Review → Merged; GitHub is the main source |
| research skills, dated briefs, source packs, findings | **Researcher** | stages like Question → Sources → Draft → Review → Published |
| per-client folders or streams, proposals, invoices | **Client work** | areas per client; dates and replies matter most |

Project types come from folder names and any type column: prototype, design, report, class, planning, research, paperwork, site, app, and so on. People are often two of these; pick the one that drives the most projects and mention the other.

## From what you find to the config

| You found | It sets |
|---|---|
| the user type and its cues | `profile.user_type`, `profile.notes` |
| type words in folder names or a type column | `profile.project_types` |
| stage words in status blocks, or a written ladder | `stages`, `closeout_stage` |
| top-level groups (school vs club, product vs product, client vs client) | `areas` |
| the folder that holds the projects | a `local` source with that `path` |
| the status file names in use | `lifecycle.status_file_names` |
| kickoff or resume prompt files | `lifecycle.kickoffs_glob` |
| a sessions table written by a session gate | `lifecycle.sessions_table` |
| a SessionEnd hook, a close step, a ledger | `lifecycle.session_end` (one line: what writes what) |
| repos on GitHub, and `gh` signed in | `github.repos`, a `github` source |
| a tracker server | a `tracker` source: `via` the server name, `access` (read, read-only by policy, not authorized); `tracker_label` (Card, Issue, Task) |
| a calendar, mail or meeting-notes server | a `calendar`, `mail` or `meetings` source |
| a board file or a goals file | a `board` or `goals` source; goals feed this week's two |
| the date format the user writes | `date_style` |

## Gaps worth offering

Offer only what fits what you found missing. Each one is a suggestion; nothing is installed without a yes.

- **A session gate:** a first-message rule that names the chat and appends one row to an append-only sessions table. It gives the desk an activity record and a chat-to-project map.
- **A status block and a resume card:** a status block at the top of every project, and a next-session prompt written at the end of each session. The desk reads both; the resume card becomes the "Resume in a new chat" message.
- **A cheap end-of-session marker:** a SessionEnd hook that only drops a marker, plus a separate close step that turns markers into rows, with prompt text and paths left out.
- **An open-items register:** one "yours to decide" file per project, so a question is asked once and its answer is kept.
