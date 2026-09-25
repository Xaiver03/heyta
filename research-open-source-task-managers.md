# Open-source task managers compared — Vikunja / Super Productivity / Tududi

Research date 2026-09-25. Line counts are my own counts from the upstream source tarballs (`codeload.github.com`, no `.git`, no `node_modules`), not GitHub's language stats; treat them as approximate. Repo "size" is the GitHub API value (includes history). Anything I could not verify is marked **未核实**.

---

## 1. Vikunja

- Repo: https://github.com/go-vikunja/vikunja (branch `main`, default) — v2.6.0 (README badge), created 2018-11-28, 5.5k stars, 711 forks, 15,776 commits, GitHub size ≈132,766 KB (~130 MB). https://api.github.com/repos/go-vikunja/vikunja
- License: **AGPL-3.0-or-later** for the repo; `desktop/` is **GPL-3.0-or-later**. Vikunja Pro code is said to live in the same repo under the same AGPLv3, activated by a license key. https://github.com/go-vikunja/vikunja (README §License) · https://vikunja.io/pro/

**A. Tech stack**
- Backend: **Go 1.27** (`go 1.27.0` in go.mod), web framework **labstack/echo v5** + echo-jwt; newer API surface uses **danielgtaylor/huma v2** for reflected OpenAPI. Websockets via `coder/websocket`. https://github.com/go-vikunja/vikunja/blob/main/go.mod · `pkg/websocket/`
- Frontend: **Vue 3** (3.5.42) + Pinia + vue-router + axios + TipTap editor + Bulma-based CSS; built as a PWA (Workbox). https://github.com/go-vikunja/vikunja/blob/main/frontend/package.json
- Database: **sqlite (default), mysql, postgres** — "Supported values are mysql, postgres and sqlite. MySQL 8.0+, MariaDB 10.2+, PostgreSQL 12+". https://vikunja.io/docs/config-options/
- Desktop: **Electron** wrapper in `desktop/` (electron 43.7.0, electron-builder). https://github.com/go-vikunja/vikunja/tree/main/desktop
- Mobile: separate repo **go-vikunja/app** — a **Flutter** cross-platform app (`android/`, `ios/` dirs), described as alpha pre-release. https://raw.githubusercontent.com/go-vikunja/app/main/README.md

**B. Client coverage**
- **Web**: official SPA/PWA (and Vikunja Cloud hosting). https://vikunja.io/features/
- **Windows / macOS / Linux**: official Electron desktop build. https://github.com/go-vikunja/vikunja/tree/main/desktop · https://vikunja.io/features/
- **Android**: official app, but **alpha/beta** and published on **Google Play Beta** (`io.vikunja.app`) plus `dl.vikunja.io/app`. https://raw.githubusercontent.com/go-vikunja/app/main/README.md · https://play.google.com/store/apps/details?id=io.vikunja.app
- **iOS**: **no official app.** The cross-platform repo contains an `ios/` directory but its maintainer states he cannot support iPhone builds; the App Store listing is explicitly an **unofficial** app (seller *Noel Mayr*); other iOS clients (Kuna, mDone) are third-party. https://raw.githubusercontent.com/go-vikunja/app/main/README.md · https://apps.apple.com/us/app/vikunja/id6751271029
- **PWA**: web app registers a service worker, but see C — it does not cache API data.

**C. Offline-first? — No.**
Server-first. The service worker precaches static assets (stale-while-revalidate) but routes all `/api/v1/*` requests `NetworkOnly` with `cache: 'no-store'`. https://github.com/go-vikunja/vikunja/blob/main/frontend/src/sw.ts

