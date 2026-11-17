# The desk: contract

What the data looks like and what each answer does. The skill (`SKILL.md`) says when to write it, and `desk/render.js` draws it.

## Two kinds of fact

| Kind | Examples | Who writes it | When |
|---|---|---|---|
| **Judged** | a project's stage, its decisions, the ranked list, who waits and why, what is parked | the agent running `/desk` | when you ask, or in the morning run |
| **Mechanical** | the state of each named pull request, feature pull requests merged in 7 days, every age in days | `refresh.js` and `render.js`, with no model | every morning, and at each `/desk` |

`refresh.js` writes only `auto` and the `state` fields on a `pr`. The page's header says how old the judged read is, and shows a banner once it is a day old.

## Files (all in the data folder, default `desk/`)

| File | What |
|---|---|
| `desk.config.json` | your stages, areas, sources and labels (see `desk.config.example.json`) |
| `desk.json` | the board's rows |
| `projects/<slug>.json` | one record per project |
| `backlog.json` | things you dumped in the backlog box, once filed |
| `answers/` | your pasted answer blocks, verbatim |
| `index.html` · `refresh.log` | the page and the morning log |
| `scan.json` · `scan.md` | what `scan.js` found in your harness at setup (names, counts and paths; no secrets) |
| `SETUP-NOTES.md` | the agent's reading of your setup: what it found, what it thinks you are, how it will read your work, suggestions |

The data names people and what they wait for, and the setup files describe your harness. Keep them local: they should not go in git.

## desk.config.json

Every key is optional; `render.js` has a default for each. Setup writes only the keys it has a value for.

| Key | What |
|---|---|
| `title` `owner` `command` | the page title, your name as it appears in `on` fields (default `you`), the command the page tells you to type |
| `profile` | `user_type`, `project_types` (a list), `notes` (one line): who setup thinks you are; read by the agent only |
| `stages` `stage_short` `closeout_stage` | the ladder, optional short labels for narrow screens, the "one step from done" stage |
| `areas` `labels` | the rail's groups; section titles and the words for area and subarea |
| `max_active` `date_style` `tracker_label` `page` `today` | the active cap; `m/d`, `d/m` or `iso`; the word before a task id; where the page is written; a frozen today for demos |
| `github` | `repos`, `people` (login to first name), `feature_pattern`: used by `refresh.js` only |
| `scrub` | `names`: people, clients or products `scrub.js` should flag before you share; it also checks `github.people`, your computer's user name and your git identity |
| `lifecycle` | `status_file_names`, `kickoffs_glob`, `sessions_table`, `session_end`: where status, "where it left off" and activity come from |
| `sources` | a list; each has `kind` (`local` `github` `tracker` `calendar` `mail` `meetings` `board` `goals`), plus `path`, `repos` or `via`, `access` (`read`, `read-only by policy`, `not authorized`) and `read` (what to read) |

## Stages

The ladder comes from `stages` in the config. The default is:

`Intake` → `Prototype` → `Review` → `Hand off` → `Build` → `Done`

| Stage | Means |
|---|---|
| Intake | An idea or brief is forming; nothing is built yet. |
| Prototype | A version is being built or revised and is not ready for your review. |
| Review | A version waits for your review. Decisions are open. |
| Hand off | Your decisions are made. What is left is finishing: a send, a post, a sign-off, a package. |
| Build | Someone else (a teammate, a contractor) is building it. |
| Done | Shipped, submitted, closed or retired. |

A course ladder works the same way: `Reading` → `Assignment` → `Draft` → `Feedback` → `Submitted`. `closeout_stage` in the config names the stage that means "one step from done", and projects in it sort first in Close out.

**`state`** is one of these:
- `active`: worked on with you in the last 7 days.
- `out of your hands`: someone else has it.
- `stalled`: the next step is yours and nothing has moved for 7 days.
- `parked`
- `done`

**`priority`** is one of these:
- `urgent`: someone is blocked now, or there is a date within 7 days.
- `high`: due this month, or someone has waited more than 7 days.
- `normal`
- `low`

You can click a flag on the page to change it. The change travels in the answers block.

## A project record

`projects/<slug>.json`. Every key is present, set to `null` or `[]` when unknown. All dates are `YYYY-MM-DD`. The page computes the ages.

