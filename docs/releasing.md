# Releasing

## How a release happens

1. Commits on `main` follow [Conventional Commits](https://www.conventionalcommits.org). `feat` makes a minor release, `fix` and `perf` a patch, `feat!` or a `BREAKING CHANGE:` footer a major one. A `Release-As: x.y.z` footer forces a version.
2. The **Release** workflow keeps a release PR open: it bumps `version` in `package.json` (the manifest takes it from there) and adds the changes to `CHANGELOG.md`.
3. Merging the release PR tags `vX.Y.Z` and creates the GitHub release. The same workflow then:
   - runs lint, typecheck and tests, builds and zips both browsers;
   - checks that the AMO sources zip rebuilds the Firefox build (`scripts/verify-sources.sh`);
   - attaches `mrflow-X.Y.Z-chrome.zip`, `-firefox.zip` and `-sources.zip` to the GitHub release;
   - submits to the Chrome Web Store and to AMO, with the sources zip.

To submit an existing release again (for example after adding credentials), run **Release** manually with its tag. Leave **dry_run** on to only check the credentials.

## Store credentials

Set them in the repository: **Settings → Secrets and variables → Actions**. Without them, the release still happens and the stores are skipped with a warning.

### Chrome Web Store (API v2, service account)

1. In Google Cloud, create a project, enable the **Chrome Web Store API** and create a service account with a JSON key.
2. In the Chrome Web Store developer dashboard, **Account → Service accounts**, add the service account's email.
3. Variables: `CHROME_EXTENSION_ID` (the item ID from the dashboard), `CHROME_PUBLISHER_ID` (the publisher ID from the dashboard URL).
4. Secrets: `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL` and `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` (`client_email` and `private_key` from the JSON key).

### addons.mozilla.org

1. Create API credentials at https://addons.mozilla.org/developers/addon/api/key/.
2. Secrets: `FIREFOX_JWT_ISSUER` and `FIREFOX_JWT_SECRET`.

The add-on ID is in `wxt.config.ts` (`browser_specific_settings.gecko.id`).

## Store listing

Kept here so that both stores say the same thing.

**Single purpose (Chrome Web Store):** Makes reviewing GitLab merge requests easier: a Kanban board of merge requests by review state, thread and approval badges, and a checklist before approving.

**Permissions:**

| Permission | Why |
|---|---|
| `storage` | Keeps the extension's settings (Kanban on or off, required approvals, checklist options). |
| Content script on `*://*.gitlab.com/*/merge_requests*` | Adds the board, badges and checklist to GitLab merge request pages, and reads merge request details from the GitLab API of the same page with the user's session. |

**Remote code:** none. All code is in the package.

**Data use (Chrome Web Store) / data collection (AMO, `data_collection_permissions: none`):** the extension collects and transmits no user data. Privacy policy: [`PRIVACY.md`](../PRIVACY.md) (for the store form: https://github.com/Ravenen/mr-utils/blob/main/PRIVACY.md).

**Notes for AMO reviewers:** the code is bundled with WXT (Vite) and not minified. Build instructions are in the README of the sources zip, "Building from source": `pnpm install --frozen-lockfile && pnpm build:firefox`, output in `.output/firefox-mv3`. Vue's runtime (options page and popup) sets `innerHTML` for static template content; MRFlow's templates use no `v-html`.

**Assets:** icons 16, 32, 48, 96, 128 in `public/icons/`. Still needed for the Chrome Web Store: screenshots 1280×800 and a 440×280 promo tile (#20).