**D. Features vs TickTick**
- Checklists: subtasks + task relations (blocking/subtask); no separate inline-checklist object. https://vikunja.io/features/
- Priorities: yes (1–5). https://vikunja.io/docs/quick-add-magic/
- Tags/labels: yes. · Recurring: yes.
- Calendar view: **no dedicated calendar month/week view**. Documented views are **List, Gantt, Kanban, Table** only. https://vikunja.io/features/ · `frontend/src/components/project/views/`
- Kanban/board: yes (with buckets). · Subtasks: yes.
- Collaboration/sharing: yes — project sharing with users/teams, assignments, link shares. https://vikunja.io/features/
- Reminders/notifications: due-date reminders, email + in-app (DB) notifications. https://vikunja.io/features/ · https://vikunja.io/docs/notifications/
- Natural-language dates: **yes** — "Quick Add Magic" (`tomorrow at 5pm`, `next monday`, `every 2 weeks`, `*label`, `!3`, `@user`, `+project`). https://vikunja.io/docs/quick-add-magic/
- Four-quadrant / Eisenhower: **absent** (0 matches in source). Pomodoro/focus timer: **absent**. Habit tracking: **absent**. (repo grep, 2026-09-25)
- Calendar two-way sync: **CalDAV VTODO only**, and it is documented as **early alpha**: works with Evolution, OpenTasks/DAVx⁵, Tasks (Android), Korganizer; **not working** with Thunderbird (68) and iOS CalDAV sync. Supported props include DUE, RRULE, RELATED-TO, VALARM; ATTACH/LOCATION/ORGANIZER etc. unsupported. No Google/Outlook native integration. https://vikunja.io/docs/caldav/

**E. Extensibility**
- REST API: yes. v1 Swagger and **v2 reflected OpenAPI 3.1** (`/api/v2/docs`, `/api/v2/openapi.json`, JSON Schema per resource); Bearer API tokens/JWT. https://vikunja.io/docs/api-documentation/ · https://vikunja.io/docs/api-v2/ · https://try.vikunja.io/api/v2/docs
- CalDAV: yes (alpha, see D). · Webhooks: yes (project + user webhooks, HMAC-SHA256 signature). https://vikunja.io/docs/webhooks/
- Plugins: yes — runtime Go plugins via **Yaegi** (v2.3.0+); native `.so` loader deprecated. https://vikunja.io/docs/plugin-development/
- Other: CLI, OAuth2 server, LDAP/OIDC in the free core, n8n integration, MCP mentioned on docs nav.

**F. Reuse difficulty**
Biggest obstacle: **AGPL-3.0-or-later copyleft** — a network-served rebranded clone must offer its complete corresponding source, and "Vikunja Pro" gating sits in the same AGPL repo; the name/trademark terms for rebranding are **未核实**. Technically it is a clean, modern stack (Echo/Huma + Vue 3, documented OpenAPI), so the code itself is fork-friendly.
Code size (approx., source tarball): 429k lines total incl. tests — Go ~213k (1,070 files; ~90k in test paths), frontend TS+Vue ~116k (805 files; ~35k in tests); ~123k non-test Go + ~81k non-test frontend.

---

## 2. Super Productivity

- Repo: https://github.com/super-productivity/super-productivity (branch `master`) — v19.1.0, created 2017-01-06, 22.2k stars, 2,071 forks, 22,145 commits, GitHub size ≈173,427 KB (~169 MB). https://api.github.com/repos/super-productivity/super-productivity
- License: **MIT** (permissive). README badge + https://api.github.com/repos/super-productivity/super-productivity

**A. Tech stack**
- Frontend: **Angular 21** + **NgRx 21** state store, TypeScript 5.9; IndexedDB via `idb`.
- Desktop/mobile packaging: **Electron 43** (desktop) and **Capacitor 8** (`@capacitor/android`, `@capacitor/ios`) for mobile; web build is a PWA. `package.json`
- No backend of its own beyond an optional sync server: `packages/super-sync-server` (self-hostable). https://github.com/super-productivity/super-productivity/wiki/3.01-API
- Local storage: IndexedDB; all data lives on-device by default. https://super-productivity.com/

