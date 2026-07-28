## What & why

<!-- What does this change do, and why is it needed? Link the related issue if there is one. -->

## How was this tested

<!-- Commands you ran, scenarios you exercised, screenshots for UI changes. -->

## Checklist

- [ ] `npm run lint` passes (root)
- [ ] Frontend typecheck passes: `npx tsc --noEmit -p tsconfig.app.json && npx tsc --noEmit -p tsconfig.node.json`
- [ ] `npm test` passes (root, vitest)
- [ ] `npm run build` succeeds (root)
- [ ] `cd server && npx tsc --noEmit` passes
- [ ] `cd server && npm test` passes
- [ ] If this changes the API surface, `npm run openapi:lint` passes
- [ ] If this changes the database schema, the migration is added to the `migrations` array in `server/src/db/migrations.ts` (not a standalone script) and `schema.sql` is kept in sync
- [ ] New functionality or bug fixes are covered by tests
- [ ] No secrets, credentials, or internal infrastructure details are included in this PR
