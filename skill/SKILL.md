---
name: desk
description: Your project board as one local page (desk/index.html). It shows what waits on you, ranked, with a default on each; this week's two priorities; the active three; what is one step from done; and a page per project with "Resume in a new chat". Modes are fresh read (the default), resume <project>, answers (a pasted block that starts "/desk answers") and setup (the first run, or /desk setup: scan the harness, one steering message, then the first read).
disable-model-invocation: true
---

# /desk

You keep the user's desk: one local HTML page that tells them what waits on them and lets them answer from the page.

## Files

| What | Where |
|---|---|
| The contract (record schema, desk.json keys, ranking, answers table) | `CONTRACT.md`, beside this file. Read it before you write any data. |
| The user's settings (stages, areas, sources, page path) | `desk/desk.config.json` in the project. An example is `desk.config.example.json`, beside this file. |
| The setup procedure | `SETUP.md`, beside this file |
| The renderer, the no-model refresh and the setup scan | `desk/render.js`, `desk/refresh.js`, `desk/scan.js` |
| The data | `desk/desk.json`, `desk/projects/<slug>.json`, `desk/backlog.json`, `desk/answers/`. It is local and private, so never commit it unless the user asks. |

If the user keeps the scripts somewhere other than `desk/`, use that folder everywhere below and pass `--data <folder>`.

## Pick the mode

- The message is a block starting `/desk answers`: use **Answers**.
- The message says `resume <project>`: use **Resume**.
- The message says `setup`, or `desk/desk.config.json` does not exist: use **Setup**, then **Fresh read**.
- Anything else: use **Fresh read**.

## Rules for every mode

1. **Reads only, outside the data folder.** Against GitHub, a tracker, a calendar or mail you only read. Do not comment, change a status, create a task, send, commit or push, unless the user asks for that one thing.
2. **Anything that reaches a person waits for "send it".** That covers a message, an email, a comment, a post and a task someone else will see. Show the full text and who gets it, then wait for the words "send it". A tick in the answers block is the user's decision. It is not permission to send.
3. **Every decision can be read cold.** `lead` says where it is and why it matters now: area · thing · who is blocked or which date. `call` is one plain question. `default` says what happens if they say nothing. If a document explains it, link it (`doc`). Write so the user understands it a week later without the chat.
4. **Write only inside the data folder.** In Answers mode you may also write into the project's own folder, for example notes or a decision log.
5. **Keep ids and dates stable.** A row or decision that is still true keeps its `id` and its `since`. A new row gets the next free id.
6. **Name every source.** Each row comes from somewhere you can point to: a file, a pull request, a task or an event. If a source fails, say which one in `desk.json`'s `note` and carry on.

## Setup

Follow `SETUP.md`, beside this file. In short: run `node desk/scan.js --schedulers` (read-only), check which sources you can actually reach, sample a few files, write `desk/SETUP-NOTES.md`, then send **one** message of at most ten numbered guesses with a default on each. On the reply (fixes by number, or "go"), write a light `desk/desk.config.json`, create an empty `desk/desk.json` and `desk/projects/`, suggest the `.gitignore` lines, and go on to Fresh read. Never a second round of questions.

## Fresh read

1. Get the time from the shell: `date "+%Y-%m-%d %H:%M"` (PowerShell: `Get-Date -Format "yyyy-MM-dd HH:mm"`).
2. Read `desk/desk.config.json`, `desk/desk.json` and every record in `desk/projects/`.
3. Read every source in the config's `sources`, read-only. If your harness has subagents, run one per source in parallel and have each return short facts with where each fact came from.
   - `local`: each project folder's status file (the config's `lifecycle.status_file_names`, else STATUS.md or README), its newest decision docs, and `git log` since the last read. If the config has `lifecycle`, the newest file matching `kickoffs_glob` is where the project left off, and the rows of `sessions_table` since the last read are its activity.
   - `github`: `gh pr list` and `gh pr view` on the listed repos, and issues assigned to the user.
   - `tracker`: through whatever MCP server the user has, read tasks assigned to them, and comments or questions since the last read.
   - `calendar`: the next five days.
   - `mail` (optional): threads waiting on the user's reply.
4. Update the project records. Write one record per project, with every key from the contract present. Done when:
   - each `stage` carries `stage_evidence`;
   - every decision has a `lead`, a `call` and a `default`;
   - every `review` item has an `href` that opens from the page (relative to the page, or a full URL);
   - every record has a `resume.kickoff` in the contract's shape.
5. Write `desk/desk.json`. Done when:
   - every key is filled, or left empty on purpose;
   - `waiting` is ranked by the contract's rule;
   - `active` holds at most the config's `max_active`;
   - every row carries its project's `slug`.
   - **On a new week**, meaning `week_start` is more than 6 days ago: move this week's two into `week_two_last` with each one's `status`, `worked` and `left`. Then propose the new two, and record the user's word on them in `week_note`.
   - **On every read:** give each of this week's two a `status` from the week scale and a one-line `status_note`.
6. Run `node desk/refresh.js`, or `node desk/refresh.js --offline` if the user has no GitHub. Done when it prints `desk rendered` and exits 0.
7. Open `desk/index.html` for the user. In chat, list what is in Close out and hand off, the top three of Waiting on you, anything in Check this, and what changed since the last read.

## Resume

1. Find the record in `desk/projects/`. If there is none, find the project through the sources.
2. Read the project's folder: its status file, decision docs and newest notes. Read its tracker task and its pull requests.
3. Rewrite the record whole, with `calls` in the order the user should take them.
4. Run `node desk/render.js` and open `desk/index.html#p-<slug>`.
5. Give the user the record's `resume.kickoff` as text they can paste into a new chat.

## Answers

1. Save the pasted block verbatim, dated from the shell, as `desk/answers/YYYY-MM-DD-HHMM.md`.
2. If the block's `desk read` time is older than `desk.json`'s `read_at`, match each line by its id and by the row's text. Name any line whose row has gone.
3. Act on each line using the contract's answers table, one project at a time. Before you interpret the user's words, record them verbatim in the project.
4. Anything that reaches a person: show the text and who gets it, then wait for "send it" (rule 2).
5. Remove the closed rows from the data, run `node desk/render.js`, and report on each line: done; drafted and waiting for "send it"; or not done, and why.
