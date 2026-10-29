# MRFlow

Browser extension (Manifest V3, Chrome + Firefox) that enhances GitLab merge request pages on gitlab.com.

## Layout
Built with WXT (Vite) + TypeScript, pnpm. Source in `src/`, output in `.output/`.
- `src/entrypoints/gitlab.content/`: content script for GitLab pages (`index.ts` + injected `style.css`); only starts the features.
- `src/core/router.ts`: `parseRoute` (MR list by scope, MR page and tab, other) and `watchUrl` (SPA navigation).
- `src/core/lifecycle.ts`: `Feature { name, match(route), settings?, mount(ctx) }` and `startFeatures`. Features remount when the route key changes (a list: any filter/sort/page; an MR: not on tab switches), and when a setting listed in `settings` changes (only that feature). `ctx.cache` lives as long as the page, so a remount after a settings change reuses data instead of requesting it again.
- `src/features/`: the registry (`index.ts`); `mr-list/` (Kanban laid over the native list in `board.ts`, badges and banners in `decorate.ts`), `mr-page/` (seen state, approval guard).
- `src/core/gitlab/`: `api.ts` (`createGitLabApi`: limiter, retries, shared GraphQL requests; one instance per page), `queries.ts` (GraphQL queries and response types), `merge-requests.ts` (the three loading stages, `computeActivity`, `processMRData`). No DOM access here; tests count the requests per scenario.
- `src/core/storage/`: `mr-records.ts` (last shown data per MR), `mr-state.ts` (per-MR state).
- `src/core/settings/`: `schema.ts` (versioned `Settings`, `normalizeSettings`, `migrateSettings` from the 1.x flat keys, `requiredApprovals`), `store.ts` (`storage.sync` key `settings`, `watchSettings`, import/export). A feature remounts only when a setting it lists changes.
- `src/core/gitlab/dom.ts`: every GitLab selector, stable hooks (`data-testid`, `js-` classes) first with fallbacks to older markup.
- `src/ui/`: native components (`badge.ts`, `alert.ts`, `checkbox.ts`, `spinner.ts`, `icons.ts`).
- `src/test/fixtures.ts`: GitLab markup trimmed from GitLab's own components, a fake API and a feature context for tests.
- `src/utils/`: pure helpers with Vitest tests next to them (`*.test.ts`).
- `src/entrypoints/popup/`, `src/entrypoints/options/`: Vue 3 pages (feature toggles; all settings). `src/components/`: shared Vue components, `useSettings`, and `pajamas.css` (GitLab's design tokens from `@gitlab/ui` and Pajamas-like controls; dark mode via `html.gl-dark`).
- `public/`: icons, copied as is. The manifest is generated from `wxt.config.ts` and `package.json` (version).
- `scripts/verify-sources.sh`: rebuilds the Firefox build from the AMO sources zip and diffs it.
- `.github/workflows/build.yml`: CI; lint, typecheck, tests, both builds, sources check; uploads the builds and the AMO sources zip on every PR.
- `docs/ROADMAP.md`: audit and plan (2.0 = rewrite to WXT + TypeScript, in progress).

## Commands
```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
pnpm build && pnpm build:firefox
pnpm zip:firefox && ./scripts/verify-sources.sh
pnpm exec web-ext lint --source-dir .output/firefox-mv3
```

## Rules
- **UI must look native to GitLab.** Use GitLab UI / Pajamas classes (`gl-badge badge-*`, `gl-*` utilities) and `--gl-*` CSS variables so dark mode works. No hard-coded colors. Take icons from GitLab's sprite via `getIconSpriteUrl()`: the sprite URL is hashed per GitLab deploy.
- **Mind GitLab rate limits.** All API calls go through `ctx.api` (`src/core/gitlab/api.ts`: concurrency limit, short 429 `Retry-After` retried, long ones fail fast and show `showApiError`; identical GraphQL requests in flight are shared). MR details come from GraphQL per project and batch of iids: `MERGE_REQUESTS_QUERY` (cheap, no comments) and `MERGE_REQUESTS_NOTES_QUERY` (`notes(filter: ONLY_COMMENTS)`, so system notes are skipped; only for MRs never seen or whose `getActivityKey` changed since the last stored record, batched by comment count); never add per-MR requests. GraphQL POSTs must send `X-CSRF-Token`, otherwise GitLab answers as an anonymous user.
- **SPA navigation and lifecycle.** GitLab rewrites the URL (e.g. the list redirects to `?sort=...&state=opened`). A feature keeps no module state: everything lives in `mount(ctx)`. Pass `ctx.signal` to every request and wait, check it after every await, and remove everything you add to the page in `ctx.onCleanup`, so mounting again is idempotent.
- **GitLab selectors live only in `src/core/gitlab/dom.ts`.** Prefer `data-testid` and check GitLab's source for it; keep a fallback for the older markup and cover both in `dom.test.ts`. No text matching (GitLab is localized).
- **No inline styles** (`el.style`, `style=`): add a `mrflow-` class in `style.css`, or use `gl-*` utilities. Web Animations are fine.
- **Do not use GitLab's class names on our own containers in a way that native selectors can match.** Prefix new classes with `mrflow-`.
- **GitLab's elements belong to its Vue.** Never clone, move or remove them: hide them (`data-mrflow-replaced`) and lay them out with CSS (the board is the native `<ul>` as a grid). Mark state on them with `data-mrflow-*` attributes, not classes (Vue rewrites `class`). GitLab may re-create them at any time, so match them to data by MR key and re-apply on list changes.
- The last shown data per MR is stored in `localStorage["mr-utils/mr/<user>/<project>/<iid>"]` (pruned after 30 days) and lays out the board before the API answers.
- **Settings are versioned** (`SETTINGS_VERSION`): a new field gets a default in `normalizeSettings`; a changed meaning bumps the version and adds a step to `migrateSettings`, with a test.
- Per-MR state lives in `localStorage["<canonical MR path>/mr-utils"]` (`getCanonicalMrPath`). The extension is published, so keep stored data backward compatible or migrate it.
- **AMO needs the source code** because the output is bundled: every Firefox release uploads `mrflow-<version>-sources.zip` next to the add-on. Keep the build reproducible from that zip (no absolute paths or timestamps in the output, pnpm pinned via `packageManager`, `pnpm-lock.yaml` committed), keep the output unminified, and keep README "Building from source" accurate. CI checks it with `scripts/verify-sources.sh`.
- Bump `version` in `package.json` for every release. Commits follow Conventional Commits.
