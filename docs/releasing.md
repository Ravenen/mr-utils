# Релізи

## Коротко

Реліз — це злиття **release PR**. Версію руками не піднімаємо, теги руками не ставимо, zip у магазини руками не завантажуємо.

```
коміти в main ──► release PR (оновлюється сам) ──► злиття ──► тег vX.Y.Z + GitHub Release
                                                          └─► збірка ──► Chrome Web Store і AMO (рев'ю магазинів)
```

## Як це працює

1. **Коміти в `main`** мають формат [Conventional Commits](https://www.conventionalcommits.org). Від типу комітів залежить нова версія:
   - `fix:`, `perf:` → патч (2.0.0 → 2.0.1);
   - `feat:` → мінорна (2.0.0 → 2.1.0);
   - `feat!:` або футер `BREAKING CHANGE:` → мажорна (2.0.0 → 3.0.0);
   - футер `Release-As: x.y.z` задає версію явно (так перший реліз стане 2.0.0);
   - `docs:`, `test:`, `ci:`, `chore:` версію не змінюють і в CHANGELOG не потрапляють.
2. **Release PR.** Після кожного пушу в `main` workflow **Release** (`.github/workflows/release.yml`) запускає [release-please](https://github.com/googleapis/release-please). Той відкриває або оновлює PR з назвою на кшталт `chore(main): release 2.0.0`. У ньому:
   - `version` у `package.json` (manifest бере версію звідти);
   - нові записи в `CHANGELOG.md`, згруповані за типом комітів;
   - `.release-please-manifest.json` з новою версією.

   Поки PR не злитий, кожен новий коміт у `main` додається до нього, а версія за потреби перераховується. Release PR — це просто «кошик» змін до наступного релізу.
3. **Злиття release PR — це і є реліз.** Той самий workflow:
   - ставить тег `vX.Y.Z` і створює GitHub Release з текстом із CHANGELOG;
   - запускає lint, typecheck і тести, збирає Chrome і Firefox;
   - перевіряє, що sources zip відтворює Firefox-збірку (`scripts/verify-sources.sh`);
   - прикріплює до GitHub Release `mrflow-X.Y.Z-chrome.zip`, `-firefox.zip` і `-sources.zip`;
   - відправляє версію в Chrome Web Store і в AMO (разом із sources zip). Далі в магазинах триває звичайне рев'ю, після якого версія публікується.

Якщо ключів магазинів немає, кроки 1–3 все одно відбуваються, лише відправку в магазини буде пропущено з попередженням у логах. Тоді zip можна взяти з GitHub Release і завантажити вручну.

## Що треба зробити, щоб випустити реліз

**Щоразу:**
1. Злити в `main` PR з потрібними змінами.
2. Відкрити release PR (його створює `github-actions`), переглянути версію і CHANGELOG.
3. Злити release PR.
4. За кілька хвилин перевірити: вкладка **Actions** → **Release** зелений, у **Releases** з'явилась версія з трьома zip, у дашбордах магазинів нова версія стоїть на рев'ю.

**Один раз (налаштування):**
1. Дозволити GitHub Actions створювати PR: репозиторій → **Settings** → **Actions** → **General** → **Workflow permissions** → увімкнути **Allow GitHub Actions to create and approve pull requests** → **Save**. Без цього release-please не відкриє release PR.
2. Додати ключі магазинів (нижче).
3. Перевірити ключі ще до першого релізу (нижче, «Перевірка без релізу»).

## Ключі магазинів

Усі значення додаються в репозиторій: **Settings** → **Secrets and variables** → **Actions**.
- Вкладка **Secrets** → **New repository secret**: те, що не можна показувати (ключі).
- Вкладка **Variables** → **New repository variable**: ідентифікатори, які не є секретом.

| Назва | Тип | Звідки |
|---|---|---|
| `CHROME_EXTENSION_ID` | Variable | ID розширення в Chrome Web Store |
| `CHROME_PUBLISHER_ID` | Variable | ID видавця в Chrome Web Store |
| `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL` | Secret | `client_email` з JSON-ключа сервісного акаунта Google |
| `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` | Secret | `private_key` з того самого JSON |
| `FIREFOX_JWT_ISSUER` | Secret | «JWT issuer» з AMO |
| `FIREFOX_JWT_SECRET` | Secret | «JWT secret» з AMO |

ID аддону для Firefox уже в коді (`wxt.config.ts`, `browser_specific_settings.gecko.id`), окремо його задавати не треба.

### Chrome Web Store

Chrome Web Store API v2 авторизується через **сервісний акаунт Google Cloud**. Це окремий «робот-акаунт», якому в дашборді магазину дають право публікувати. Офіційна інструкція Google: https://developer.chrome.com/docs/webstore/service-accounts. Назви пунктів меню в консолях Google іноді змінюються; якщо щось не збігається, звіряйтесь з нею.

**1. `CHROME_PUBLISHER_ID` і `CHROME_EXTENSION_ID`**
1. Відкрити дашборд розробника: https://chrome.google.com/webstore/devconsole.
2. Якщо видавців кілька, вибрати того, від імені якого опубліковано MRFlow.
3. **Publisher ID** — частина адреси після `devconsole/`: `https://chrome.google.com/webstore/devconsole/<publisher-id>/...`.
4. Відкрити MRFlow у списку **Items**. **Item ID** (32 літери `a`–`p`) — у адресі після `.../<publisher-id>/` і на сторінці товару; це ж ID є в адресі сторінки MRFlow у Chrome Web Store (`chromewebstore.google.com/detail/mrflow/<item-id>`). Це `CHROME_EXTENSION_ID`.

**2. Проєкт Google Cloud і API**
1. Відкрити https://console.cloud.google.com під тим самим Google-акаунтом.
2. Зверху вибір проєкту → **New Project** → назва, наприклад `mrflow-release` → **Create**. Переконатися, що вибрано цей проєкт.
3. **APIs & Services** → **Library** → знайти **Chrome Web Store API** → **Enable**.

**3. Сервісний акаунт і ключ**
1. **IAM & Admin** → **Service Accounts** → **Create service account**.
2. Назва, наприклад `mrflow-publisher` → **Create and continue**. Ролі в Google Cloud не потрібні: права на публікацію дає дашборд магазину → **Done**.
3. Відкрити створений акаунт → вкладка **Keys** → **Add key** → **Create new key** → **JSON** → **Create**. Браузер завантажить JSON-файл. Це єдина копія ключа: зберігати надійно, нікуди не комітити.
   - Якщо Google не дає створити ключ (помилка про політику `iam.disableServiceAccountKeyCreation`), цю політику організації треба вимкнути для проєкту: **IAM & Admin** → **Organization Policies**. Для особистого акаунта без організації такого обмеження зазвичай немає.
4. Відкрити JSON у текстовому редакторі:
   - значення `client_email` (на кшталт `mrflow-publisher@mrflow-release.iam.gserviceaccount.com`) → секрет `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL`;
   - значення `private_key` (від `-----BEGIN PRIVATE KEY-----` до `-----END PRIVATE KEY-----\n`) → секрет `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY`. Копіювати без лапок навколо. `\n` усередині можна лишити як є: workflow перетворює їх на переноси рядків.

**4. Дати сервісному акаунту право публікувати**
1. Повернутися в дашборд: https://chrome.google.com/webstore/devconsole → той самий видавець.
2. **Account** (налаштування акаунта видавця) → розділ **Service accounts** → додати `client_email` сервісного акаунта → зберегти.

### addons.mozilla.org (Firefox)

1. Увійти на https://addons.mozilla.org під акаунтом, якому належить MRFlow (власник або розробник аддону).
2. Відкрити https://addons.mozilla.org/developers/addon/api/key/ (**Developer Hub** → **Tools** → **Manage API Keys**).
3. Якщо попросить, прийняти угоду для розробників.
4. **Generate new credentials**. З'являться два значення:
   - **JWT issuer** (на кшталт `user:12345678:123`) → секрет `FIREFOX_JWT_ISSUER`;
   - **JWT secret** (довгий рядок) → секрет `FIREFOX_JWT_SECRET`. Його показують лише раз; якщо загубити, доведеться згенерувати нову пару (стара перестане працювати).

На AMO workflow сам відповідає «так» на питання про вихідний код: разом з аддоном він завантажує `mrflow-X.Y.Z-sources.zip`.

## Перевірка без релізу

Ключі можна перевірити до першого релізу, нічого не завантажуючи:
1. **Actions** → **Release** → **Run workflow**.
2. Поле **tag**: `main` (або тег уже випущеного релізу, наприклад `v2.0.0`).
3. **dry_run** лишити увімкненим → **Run workflow**.

Workflow збере розширення і перевірить авторизацію в обох магазинах (`wxt submit --dry-run`), нічого не відправивши. Якщо для магазину немає ключів, у логах буде попередження, а не помилка.

Повторно відправити вже випущену версію (наприклад, якщо ключі додали після релізу): той самий запуск з тегом цієї версії і вимкненим **dry_run**.

## Тексти для магазинів

Зберігаються тут, щоб в обох магазинах було однаково.

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
