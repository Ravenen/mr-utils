# MRFlow: аудит і план розвитку

Документ підсумовує стан розширення на версії 1.4.1 (останній коміт: вересень 2025) і пропонує, що робити далі.
Посилання на рядки вказані для `content_script.js` і `styles.css` у цій версії.

---

## 1. Що є зараз

| Частина | Що робить | Як зроблено |
|---|---|---|
| Kanban на списку MR | Розкладає MR у три колонки: To Review / Pending / Approved | Клонує `<li>` GitLab, а оригінальний список ховає за екраном (`left:-9999px`) |
| Бейджі | Треди `resolved/total`, «ваші треди», апруви `given/required` | На кожен MR робить 4+ REST-запити |
| Банери | NEW COMMITS / NEW REPLIES / NEW COMMENTS | Порівнює з лічильниками в `localStorage` |
| Захист апруву | Ховає кнопку Approve і merge-бар, доки не відмічено 2 захардкоджені галочки | `setInterval` раз на 100 мс плюс ланцюжки `parentElement` |
| Popup | Налаштування `approvalsNeeded` і `kanbanView` | `storage.sync` |

Немає збірки, тестів, лінтера, README, LICENSE, CHANGELOG і issues. Версію піднімали вручну окремими комітами.

---

## 2. Баги

### 2.1 Критичні

**B1. Колонки вкладаються одна в одну (скріншот).**
Причина: між двома запусками `mergeRequestsList()` виникає гонка, а селектор контейнера ловить вузли самого розширення.
1. Сторінка відкривається на `/merge_requests`, і стартує перший `mergeRequestsList()`. Він чекає `initData()` і запит `/api/v4/user`.
2. GitLab робить `history.replaceState` на `?sort=created_date&state=opened&first_page_size=100`. MutationObserver помічає зміну URL і викликає `onUrlChange()`. `cleanupBoard()` нічого не прибирає, бо `g_currentBoard` ще `null`. Стартує **другий** `mergeRequestsList()`.
3. Перший запуск створює дошку. Її `<ul>` мають клас `content-list` (рядок 95).
4. Другий запуск шукає контейнер через `document.querySelector(".content-list, .issues-list")` (рядок 102). Першим за порядком у DOM знаходиться `ul.content-list` колонки «To Review» першої дошки, і другу дошку вставлено всередину неї.
5. `g_currentBoard` перезаписується, тому першу дошку вже ніхто не прибере.

Виправлення:
- скасовувати попередній запуск через `AbortController` або лічильник поколінь;
- не давати своїм контейнерам класи GitLab, а в селекторах виключати власний корінь (`:not(.mrflow-board *)`);
- монтувати ідемпотентно: якщо дошка вже є, оновити її, а не створювати нову.

**B2. Забагато запитів, через що спрацьовують нові рейтліміти GitLab.**
На кожен MR у списку йде `GET /merge_requests/:iid`, N сторінок `/discussions`, `/approvals` і `/commits`. Усі запити стартують паралельно, без ліміту одночасних. При `first_page_size=100` це щонайменше 400 запитів за одне відкриття сторінки, і нічого не кешується. Плюс `/api/v4/user` при кожній ініціалізації. На сторінці MR будь-який клік по будь-якій кнопці (рядок 546) запускає `updateSavedData()`, а це ще 4+ запити.
Виправлення див. у розділі 4.2: один GraphQL-запит на сторінку, кеш, обробка 429.

**B3. Кількість комітів ніколи не перевищує 20.**
`/commits` запитується без пагінації, а за замовчуванням `per_page=20`. Для MR з більш ніж 20 комітами `commitsNumber` завжди дорівнює 20, і банер NEW COMMITS перестає з'являтися.
Виправлення: брати `commitCount` з GraphQL, або `diff_refs`/`sha` і порівнювати HEAD SHA замість кількості. Порівнювати SHA надійніше, бо force-push не змінює кількість комітів.

