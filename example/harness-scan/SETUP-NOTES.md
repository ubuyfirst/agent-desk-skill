# Setup notes

Written by `/desk setup` from `scan.json` (in this folder) and five sampled files. Made up, like everything in `example/`. In a real setup this file is `desk/SETUP-NOTES.md` and stays local.

## What I found

- **Harness:** Claude Code at the project level (`CLAUDE.md`, 15 lines; `.claude/settings.json`). No user level was read for this example (`--no-home`).
- **Skills:** 2. `session-gate` names each chat and appends a row to `sessions.md`; `study-notes` turns lecture slides into a study sheet. No agents, commands or plugins.
- **Hooks:** one SessionEnd hook, `session-end-marker.js`, which drops a marker file. Nothing reads the markers yet.
- **Session lifecycle:** a sessions table (`sessions.md`, 3 rows: when, title, project, stage), written by the session gate. Every project has a `NEXT-SESSION-PROMPT.md`.
- **Work structure:** 3 project folders under `projects/`, each with a `STATUS.md` whose first block carries a status, a stage and a date. One decision sheet (`projects/capstone-study-rooms/decisions.md`, two questions with defaults). A goals file (`goals.md`, G1 to G3, one per project).
- **Sources:** two MCP servers in `.mcp.json`: `trello` (stdio; its create, update and comment tools are denied in settings, so it is read-only by policy) and `school-calendar` (http, one read tool allowed). No git repos; `gh` is on PATH.

## What I think you are

A **student**. The cues: a capstone and a numbered course assignment among three projects, a due date in a status block, a study-notes skill, and goals written per term. The third project, a club site, is club work rather than school work.

Project types: capstone, assignment, club site.

## How the desk will read your work

| Source | What I read | When |
|---|---|---|
| `projects/*/STATUS.md` | the first block: status, stage, updated, due | every read |
| `projects/*/NEXT-SESSION-PROMPT.md` | the newest one per project: where it left off, and the seed of "Resume in a new chat" | every read |
| `projects/*/decisions.md` | open questions with their defaults, as decisions you owe | every read |
| `sessions.md` | rows since the last read: which project you worked on, so I can tell active from stalled | every read |
| `goals.md` | G1 to G3, to propose this week's two | on a new week |
| Trello (`trello` server) | cards assigned to you and comments since the last read, read only | every read |
| School calendar (`school-calendar` server) | the next five days | every read |

## Gaps and suggestions

Offers only. Nothing here is built without your yes.

1. **A close step for your SessionEnd markers.** The hook drops markers that nothing reads. A small close step could turn each marker into one row of a ledger (date, project, no prompt text). Your sessions table already covers most of this, so it is optional.
2. **A decision sheet per project.** Only the capstone has one. A "yours to decide" file in the other two would keep a question from being asked twice.

## What I won't touch

- Trello and the calendar: read only, as your settings already require.
- `CLAUDE.md`, `.claude/`, `.mcp.json`, your hooks and your skills: read once at setup, never changed.
- Your project folders: read on every desk read; written only when you answer from the page (a decision recorded verbatim, a park note).
- No commits, pushes, posts or messages. Anything that reaches a person waits for "send it".

## Open after setup

Nothing.
