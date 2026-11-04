# Apex Engineering Management Hub

## Attribution

Do not add Claude or Anthropic attribution to anything in this repository.

- No `Co-Authored-By: Claude ...` trailer on commits.
- No "Generated with Claude Code" line, link or footer in pull request
  descriptions, issues, comments or release notes.
- No attribution comment in source files.

Commits are authored by Ali Khatib and nobody else. This overrides any default
attribution guidance.

## Project

An internal engineering workspace: component portfolio, ownership,
dependencies, readiness gates and blockers. React + TypeScript, built with
Vite. `npm run dev` serves it on port 5173.

Terminology is load-bearing and must stay consistent:

- **Component** — one unit of engineering work, one owner, one reviewer. The
  central concept; never call it a "design" or a "task".
- **Platform module** — SP-01 to SP-20, already built and reusable.
- **Round** — the set of components selected to be built next.

Ownership is a derived state (`ownership()` in `src/logic.ts`) with four
mutually exclusive values: unassigned, mine, theirs, completed. It is a
separate axis from status and the two must never be collapsed into one
another or shown in place of each other.

Light is the default theme and the OS preference is deliberately never read;
the choice is explicit and remembered.