**B4. Стан «переглянуто» і галочки прив'язані до неправильного ключа.**
Ключ будується з `g_url = location.pathname`, тобто `/…/merge_requests/123`, `/…/merge_requests/123/diffs` і `/…/123/commits` дають три різні ключі.
- Якщо відкрити MR одразу на вкладці Changes, галочки, відмічені на Overview, зникають.
- Список читає ключ із `web_url` (без `/diffs`), тому після візиту на `/diffs` банери не скидаються.
- До того ж `g_url` — константа, обчислена при завантаженні. SPA-навігація зі списку на MR (і назад) обробляється як «список».

Виправлення: ключ `host + projectId + iid`, а маршрут визначати на кожну навігацію.

**B5. Синтаксична помилка в CSS.**
`styles.css:50` містить зайве ` */` поза коментарем. Через це парситься селектор `*/ .mr-card > .issuable-info-container`, він невалідний, і правило з рядка 53 повністю відкидається браузером.

### 2.2 Середні

| # | Проблема | Де |
|---|---|---|
| B6 | Якщо в списку 0 MR, `while (querySelectorAll('.merge-request').length === 0) sleep(50)` крутиться вічно | 136–142 |
| B7 | На MR без кнопки Approve (власний, змерджений, без прав) `setInterval(100ms)` ніколи не зупиняється | 554 |
| B8 | Захардкоджений хеш спрайта `/assets/icons-8791a…svg`. Ламається після кожного деплою GitLab і на self-hosted | 306 |
| B9 | `cloneNode` не переносить Vue-обробники. Поповери користувачів, тултіпи й лейбли в клонах не працюють, а `onclick = link.onclick` нічого не дає | 315–331 |
| B10 | `NEW REPLIES` рахує відповіді лише в **нерозв'язаних** тредах. Коли тред закривають, кількість падає, і `!=` показує хибний банер. Те саме з видаленими коментарями. Треба порівнювати `>` або, краще, `updated_at`/ID останньої ноти | 269–277, 390–398 |
| B11 | Для MR, які ще ніколи не відкривали, `undefined != N` показує всі банери одразу | 269 |
| B12 | `Promise.all` по всіх MR: один повільний або впалий MR блокує рендер усіх. Помилки 429/5xx мовчки дають `{}`, і MR потрапляє в «To Review» з `0/3` | 174, 367–374 |
| B13 | Перевірка `textContent.includes("Revoke approval\n")` працює лише з англійською локаллю, а merge-бар шукається через `parentElement ×3` | 507, 562 |
| B14 | Галочки не скидаються після нових комітів: відмітив тиждень тому, і можна апрувити новий код | `createCheck` |
| B15 | Popup: `NaN` при порожньому полі, зміни застосовуються лише після перезавантаження сторінки (немає `storage.onChanged`), підтримується тільки `*.gitlab.com` | `popup.js` |
| B16 | Пагінація і фільтри у списку перерендерюються Vue. Клони на дошці лишаються застарілими, бо реакція є тільки на зміну URL, а не на зміну DOM | — |
| B17 | `.dimmed > div { opacity: 0.1 }`: драфт майже невидимий і нечитабельний. Нативний GitLab просто приглушує | `styles.css:92` |

### 2.3 Що перевірити

- **Firefox MV3**: `fetch` із content script у Firefox має інший principal. Треба перевірити, чи йдуть cookies на `/api/v4` без `host_permissions` (можливо, доведеться перенести запити в background або використати `content.fetch`).
- **AMO**: для нових сабмітів Firefox тепер вимагає `browser_specific_settings.gecko.data_collection_permissions`. Додати `strict_min_version`.
- **Нові diffs у GitLab (Rapid Diffs)**: GitLab переписує сторінку змін, і DOM там інший. Це критично для фічі «переглянуті блоки» (див. 5.3).

---

## 3. Архітектура: проблеми