| Key | What |
|---|---|
| `slug` `name` | id (letters, digits, dashes) and display name |
| `area` `subarea` `initiative` | where it sits, shown as a breadcrumb. `area` can hold two areas joined by ` · `. The rail groups by the first. |
| `scope` `goal` | one or two lines each |
| `milestone` | `what` `due` `on` `note`. `on` is `you` (the config's `owner`) or a first name. |
| `stage` `state` `stage_evidence` `priority` `priority_why` | as above. The evidence says why this stage is right. |
| `opened` `last_activity` `people` `folder` | dates, the people involved, and the project's own folder |
| `task` | `id` `name` `url`: its card in your tracker, if it has one |
| `parts` | `name` `stage` `on` `note`: the pieces, each on its own stage |
| `stands` | three lines on where it stands |
| `who_has` | one line |
| `asking` | `who` `what` `since`: questions people have put to you |
| `calls` | your decisions, in order: `lead` `call` `default` `since` `doc` |
| `closeout` | `what` `kind` `to` `since` `file` `href`. `kind` is `send` · `post` · `task` · `sign-off` · `approve` · `package`. |
| `pending` `changed` | lists of lines |
| `review` | what you have to look at now, newest first: `label` `kind` `href` `version` `dated` `note` |
| `links` | `repo` `branch` `next_doc` (`label` `href`), and `other` (a list of `label` `href`) |
| `resume` | `minutes`, `steps`, `open` (a list of `label` `href`), and `kickoff`: the first message of a resume chat |
| `sources` | where the facts came from |

- **`href`s are relative to the page** (`index.html`), or full URLs. A decision doc in markdown or a prototype in HTML opens in a new tab.
- **A decision (`calls`) must make sense read cold.** `lead` gives area · thing · why now. `call` is one plain question. `default` is what happens if you say nothing. `doc` is where it is explained.
- **`closeout` needs no new decision:** a drafted text not sent, a post not made, a sign-off, a package to hand over.
- **`resume.kickoff` puts a new chat in position on its first turn.** Use this shape: "Resume <project>. Read <folder>/STATUS.md and <next_doc>. On your first turn, before anything else, give me: where it stands in five lines, the decisions I owe in order with the default on each, and what changed since <date>. The thing I need to review is <label> at <path>: open it for me. Then <the next thing>."

## desk.json

| Key | Rows | Fields |
|---|---|---|
| `read_at` · `note` | | when the agent read (`YYYY-MM-DD HH:MM`), and one line on how, including any source that failed |
| `today` | hard dates in the next five days | `when` `what` `who` |
| `week_two` · `week_two_week` · `week_start` · `week_note` | the week's two priorities; the week as a label; its Monday (`YYYY-MM-DD`); how they were set and your word on them | `slug` `project` `why` `status` `status_note` |
| `week_two_last` | last week's two and where they ended | `week` `set`, and `items` with `slug` `project` `was` `status` `worked` `left` |
| `week_status_scale` | the scale below, in order | |
| `active` · `active_note` | at most `max_active` (default 3) projects in rounds with you | `slug` `project` `next` |
| `waiting` | what waits on you, ranked | `id` (W1, W2…) `slug` `project` `what` `who` `since` `default` `default_ok` `pr` |
| `check` | a record that disagrees with another | `id` (C…) `title` `text` `pr` |
| `out` | projects someone else has | `slug` `project` `who` `last` `prs` |
| `new_work` | work others did that you did not ask for | `window`, and `items` with `id` (N…) `who` `what` |
| `park` | active-looking projects where nothing has moved | `id` (P…) `slug` `project` `waiting` `since` |
| `auto` | written by `refresh.js` only | `refreshed_at` `error` `features` |

A `pr` is `{ "repo": "owner/name", "number": 12 }`, and `refresh.js` adds `state`, `mergedAt` and `updatedAt`. Set `default_ok: false` when there is no safe default; the "go with that" tick is then hidden.

**Ranking `waiting`:** someone is blocked now; then a date this week; then age, oldest first. The page groups the rows by project in rank order.

**The week status scale.** One scale for both week panels, in this order. A missing `status` shows as `not started`.

| `status` | Mark | Means |
|---|---|---|
| `not started` | ○ | no work on it this week |
| `started` | ◔ | work began |
| `partly` | ◑ | some of it is done |
| `done, to hand off` | ◕ | your part is finished; a send, a post or a package is owed |
| `handed off` | ➜ | it reached the person |
| `completed` | ✓ | nothing is left |

**A new week.** On the first read once `week_start` is more than 6 days ago, move this week's two into `week_two_last`, with their `status`, `worked` and `left`. Then propose the new two.

## The backlog

The page has a box where you dump anything. It travels in the answers block as `backlog: <your words>`. Filed rows live in `backlog.json`: `added` `text` `status` (`filed` · `placed: <slug>` · `done`) `project`.

## The answers block

Every row on the page has a box or a tick. **Copy my answers** copies a block like this:

```
/desk answers (desk read 2026-03-11 07:45)
W1: go with what is on record
capstone-study-rooms.c2: ask the library, and cc the advisor
robotics-club-site.x1: show me, then do it
P1: park it
N1: take a look
budget-app.stage: Done
ds-assignment-4.priority: urgent
backlog: look into the campus GPU cluster
```

| Line | The agent does |
|---|---|
| `W…` or `<slug>.c<n>` with words | Records your words verbatim in the project, takes the decision out of `calls`, notes it in `changed`, and drafts any message that carries it. It shows you the draft. |
| `… : go with what is on record` | The same, with the row's `default` as the decision. |
| `<slug>.x<n>: show me, then do it` | Shows the drafted text and who gets it. It sends, posts or creates on your "send it". |
| `<slug>.x<n>: drop it` | Marks the draft dropped and removes the row. |
| `P…: park it` | Writes a park note in the project's folder (open items, decisions left, the way back in) and sets `state` to `parked`. |
| `P…: keep it active` | Leaves it. If that makes more than `max_active`, it asks which one gives up its place. |
| `N…: take a look` or `review session` | Reads what was built and gives you a short review, or sets up a review session. |
| `<slug>.stage: …` · `<slug>.priority: …` | Writes it into the record. Your word outranks the agent's reading. |
| `backlog: …` | Appends it to `backlog.json` verbatim, places it against a project when the fit is plain, and says where it went. |
| `C…` with words | Does what the words say. |

A tick is your decision. It is not a send. Anything that reaches a person still shows you the text first and waits for "send it".

The answers are done when every line has been acted on, or named as not done with the reason; the closed rows are gone from the data; and the page has been re-rendered.

## What the desk does not do

- It only reads your sources. It writes only the data folder, plus your project folders through the answers block.
- It never sends, posts, comments or creates a task without your "send it".
