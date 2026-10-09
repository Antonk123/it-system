# Architecture decision records

One file per decision, numbered in the order they were made (`NNNN-short-title.md`) and never
renumbered. Each record has the same four parts: **Status** (with date), **Context** (what
forced a decision), **Decision** (what we do, specific enough to check against the code) and
**Consequences** (what gets easier, what gets harder, what to watch). A decision that is
reversed is not edited away: add a new record, and mark the old one `Superseded by NNNN`.
Citations point at files in this repo; broader project notes live in the Obsidian vault
(`Projekt/IT-System/decisions.md`) and should be read before recording a new ADR.

| # | Decision | Status |
|---|----------|--------|
| [0001](0001-unified-ticket-access-policy.md) | Unified ticket access policy | Accepted 2026-10-09 |
| [0002](0002-hashed-refresh-tokens-with-reuse-detection.md) | Hashed refresh tokens with reuse detection | Accepted 2026-10-09 |
| [0003](0003-iso-timestamps-written-by-app-code.md) | ISO timestamps written by app code | Accepted 2026-10-09 |
