# Apex Engineering Management Hub

An internal engineering workspace for **Apex AI Arabia** — what the company is building, who owns each piece, what is stuck, and whether it is ready to ship.

## What it tracks

- **Components** — 127 units of engineering work, each with one owner, one reviewer, dependencies, acceptance criteria and evidence. Everything in the product hangs off this one idea.
- **Platform modules** — SP-01 to SP-20, already built and reusable. Most components extend a module rather than starting from nothing.
- **Rounds** — the set of components selected to be built next. Only those carry owners and dates.

A component ships only after three separate approvals: automated checks pass, then QA accepts the exact build, then deployment is approved. Passing the checks never means QA has accepted it.

## Ownership is a state of its own

Every component is in exactly one of four states, and they are never conflated with progress:

| State | Meaning |
| --- | --- |
| Unassigned | Nobody owns it. It cannot start. |
| Assigned to me | You own it and are expected to build it. |
| Assigned to someone else | Readable, but not yours to build. |
| Completed | Finished and deployed. |

A component can be half-built and still have nobody's name on it, so ownership and status are shown as separate columns everywhere.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

On Windows, `start.bat` does the same thing.

## Demo accounts

The component library and the SP modules are real. The team, assignments, blockers and reviews are a demo layer (`src/demo.ts`) so the platform can explain itself — an empty table teaches nobody what the product is for.

Sign in as any of six accounts to see the workspace from a different seat: Zyaad (management view), Ali (admin who also builds), Farouk (QA), Lina (mid-build, blocked), Maya (ready to ship), Rami (new joiner with nothing assigned). **Reset data** in the account menu restores the starting state.

## Stack

React + TypeScript, bundled with Vite. State lives in a React context store persisted to `localStorage`; in production each action becomes an API call. Light and dark themes, chosen explicitly and remembered — the OS preference is deliberately not read.

## Layout

```
src/
  main.tsx        routing and app shell
  shell.tsx       sign-in, navigation, top bar, command palette
  store.tsx       application state and every mutation
  logic.ts        derived state: ownership, risk, readiness, counts
  theme.tsx       light/dark
  demo.ts         the demo team and their work in flight
  seed.ts         the real component library and SP modules
  pages/          one file per screen
  data/           the component design library, 20 October 2026
```
