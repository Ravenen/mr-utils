# MRFlow

Browser extension (Manifest V3, Chrome + Firefox) that enhances GitLab merge request pages on gitlab.com.

## Layout
Built with WXT (Vite) + TypeScript, pnpm. Source in `src/`, output in `.output/`.
- `src/entrypoints/gitlab.content/`: content script for GitLab pages (`index.ts` + injected `style.css`).
- `src/legacy/content-script.js`: the 1.x content script ported as is, being split into features (2.0). Routing at the bottom: MR page (`/merge_requests/<iid>`) vs MR list.
- `src/utils/`: pure helpers with Vitest tests next to them (`*.test.ts`).
- `src/entrypoints/popup/`: settings popup (`storage.sync`).
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
- **Mind GitLab rate limits.** All API calls go through `apiFetch` (concurrency limit, short 429 `Retry-After` retried, long ones fail fast and show `showApiError`). MR details come from GraphQL per project and batch of iids: `MERGE_REQUESTS_QUERY` (cheap, no comments) and `MERGE_REQUESTS_NOTES_QUERY` (`notes(filter: ONLY_COMMENTS)`, so system notes are skipped; only for MRs never seen or whose `getActivityKey` changed since the last stored record, batched by comment count); never add per-MR requests. GraphQL POSTs must send `X-CSRF-Token`, otherwise GitLab answers as an anonymous user.
- **SPA navigation.** GitLab rewrites the URL (e.g. the list redirects to `?sort=...&state=opened`). Any code that mounts UI must be idempotent and must stop when superseded (see `g_listRunId`).
- **Do not use GitLab's class names on our own containers in a way that native selectors can match.** Prefix new classes with `mrflow-`.
- The last shown data per MR is stored in `localStorage["mr-utils/mr/<user>/<project>/<iid>"]` (pruned after 30 days) and lays out the board before the API answers.
- Per-MR state lives in `localStorage["<canonical MR path>/mr-utils"]` (`getCanonicalMrPath`). The extension is published, so keep stored data backward compatible or migrate it.
- **AMO needs the source code** because the output is bundled: every Firefox release uploads `mrflow-<version>-sources.zip` next to the add-on. Keep the build reproducible from that zip (no absolute paths or timestamps in the output, pnpm pinned via `packageManager`, `pnpm-lock.yaml` committed), keep the output unminified, and keep README "Building from source" accurate. CI checks it with `scripts/verify-sources.sh`.
- Bump `version` in `package.json` for every release. Commits follow Conventional Commits.
