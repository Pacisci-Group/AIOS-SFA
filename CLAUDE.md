# CLAUDE.md — AIOS-SFA

Project context lives in `AGENTS.md` (shared with other coding agents) and is
imported below. Path-scoped and always-on rules live in `.claude/rules/`.

@AGENTS.md

## Claude Code specifics

- **Rules** (`.claude/rules/`) are the modular instruction files for this repo:
  - `legacy-sfa-reference.md` + `figma-mockups-reference.md` — always loaded; how
    to use the two read-only symlinked reference checkouts (`./SFA`,
    `./agencyops_fe_mockups`).
  - `api-bruno-docs.md` — **path-scoped**, loads only when touching
    `packages/api/src/**/*.controller.ts`, `packages/api/src/**/dto/*.ts`, or
    `packages/web/src/lib/*-api.ts`. Keep the Bruno collection in sync there.
- **Linear MCP** is available for `PAC-` issues (team Paciscigroup, project SFA) —
  read the issue before starting a sub-story rather than inferring scope.
- **Context7 MCP** is the preferred source for library/framework docs (NestJS,
  Mongoose, Tailwind 4, shadcn/ui, React Router 7, TanStack Query) — the stack
  pins recent major versions, so don't answer library questions from memory.
- Start a continuation from `docs/SESSION-HANDOFF.md`.