**B. Client coverage — all official**
- **Web**: official PWA at https://app.super-productivity.com
- **Windows**: official, code-signed; Microsoft Store, winget, choco, scoop, installer.
- **macOS**: official App Store app (seller *Johannes Millan*, the project author, v19.1.0) + DMG.
- **Linux**: official Flathub, Snap, Arch `extra/super-productivity`, AppImage, `.deb`.
- **Android**: official Google Play, F-Droid, Obtainium, APK.
- **iOS**: official App Store (id1482572463).
Sources: https://github.com/super-productivity/super-productivity/wiki/2.01-Downloads-and-Install · https://apps.apple.com/app/super-productivity/id1482572463 · https://play.google.com/store/apps/details?id=com.superproductivity.superproductivity · https://itunes.apple.com/lookup?id=1482572463

**C. Offline-first? — Yes, explicitly local-first.**
"Local-first and operation-based": the device holds the primary copy and changes are sent as operations. Sync providers: Nextcloud, WebDAV, Dropbox, **SuperSync** (own E2E-encrypted sync service, self-hostable, beta), local file (desktop only); optional client-side encryption. https://github.com/super-productivity/super-productivity/wiki/3.08-Sync-Integration-Comparison · https://super-productivity.com/

**D. Features vs TickTick**
- Checklists: two-level subtasks (`parentId` model is "only two levels deep"); no separate inline checklist. https://github.com/super-productivity/super-productivity/wiki/3.01-API
- Priorities: yes (incl. an "Eat the Frog"/ordinal priority scheme). · Tags/labels: yes. · Recurring tasks: yes, incl. `@every friday` syntax. https://github.com/super-productivity/super-productivity/wiki/3.04-Short-Syntax
- Calendar view: **Schedule view** + **Planner view** (timeboxing) — yes. https://github.com/super-productivity/super-productivity/wiki/4.04-Schedule-View · https://github.com/super-productivity/super-productivity/wiki/4.03-Planner-View
- Kanban/board: **yes** — configurable Boards with panels. https://github.com/super-productivity/super-productivity/wiki/4.05-Board-View
- Subtasks: yes. · Collaboration/sharing: **partial** — optional **Plainspace** shared "Spaces" (their own hosted service; two-way done/title/schedule sync); otherwise single-user local. https://github.com/super-productivity/super-productivity/blob/master/docs/wiki/3.07-Issue-Integration-Comparison.md
- Reminders/notifications: yes (system/Web notifications, reminders, break reminders). https://github.com/super-productivity/super-productivity/wiki/4.16-Break-Reminders
- Natural-language dates: **yes** — Chrono-based parser: `@4pm`, `@friday`, `@tomorrow 19:00`, `@every 2 weeks`, `!friday`, `#tag`, `+project`. https://github.com/super-productivity/super-productivity/wiki/3.04-Short-Syntax
- Four-quadrant/Eisenhower: **yes** — built-in `EISENHOWER_MATRIX` board with 4 panels. `src/app/features/boards/boards.const.ts` · https://super-productivity.com/
- Pomodoro/focus timer: **yes** — Focus Mode with Pomodoro, timeboxing, breaks. https://github.com/super-productivity/super-productivity/wiki/4.15-Timers-and-Focus-Mode
- Habit tracking: **yes** — dedicated `/habits` route and `features/simple-counter/habit-tracker`. `src/app/app.routes.ts`
- Calendar two-way sync: CalDAV — VTODO **import** plus configurable **off/pull/push/both** for completion/title/notes (tasks created in SP are *not* uploaded as new VTODOs); iCal feed is **read-only** (VEVENT); **Google Calendar OAuth** and **Outlook 365** providers exist, with Google time-block **writes back** to the calendar. Google auth is per-device. https://github.com/super-productivity/super-productivity/blob/master/docs/wiki/3.07-Issue-Integration-Comparison.md · https://github.com/super-productivity/super-productivity/blob/master/docs/wiki/2.07-Manage-Task-Integrations.md · `src/app/features/calendar-integration/time-block/`