1. **Один файл на 586 рядків**: глобальні змінні `g_*`, вкладені функції, змішані DOM, API, стан і стилі.
2. **Немає життєвого циклу**: нічого не вміє коректно розмонтуватися, звідси B1, B6, B7 і B16.
3. **Крихкі селектори розкидані по коду.** Коли GitLab щось змінить, доведеться шукати по всьому файлу.
4. **Стан в `localStorage` сторінки**: він не синхронізується між пристроями, його чистить сам GitLab або користувач, і немає схеми чи міграцій.
5. **Kanban через клонування й приховування**: це протистояння з Vue, а не співпраця з ним.
6. **Інлайн-стилі** (`style.marginTop = "10px"`) замість класів GitLab, тому вигляд не нативний.

---

## 4. Пропонована архітектура

### 4.1 Стек і структура

- **[WXT](https://wxt.dev)** (Vite + TypeScript) як фреймворк для розширень: один код дає збірки під Chrome MV3 і Firefox, з hot reload, `wxt zip` і `wxt submit` для публікації в обидва магазини.
- **TypeScript strict**, ESLint, Prettier.
- UI налаштувань: **Vue 3**, бо GitLab сам на Vue і стилі Pajamas переносяться найлегше. Альтернатива — vanilla або Preact, якщо хочеться мінімальний бандл.
- **Vitest** для чистої логіки, **Playwright** для e2e на збережених HTML-фікстурах сторінок GitLab (і опційно smoke-тест на живому gitlab.com з тестовим акаунтом).

```
src/
  entrypoints/
    gitlab.content.ts        # один content script: роутер + реєстр фіч
    background.ts            # (опційно) API-кеш, повідомлення, self-hosted
    options/                 # повноцінна сторінка налаштувань (Vue)
    popup/                   # коротка панель: вкл/викл фіч, посилання на options
  core/
    router.ts                # визначає сторінку на кожну SPA-навігацію
    lifecycle.ts             # Feature { match, mount(ctx), unmount() }, AbortSignal
    gitlab/
      graphql.ts             # клієнт + батчинг + ретраї з Retry-After
      queries/*.graphql
      dom.ts                 # УСІ селектори GitLab в одному місці, з фолбеками
      icons.ts               # шлях до спрайта береться з існуючого <use href>
    storage/
      settings.ts            # типізована схема + версія + міграції
      seen-state.ts          # «переглянуто» для MR/hunks (storage.local, з TTL)
  features/
    mr-list-kanban/
    mr-list-badges/          # треди, апруви, rebase, conflicts
    mr-seen-banners/
    approval-guard/          # галочки, рівні підтвердження
    hunk-review/
  ui/                        # нативні «gl»-компоненти: badge, checkbox, modal, alert
```

Кожна фіча — модуль з `mount(ctx)` і `unmount()`. Роутер при кожній навігації скасовує `AbortSignal` попередньої сторінки й монтує фічі, які підходять. Це структурно закриває B1, B6, B7 і B16.

### 4.2 Робота з API (B2, B3, B12)

- **Один GraphQL-запит на сторінку списку** (по групах проєктів): `project(fullPath) { mergeRequests(iids: [...]) { … } }` з полями
  `iid draft detailedMergeStatus shouldBeRebased conflicts commitCount diffHeadSha userNotesCount approved approvalsLeft approvalsRequired approvedBy { nodes { id } } resolvableDiscussionsCount resolvedDiscussionsCount discussions { nodes { resolved resolvable notes(first:1) { nodes { author { id } } } } }`.
  Для дашборда `/dashboard/merge_requests` групувати iid за проєктом і робити по запиту на проєкт, або взяти `currentUser.reviewRequestedMergeRequests`. Набір полів звірити з GraphQL Explorer для поточної версії GitLab.
- `currentUser { id }` кешувати в `storage.session` (не запитувати при кожній навігації).
- **Кеш** за `iid + updatedAt`: повторний візит на список нічого не перевантажує, якщо MR не змінився.
- **Обмежувач**: не більше 2–4 одночасних запитів, експоненційний бекоф і повага до `Retry-After` при 429. Рендер інкрементальний: кожен MR оновлюється, щойно прийшли його дані.
- На сторінці MR оновлювати стан «переглянуто» не на кожен клік, а за подіями: відкриття, `visibilitychange`, ручна дія.
- Новизну визначати за `diffHeadSha` і ID/часом останньої ноти, а не за кількостями (B3, B10).

### 4.3 Kanban без клонування (B9, B16)

Варіант A (рекомендований): **CSS Grid поверх нативного `<ul>`**. Список лишається тим самим, Vue-вузлом GitLab. Розширення додає `data-mrflow-column="review|pending|approved"` на кожен `<li>`, а `ul` отримує `display:grid; grid-template-columns: repeat(3, 1fr)` і `grid-column` за атрибутом. Заголовки колонок — окремі елементи над списком. Усі поповери, тултіпи й посилання працюють нативно, а MutationObserver на `ul` підхоплює перерендери (пагінацію, фільтри).

Варіант B: власні картки, відрендерені з даних GraphQL. Це повний контроль, але доведеться перемальовувати все нативне.

Додатково: колонка або фільтр «Мої MR» (зараз мої MR потрапляють у To Review), налаштовувані правила розподілу по колонках, повернення в To Review після нових комітів, якщо апрув скинуто.

### 4.4 Налаштування й міграції

- Схема налаштувань з `version`. Міграція з `approvalsNeeded`/`kanbanView` і старих `localStorage["…/mr-utils"]`.
- `storage.sync` для налаштувань (ліміт 100 КБ, 8 КБ на ключ, тож чекліст зберігати окремими ключами), `storage.local` для стану «переглянуто».
- Імпорт і експорт JSON.
- **Командний конфіг з репозиторію**: опційний файл `.gitlab/mrflow.json` у проєкті, який читається через API. Чекліст стає спільним для команди й версіонується разом із кодом.
- `storage.onChanged`: зміни застосовуються без перезавантаження.
- Підтримка self-hosted GitLab через `optional_host_permissions` і `scripting.registerContentScripts`.
- Кількість потрібних апрувів брати з GitLab (`approvalsRequired`/`approvalsLeft`), а глобальне число лишити як фолбек або override.

---

## 5. Фічі

### 5.1 Налаштовувані галочки для злиття

Модель:
```ts
interface ChecklistItem {
  id: string;
  text: string;                 // підтримка markdown-посилань
  description?: string;
  required: boolean;            // обов'язкова чи інформаційна
  resetOn: 'never' | 'newCommits' | 'always';
  when?: {                      // умовні правила
    projects?: string[];        // glob: "group/*"
    targetBranches?: string[];  // "main", "release/*"
    labels?: string[];
    changedPaths?: string[];    // "migrations/**" → «чи є rollback-міграція?»
    authorIsMe?: boolean;
  };
}
```
- Редактор в options page: додати, перетягнути для порядку, дублювати, вмикати й вимикати.
- Пресети: «Документація», «Цільова гілка», «Міграції», «Changelog».
- Стан галочок прив'язаний до `projectId + iid` і, залежно від `resetOn`, до `diffHeadSha`.
- UI на сторінці MR — нативний `gl-form-checkbox` у секції approvals з прогресом «2/4».

### 5.2 Рівні підтвердження

Окремо для **Approve** і для **Merge**, з налаштуванням на правило або проєкт:

| Рівень | Поведінка |
|---|---|
| `off` | Нічого не робить |
| `checklist` | Кнопка неактивна (disabled + тултіп «Виконайте чекліст»), доки не відмічено обов'язкові пункти. Краще, ніж ховати, бо не ламає верстку |
| `confirm` | Плюс модальне вікно в стилі GlModal: «Ви підтверджуєте…», з переліком пунктів |
| `comment` | Плюс обов'язковий коментар у модалці, який публікується як нота в MR (опційно разом із чеклістом `- [x] …`). Публікація йде від імені користувача, тому тільки за явним увімкненням |
| `typed` | Для критичних гілок: ввести назву цільової гілки або `merge`, щоб підтвердити |

Перехоплювати кліки на кнопці (capture-фаза, `preventDefault`), а після підтвердження викликати оригінальний клік. Без ланцюжків `parentElement` — через `dom.ts` і `data-testid`.

### 5.3 Позначення переглянутими блоків коду (hunks)

- У заголовок кожного hunk (`@@ … @@`) на вкладці Changes додається нативна галочка «Viewed».
- **Ідентифікатор hunk** = хеш(`filePath` + нормалізовані рядки hunk без номерів). Після нового пушу незмінені hunk лишаються переглянутими, змінені скидаються. Головна цінність фічі саме в цьому.
- Прогрес на файлі («3/5 блоків») і в дереві файлів. Коли всі hunk переглянуті, автоматично ставиться нативна галочка GitLab «Viewed» для файлу (і навпаки).
- Опційно: згортати переглянуті hunk, «перейти до наступного непереглянутого» (`]` / `[`).
- Стан у `storage.local`: `projectId:iid → {hunkHash: timestamp}` з TTL і очищенням змерджених MR.
- **Ризики**: diffs у GitLab віртуалізовані (вузли з'являються й зникають при скролі), і зараз на них переходять на Rapid Diffs. Потрібні адаптер під обидва варіанти й MutationObserver. Окремо врахувати режими inline і side-by-side, а також «Show whitespace changes». Тому ця фіча йде після рефактору.

### 5.4 Бейдж «Потребує ребейсу»

- Дані: GraphQL `shouldBeRebased` або `detailedMergeStatus == NEED_REBASE` і `conflicts`, плюс REST `diverged_commits_count` для «відстає на N комітів».
- Бейджі: `Rebase needed` (warning) і `Conflicts` (danger), обидва в стилі `gl-badge` з іконками спрайта GitLab, з тултіпом «Відстає від main на 12 комітів».
- Показувати і в списку, і на сторінці MR.

### 5.5 Інші ідеї

- Колонка «Мої MR» і «Чекають мене» (я в reviewers, але не відкривав).
- Бейдж «Застарілий» (MR без активності N днів).
- Бейдж «Pipeline failed» на картці Kanban.
- Синхронізація «переглянуто» між пристроями.
- i18n: uk і en.
- Швидкі дії на картці: «відкрити diff з місця, де зупинився».

---

## 6. Нативний вигляд (правило для всього UI)

- Тільки компоненти й класи з [Pajamas](https://design.gitlab.com) / GitLab UI: `gl-badge` з варіантами `success|warning|danger|info|neutral|tier`, `gl-form-checkbox`, `gl-alert`, `gl-modal`, утиліти `gl-flex gl-gap-2 …`.
- Кольори тільки через CSS-змінні `--gl-*`. Темна тема при цьому працює автоматично, без хардкоду `#fff` чи `rgba(0,149,0,…)`.
- Іконки зі спрайта GitLab, а шлях до спрайта береться з існуючого `<use href>` на сторінці (B8).
- Свої класи мають префікс `mrflow-`, щоб не конфліктувати з GitLab (як уже сталося з `ready` → `mr-ready`).
- Ніяких інлайн-стилів.
- Popup і options page теж виглядають як GitLab: шрифт GitLab Sans, кольори Pajamas.

---

## 7. Збірка, релізи, магазини

1. `pnpm build` → `.output/chrome-mv3`, `.output/firefox-mv3` (через WXT).
2. `pnpm zip` → архіви для CWS і AMO, плюс **sources zip** для AMO (обов'язковий, якщо код бандлиться або мініфікується).
3. **GitHub Actions**:
   - `ci.yml`: lint, typecheck, unit, build на кожен PR;
   - `release.yml`: на тег `v*` — збірка, zip, GitHub Release, `wxt submit` у Chrome Web Store і AMO (секрети: CWS client id/secret/refresh token, AMO JWT issuer/secret).
4. **Версіонування**: `release-please` або `changesets` за conventional commits (вони вже використовуються). Версія в manifest генерується з `package.json`, тож окремі коміти «chore: update version» більше не потрібні.
5. Для магазинів знадобиться:
   - Privacy policy (на GitHub Pages): розширення нікуди не відправляє дані, крім API того самого GitLab;
   - обґрунтування кожного permission у CWS;
   - скріншоти 1280×800, промо-тайл 440×280, іконки 16/32/48/128 (зараз немає 16 і 32);
   - для AMO: `data_collection_permissions: { required: ["none"] }`.

---

## 8. Організація репозиторію

- `README.md`: що це, GIF або скріншоти (Kanban, бейджі, чекліст, hunk review), встановлення з магазинів і вручну, налаштування, приватність.
- `LICENSE` (наприклад, MIT), `CHANGELOG.md` (автоматично через release-please), `CONTRIBUTING.md`.
- `CLAUDE.md`: стек, команди (`pnpm dev/test/build`), правило нативного UI, де лежать селектори (`core/gitlab/dom.ts`), правило «жодних запитів у циклі по MR», як оновлювати фікстури.
- `.github/ISSUE_TEMPLATE/` (bug з версією GitLab і браузера, feature), `pull_request_template.md`.
- Labels: `bug`, `feature`, `refactor`, `infra`, `gitlab-breakage`, `good first issue`.
- Milestones: див. розділ 9. GitHub Project (board) для відстеження.
- Скріншоти робити автоматично через Playwright на фікстурах, щоб вони не застарівали.

---

## 9. Порядок робіт

### Milestone 1.5: швидкі фікси (на поточному коді, без переписування)
Мета — щоб розширенням можна було користуватися вже зараз.
- [ ] B1: скасування попереднього запуску + не брати свої `ul` у селекторі
- [ ] B5: прибрати зайве ` */` у CSS
- [ ] B2 (мінімум): ліміт одночасних запитів, обробка 429, кеш `currentUser`, прибрати оновлення на кожен клік
- [ ] B3: `per_page=100` для commits або HEAD SHA
- [ ] B4: нормалізувати ключ до `…/merge_requests/:iid`
- [ ] B6, B7: таймаути на очікування
- [ ] B8: брати спрайт зі сторінки
- [ ] Бейдж Rebase needed / Conflicts (з `detailed_merge_status`, дешево)
- [ ] README, LICENSE, CLAUDE.md, issue templates

### Milestone 2.0: переписування
- [ ] WXT + TS + lint + Vitest + CI
- [ ] Роутер і життєвий цикл фіч
- [ ] GraphQL-клієнт, кеш, обмежувач
- [ ] `dom.ts`, нативні UI-компоненти
- [ ] Kanban через CSS Grid над нативним списком
- [ ] Схема налаштувань + міграція, options page
- [ ] Release workflow + публікація в CWS і AMO

### Milestone 2.1: approval guard
- [ ] Редактор чеклістів, умовні правила, `resetOn`
- [ ] Рівні підтвердження (checklist / confirm / comment / typed) для Approve і Merge
- [ ] Командний конфіг `.gitlab/mrflow.json`

### Milestone 2.2: hunk review
- [ ] Прототип на поточному diffs DOM і на Rapid Diffs
- [ ] Хешування hunk, збереження, прогрес, синхронізація з нативним «Viewed»
- [ ] Навігація до наступного непереглянутого

### Далі
- Self-hosted GitLab, i18n, колонки «Мої / Чекають мене», stale та pipeline бейджі.

---

## 10. Відкриті питання

1. Чи опубліковане розширення зараз в AMO або CWS (у manifest є gecko id)? Від цього залежить, чи потрібні міграції даних користувачів.
2. Self-hosted GitLab потрібен (робочий інстанс) чи тільки gitlab.com?
3. Для 2.0 обрати Vue (як GitLab) чи vanilla TS?
4. Рівень `comment` (публікація ноти від імені користувача) — вмикати взагалі?
5. Робити 1.5 на поточному коді, чи одразу переходити до 2.0?
