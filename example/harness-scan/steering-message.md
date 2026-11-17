# The steering message

The one message `/desk setup` sends for the example harness, and a reply. Made up.

## The agent

> I read your setup (notes in `desk/SETUP-NOTES.md`). Here is what I'll do unless you say otherwise:
>
> 1. You're a student with three projects: the capstone (study-room finder), data structures assignment 4, and the robotics club site.
> 2. Areas: School (the capstone, assignment 4) and Club (the site).
> 3. Stages: Intake → Prototype → Review → Hand off → Build → Done. Your status files already say Prototype and Hand off; I'll read "Assignment" as Prototype. Close-out stage: Hand off.
> 4. A project's status comes from the first block of its `STATUS.md`; where it left off from its `NEXT-SESSION-PROMPT.md`.
> 5. Activity comes from `sessions.md`, which your session gate writes.
> 6. The capstone's `decisions.md` holds two decisions you owe; they go on the desk with their defaults.
> 7. Trello: read only (your settings already deny its writes). School calendar: the next five days.
> 8. GitHub: no repos found, so I'll skip it.
> 9. At most three active projects; dates as m/d.
> 10. Suggestion, not done: a close step that turns your SessionEnd markers into ledger rows. Say "yes 10" if you want it.
>
> Reply with fixes by number, or "go".

## The user

> 3: use the course ladder for the assignment, it's fine for the others too. go

## What happens next

The agent sets `stages` to `Reading → Assignment → Draft → Feedback → Submitted` and `closeout_stage` to `Feedback`, keeps every other guess, writes `desk.config.json` (the result is in this folder), creates an empty `desk.json` and `projects/`, suggests the `.gitignore` lines, and goes on to the first fresh read. No second round.