**E. Extensibility**
- Public REST API: **no server-side multi-user task API**. It has (1) Sync Server REST API (JWT, operation-based), (2) **Local REST API** on `127.0.0.1:3876`, **desktop-only, disabled by default**, (3) Plugin API, (4) URL-scheme actions. https://github.com/super-productivity/super-productivity/wiki/3.01-API
- CalDAV: yes (basic, see D). · Webhooks: **not found** (未核实). 
- Plugin system: **yes** — JS plugins with manifest.json, hooks (`taskComplete`, etc.), `PluginAPI`; not sandboxed; Node execution only on desktop. https://github.com/super-productivity/super-productivity/wiki/2.15-Develop-a-Plugin

**F. Reuse difficulty**
Biggest obstacle: **sheer size and architectural coupling** — the Angular/NgRx app is a monolith built around an operation-log/sync engine, so extracting a lean clone means untangling ~300k non-test TS lines; the **MIT** license itself imposes no commercial/rebranding restriction.
Code size (approx., source tarball): ~1.08M lines total incl. tests; TypeScript ~811k across 3,050 `.ts` files (~509k in test paths), plus ~26k HTML templates and ~26k SCSS. Largest of the three by a wide margin.

---

## 3. Tududi

- Repo: https://github.com/chrisvel/tududi (branch `main`) — package version `v1.6.0-rc.3` (docs page still says v1.4.0-rc.1), created 2023-11-13, 3.4k stars, 251 forks, 1,283 commits, GitHub size ≈43,212 KB (~42 MB). https://api.github.com/repos/chrisvel/tududi
- License: **MIT**. README §License

**A. Tech stack**
- Backend: **Node.js + Express 4** (not Nest), **Sequelize 6** ORM + Umzug migrations, session auth (`express-session`, bcrypt), `node-cron`, `ical.js` (CalDAV). `package.json` · https://docs.tududi.com/
- Frontend: **React 18 + TypeScript**, Tailwind CSS, Zustand, SWR, CodeMirror 6 (notes), i18next (25 languages). `package.json` · https://docs.tududi.com/
- Database: **SQLite (default)** or **PostgreSQL** via `DATABASE_URL`. https://github.com/chrisvel/tududi (README §Database)
- Packaging: **Docker only** (single image, single-command). No desktop/mobile native app; ships as an installable **PWA**. https://github.com/chrisvel/tududi (README) · https://github.com/chrisvel/tududi/blob/main/docs/15-pwa.md

