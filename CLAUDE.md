# MRFlow

Browser extension (Manifest V3, Chrome + Firefox) that enhances GitLab merge request pages on gitlab.com.

## Layout
- `content_script.js`: everything that runs on GitLab pages. Routing at the bottom: MR page (`/merge_requests/<iid>`) vs MR list.
- `styles.css`: styles injected into GitLab pages.
- `popup.*`: settings popup (`storage.sync`).
- `scripts/package.sh`: builds `dist/extension` and `dist/mrflow-<version>.zip`.
- `.github/workflows/build.yml`: CI; uploads the unpacked build as an artifact on every PR.
- `docs/ROADMAP.md`: audit and plan (a rewrite to WXT + TypeScript is planned for 2.0).

## Commands
```bash
node --check content_script.js
./scripts/package.sh
npx web-ext lint --source-dir dist/extension
```

## Rules
- **UI must look native to GitLab.** Use GitLab UI / Pajamas classes (`gl-badge badge-*`, `gl-*` utilities) and `--gl-*` CSS variables so dark mode works. No hard-coded colors. Take icons from GitLab's sprite via `getIconSpriteUrl()`: the sprite URL is hashed per GitLab deploy.
- **Mind GitLab rate limits.** All API calls go through `apiFetch` (concurrency limit, short 429 `Retry-After` retried, long ones fail fast and show `showApiError`). MR details come from one GraphQL query per project and batch of iids (`MERGE_REQUESTS_QUERY`); never add per-MR requests. GraphQL POSTs must send `X-CSRF-Token`, otherwise GitLab answers as an anonymous user.
- **SPA navigation.** GitLab rewrites the URL (e.g. the list redirects to `?sort=...&state=opened`). Any code that mounts UI must be idempotent and must stop when superseded (see `g_listRunId`).
- **Do not use GitLab's class names on our own containers in a way that native selectors can match.** Prefix new classes with `mrflow-`.
- Per-MR state lives in `localStorage["<canonical MR path>/mr-utils"]` (`getCanonicalMrPath`). The extension is published, so keep stored data backward compatible or migrate it.
- Bump `version` in `manifest.json` for every release. Commits follow Conventional Commits.
