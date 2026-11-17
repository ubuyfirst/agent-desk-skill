# Harness scan (2026-11-17 15:37)

Read-only inventory by desk/scan.js v1. Root: `harness`. User level: skipped. 6 folders in 48 ms.

## Harness
- Detected: claude-code
- Instruction files: CLAUDE.md (15 lines)
- Skills: 2 (session-gate, study-notes)
- Skill packs (lock file): 0
- Agents: 0 (none) · commands: 0 · Cursor rules: 0 · plugins enabled: 0
- Hooks: SessionEnd ×1

## Session lifecycle
- End of session: SessionEnd → session-end-marker.js
- Start of session: no hook
- Session-gate-looking skills or rules: session-gate
- Close-step-looking skills: none
- Sessions tables: sessions.md (3 rows)
- Kickoff / resume files: 3 · memory files: 0

## Work structure
- Project folders: 3 (3 top-level), 3 with a status file, 3 with a kickoff file
- Boards: none
- Goals / lanes: goals.md · weekly roll-ups: 0 · ADR folders: 0 · glossary: none
- Decision sheets: 1 · open-items files: 0 · ledgers/queues: 0 · exchange folders: 0 · intake folders: 0

## Data sources
- MCP servers: 2
  - tracker: trello (writes denied)
  - calendar: school-calendar
- Permission rules: allow 2 · deny 3 · ask 0
- Git repos: 0 (no remotes) · gh on PATH: yes
- Scheduled jobs: not checked (pass --schedulers)

## Cues
- User type signals: student 2
- Stage words in status files: Prototype 1 · Assignment 1 · Hand off 1
- Project type words: capstone 1 · assignment 1 · site 1

This file and scan.json stay local. The agent reads them, samples a few files, and writes SETUP-NOTES.md.