**B. Client coverage**
- **Web**: official self-hosted web app (and the author's hosted service at https://tududi.com/).
- **iOS / Android / Windows / macOS / Linux**: **no native or store apps.** Coverage is **PWA-only** — installable to the home screen on Android, iOS (Safari 16.4+), and desktop browsers. Telegram bot is an interaction channel, not a client. https://github.com/chrisvel/tududi/blob/main/docs/15-pwa.md · https://github.com/chrisvel/tududi (README §Installable PWA)

**C. Offline-first? — Partial.**
Installable PWA: "the app stays readable from cache when offline, and write operations are queued and synced automatically when connectivity returns." Not a full local-first datastore like Super Productivity. https://github.com/chrisvel/tududi (README) · https://github.com/chrisvel/tududi/blob/main/docs/15-pwa.md

**D. Features vs TickTick**
- Checklists: no discrete task-checklist object; **subtasks** with progress, and checklists inside Markdown notes. https://github.com/chrisvel/tududi (README §Features)
- Priorities: yes. · Tags/labels: yes (tasks + notes). · Recurring tasks: yes, extensive (daily/weekly/monthly/…, completion-based recurrence, custom intervals, end dates). · Kanban: **yes**.
- Calendar view: **yes** — Day / Week / Month (`frontend/components/Calendar/`). https://docs.tududi.com/
- Collaboration/sharing: **yes, self-hosted multi-user** — project sharing with read-only/read-write permissions, roles, groups, people/members, families & small teams. https://docs.tududi.com/features/project-sharing · https://github.com/chrisvel/tududi/blob/main/docs/19-people-and-roles.md
- Reminders/notifications: yes — channels `telegram`, `mobile`, `email`; in-app notification store. `backend/models/notification.js`
- Natural-language date parsing: **not present / 未核实** — `compromise` NLP is used only for action-verb/hashtag/project detection in inbox processing, not for dates. `backend/modules/inbox/inboxProcessingService.js`
- Four-quadrant/Eisenhower: **yes** — `frontend/components/Eisenhower/EisenhowerMatrix.tsx` · https://docs.tududi.com/
- Pomodoro/focus timer: **yes** — `frontend/components/Shared/PomodoroTimer.tsx` (local 25-min timer).
- Habit tracking: **yes** — dedicated `backend/modules/habits` + streak UI. https://docs.tududi.com/
- Calendar two-way sync: **CalDAV is bidirectional** (Nextcloud, Baikal, tasks.org, Apple Reminders, Thunderbird, Evolution; RRULE, conflict detection, background sync). **Google/Outlook are one-way iCal feed import only** (server-side ICS fetch, e.g. Google "secret address"); no Google/Outlook API write-back. https://github.com/chrisvel/tududi/blob/main/docs/11-caldav-sync.md · `backend/modules/calendar-feeds/`

**E. Extensibility**
- Public REST API: **yes** — versioned `/api/v1`, Bearer personal API keys, Swagger UI at `/api-docs` (auth-protected). https://github.com/chrisvel/tududi (README §API) · `backend/app.js`, `backend/config/swagger.js`
- CalDAV: yes (bidirectional, see D). · Webhooks: **no task webhooks** — the only webhook code is **billing** provider handling (Stripe/LemonSqueezy). `backend/modules/billing/webhookRoutes.js`
- Plugin system: **none.** There is an **MCP server** (stdio + HTTP) exposing tasks/projects/notes/habits tools for AI assistants instead. https://github.com/chrisvel/tududi/blob/main/docs/14-mcp-integration.md
- Other: OIDC/SSO, Telegram integration, PostgreSQL support, daily digests, goals.

**F. Reuse difficulty**
Biggest obstacle: **it is the least modular and has the smallest maintainer base** (single maintainer, 1.3k commits) — there is no plugin API or task-webhook seam to hook a clone into, so you would fork and own the whole Express/Sequelize + React app; the **MIT** license imposes no commercial or rebranding restriction.
Code size (approx., source tarball): ~339k lines total incl. tests — backend JS ~131k (788 files; ~57k in test paths), frontend TS/TSX ~107k (462 files; ~12k in tests). Smallest and least complex of the three.

---

### Quick verdict for a TickTick-clone fork

| | Vikunja | Super Productivity | Tududi |
|---|---|---|---|
| License | AGPL-3.0-or-later (copyleft) | MIT | MIT |
| Biggest fork risk | AGPL network copyleft + Pro gating | ~800k-line coupled Angular monolith | single-maintainer, no plugin/API seam |
| Mobile | official Android alpha; **no** official iOS | official iOS + Android | PWA only |
| Offline-first | no (API is NetworkOnly) | yes (local-first, operation-based) | partial (PWA cache + queued writes) |
| CalDAV | alpha, VTODO, iOS unsupported | basic, VTODO push/pull configurable | bidirectional, mature-ish |
| Eisenhower / Pomodoro / Habits | none / none / none | yes / yes / yes | yes / yes / yes |
| REST API + plugins + webhooks | yes / yes / yes | local-only REST + plugins, no webhooks | REST + MCP; no plugins/webhooks |
