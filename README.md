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
- Fast board in three stages: cards are laid out instantly from what was last seen; one cheap GraphQL query per 50 MRs fills approvals and statuses; discussions are loaded (5 MRs per request) only for MRs whose comments changed.

**Merge request page**
- A checklist you must tick before the **Approve** and **Merge** buttons appear.
- Checks reset automatically when new commits are pushed (can be turned off).

## Install

- Firefox: [addons.mozilla.org](https://addons.mozilla.org/) (search for "MRFlow")
- Chrome: Chrome Web Store (search for "MRFlow")

### Test a build from a pull request

Every pull request is built by CI.

1. Open the PR → **Checks** → **Build** → **Summary** and download the `mrflow-<version>-<sha>` artifact.
2. Unzip it.
3. Load it:
   - **Chrome**: `chrome://extensions` → enable *Developer mode* → *Load unpacked* → pick the unzipped folder.
   - **Firefox**: `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on…* → pick `manifest.json` in the unzipped folder.

Disable the store version while testing, otherwise both run on the page.

## Settings

Click the extension icon:
- **Approvals Needed**: how many approvals an MR needs (used by the approvals badge and the "ready" highlight).
- **Enable Kanban Board**: Kanban on the list or the native list.
- **Kanban loading**: apply API updates once per stage (default) or as soon as each batch arrives.
- **Reset approval checks on new commits**.

## Privacy

MRFlow reads data only from the GitLab API of the page you are on, using your existing GitLab session. It sends nothing anywhere else and collects no data.

## Development

No build step yet: the repository root is the unpacked extension.

```bash
./scripts/package.sh                                      # dist/extension + dist/mrflow-<version>.zip
npx web-ext lint --source-dir dist/extension              # Firefox validation
npx web-ext run --source-dir dist/extension               # run in a temporary Firefox profile
```

See [docs/ROADMAP.md](docs/ROADMAP.md) for the plan.
