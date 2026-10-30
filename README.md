# MRFlow

Browser extension that makes GitLab merge requests easier to review. Works on gitlab.com in Chrome and Firefox.

## Features

**Merge request list**
- Kanban board with three columns: **To Review**, **Pending** (you have unresolved threads) and **Approved** (you approved).
- Thread badges: resolved/total threads, and resolved/total of *your* threads.
- Approvals badge: given/required approvals.
- **CONFLICTS** and **NEEDS REBASE** banners (red: the author has to act).
- **NEW COMMITS / NEW REPLIES / NEW COMMENTS** banners since your last visit.
- Draft MRs are dimmed (hover to read), MRs that are ready to merge are highlighted.
- Cards slide to their new column when fresh data arrives.
- Fast board in three stages: cards are laid out instantly from what was last seen; one cheap GraphQL query per 50 MRs fills approvals and statuses; comments (without system notes) are loaded only for MRs never seen before (right away, in parallel) or whose comments changed.

**Merge request page**
- A checklist you must tick before the **Approve** and **Merge** buttons appear.
- Checks reset automatically when new commits are pushed (can be turned off).

**Changes tab**
- A **Viewed** checkbox on every hunk, not only on the whole file. Works with both GitLab diff renderers (Rapid Diffs and the older one), inline and side by side.
- Marks belong to the changed lines, not to line numbers: after a new push, hunks it did not change stay viewed and changed ones are cleared.
- Progress per file ("2/3 hunks") in the file header and the file tree. When every hunk of a file is viewed, GitLab's own **Viewed** checkbox of the file is ticked; unticking it clears the file's hunks.
- Viewed hunks collapse to their header (a button shows the lines again), and the **Changes** tab counts the hunks left.
- **Shift+]** / **Shift+[** go to the next / previous hunk not viewed yet (GitLab already uses `]` / `[` for files).

## Install

- Firefox: [addons.mozilla.org](https://addons.mozilla.org/) (search for "MRFlow")
- Chrome: Chrome Web Store (search for "MRFlow")

### Test a build from a pull request

Every pull request is built by CI.

1. Open the PR → **Checks** → **Build** → **Summary** and download the `mrflow-<version>-<sha>-chrome` or `-firefox` artifact.
2. Unzip it.
3. Load it:
   - **Chrome**: `chrome://extensions` → enable *Developer mode* → *Load unpacked* → pick the unzipped folder.
   - **Firefox**: `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on…* → pick `manifest.json` in the unzipped folder.

Disable the store version while testing, otherwise both run on the page.

## Settings

The extension icon opens a short panel to turn the Kanban board, the approval checklist and hunk review on or off. **All settings** opens the options page:
- **Required approvals**: from the project's approval rules (Premium), or always a fixed number; the number is also used for projects without rules.
- **Kanban board**, **Board updates** (in waves, the default, or each card as soon as it loads) and **Animate cards moving between columns** (also off when the system asks for reduced motion).
- **Approval checklist** and **Reset checks on new commits**.
- **Hunk review**, **Collapse viewed hunks** and **Keyboard shortcuts**.
- **Export / Import** settings as JSON.

Changes apply to open GitLab tabs right away. Settings from MRFlow 1.x are migrated on the first start.

## Privacy

See [PRIVACY.md](PRIVACY.md). In short: MRFlow reads data only from the GitLab API of the page you are on, using your existing GitLab session. It sends nothing anywhere else and collects no data.

## Development

Built with [WXT](https://wxt.dev) and TypeScript. Requires Node.js 22+ and pnpm 10 (`corepack enable` picks the version from `package.json`).

```bash
pnpm install
pnpm dev                      # Chrome with hot reload (pnpm dev:firefox for Firefox)
pnpm lint && pnpm typecheck && pnpm test
pnpm build && pnpm e2e         # Playwright on mock GitLab pages (first time: pnpm exec playwright install chromium)
pnpm build                    # .output/chrome-mv3 (pnpm build:firefox -> .output/firefox-mv3)
pnpm zip                      # .output/mrflow-<version>-chrome.zip
pnpm zip:firefox              # .output/mrflow-<version>-firefox.zip + .output/mrflow-<version>-sources.zip
./scripts/verify-sources.sh   # rebuilds the Firefox build from the sources zip and compares
```

### Releasing

Automated with release-please: merging the release PR publishes to the Chrome Web Store and AMO. See [docs/releasing.md](docs/releasing.md).

### Publishing to addons.mozilla.org by hand

The code is bundled, so AMO asks for the source code. On *Submit a New Version* answer **Yes** to "Do You Need to Submit Source Code?", upload `mrflow-<version>-firefox.zip` as the add-on and `mrflow-<version>-sources.zip` as the source code. Both must come from the same `pnpm zip:firefox` run (CI uploads both as artifacts). The reviewer builds it with the steps below.

## Building from source

These steps rebuild the Firefox add-on from the sources zip exactly (CI checks this on every PR with `scripts/verify-sources.sh`).

Environment: Linux or macOS (CI uses Ubuntu); [Node.js](https://nodejs.org) 22 or newer; pnpm 10.28.0 (`npm install -g pnpm@10.28.0`, or `corepack enable`).

```bash
pnpm install --frozen-lockfile
pnpm build:firefox
```

The add-on is in `.output/firefox-mv3`. The output is not minified. Third-party code in it: [WXT](https://wxt.dev) (the `browser` API shim and `defineContentScript`), [Vue](https://vuejs.org) (popup and options page), GitLab's design tokens from [`@gitlab/ui`](https://www.npmjs.com/package/@gitlab/ui) (CSS only) and the GitLab Sans font from [`@gitlab/fonts`](https://www.npmjs.com/package/@gitlab/fonts). Everything else is in `src/`.

See [docs/ROADMAP.md](docs/ROADMAP.md) for the plan.
