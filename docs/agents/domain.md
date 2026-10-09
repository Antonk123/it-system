# Domain Docs

## Layout

This is a single-context repository:

- `GLOSSARY.md` at the repository root.
- Architecture decision records in `docs/adr/` (index in `docs/adr/README.md`; currently
  0001 ticket access policy, 0002 hashed refresh tokens, 0003 ISO timestamps).

The frontend and backend share this domain documentation.

## Before exploring

Read `GLOSSARY.md` and ADRs relevant to the work.

If a file you expect is missing, proceed silently. Do not suggest
creating placeholders. The domain-modeling skill creates glossary
terms and ADRs when terms or decisions are resolved; new ADRs follow
the format described in `docs/adr/README.md` and get the next number.

## Vocabulary and decisions

Use the glossary's terms in issues, proposals, hypotheses, and tests.
If a concept is missing, reconsider the wording or record the gap
for domain-modeling.

Explicitly flag proposals that contradict an existing ADR.

## Relationship to Obsidian

The glossary and ADRs are repo-local inputs for engineering skills.
Other project notes, lessons, and documentation remain in
`~/Obsidian/Projekt/IT-System/`.

Consult relevant existing Obsidian decisions before recording ADRs.
Do not migrate or duplicate the vault during setup.
