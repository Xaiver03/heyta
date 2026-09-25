# Open-source task manager / note app comparison — factual research
Research date: **2026-09-25**. Every non-obvious claim carries a source. Claims I could not verify firsthand are marked **未核实**.

Method note: GitHub REST API was rate-limited from this host after the first calls, so most repo facts were verified from `raw.githubusercontent.com` file contents and the rendered GitHub HTML tree pages via `curl`; release/tag facts for Tracks came from the GitHub API before the limit was hit.

---

## 1. Tracks (GTD)

**A. Tech stack**
- Backend: Ruby on Rails `~> 7.2`, Puma (`Gemfile`: `gem 'rails', '~> 7.2'`, `gem 'puma', '~> 7.2'`). Source: https://raw.githubusercontent.com/TracksApp/tracks/master/Gemfile
- Frontend: server-rendered ERB + jQuery / Bootstrap 3.4 (`jquery-rails`, `jquery-ui-rails`, `bootstrap-sass 3.4.1`, `dartsass-sprockets`). Source: same `Gemfile`.
- Database: SQLite **or** MySQL **or** PostgreSQL, chosen at install (`sqlite3`/`mysql2`/`pg` gems in isolated `:sqlite`/`:mysql`/`:postgresql` groups). Source: same `Gemfile`.

**B. Client coverage**
- Web only (self-hosted Rails app). No official iOS/Android/Windows/macOS/Linux native client found in the repo (`app/` contains only Rails controllers/views; the README only points to a wiki list of *hosted* Tracks instances). Source: https://raw.githubusercontent.com/TracksApp/tracks/master/README.md
- A mobile-oriented HTML view exists (`format.m`, `mobile?` helper in `feedlist_controller.rb` / `todos_controller.rb`), i.e. mobile web, not an app. Source: https://raw.githubusercontent.com/TracksApp/tracks/master/app/controllers/feedlist_controller.rb

**C. Offline-first?** No — classic server-rendered web app (no offline/PWA evidence in the repo).

**D. Features vs TickTick**
- Checklists/subtasks: task **dependencies** between todos exist (`app/models/dependency.rb`, `pending_successors`/`uncompleted_predecessors`); classic nested subtasks **未核实**.
- Priorities: no priority field found; "starred" is implemented as a reserved tag `starred` (`STARRED_TAG_NAME = "starred"`). Source: https://raw.githubusercontent.com/TracksApp/tracks/master/app/models/todo.rb
- Tags: yes (`tag.rb`, `tagging.rb`).
- Recurring tasks: yes (`app/models/recurring_todo.rb`, `RecurringTodosController`). Source: https://github.com/TracksApp/tracks/tree/master/app/models
- Calendar view: yes (`CalendarController`, `app/views/calendar/show.ics.erb`).
- Kanban/board: no. Subtasks (nesting): 未核实. Collaboration: multi-user accounts exist (`users_controller.rb`) but no real-time collaboration. Reminders: 未核实. Natural-language date parsing: 未核实. Eisenhower matrix: no. Pomodoro: no. Habit tracking: no.
- Calendar two-way sync: no CalDAV/Google/Outlook sync found; only **ICS export/feed** (`format.ics`) and RSS/Atom feeds. Source: https://raw.githubusercontent.com/TracksApp/tracks/master/app/controllers/todos_controller.rb (line 65 `format.ics`), `calendar_controller.rb` line 17.

**E. Public API**
- Yes: a documented XML REST API at `/integrations/rest_api` (HTTP Basic auth; GET/POST/PUT/DELETE on `todos.xml`, `tickler.xml`, `hidden.xml`, `calendar.xml`, `contexts.xml`, `projects.xml`). Source: https://raw.githubusercontent.com/TracksApp/tracks/master/app/views/integrations/rest_api.html.erb and https://raw.githubusercontent.com/TracksApp/tracks/master/config/routes.rb
- ICS: yes (see D). CalDAV: not found in repo (no `caldav`/`ical` gem, no DAV routes). Webhooks: 未核实.

**F. Reuse difficulty**
Biggest obstacle: it is a dormant Rails monolith with no native mobile client and no CalDAV/board/reminder layer — you would rebuild the entire TickTick UX; GPL-2.0 copyleft (`COPYING` = GPLv2 text; GitHub license metadata `gpl-2.0`) forces derivative forks to stay GPL-2.0. Source: https://raw.githubusercontent.com/TracksApp/tracks/master/COPYING

**Maintenance status (critical)**
- **Archived: no** (repo `archived: false`), but **effectively dormant**:
  - Latest release: **v2.7.1, published 2024-07-25** (previous v2.7.0 2024-06-17, v2.6.1 2022-08-14) — i.e. **no release in ~26 months**. Source: https://api.github.com/repos/TracksApp/tracks/releases
  - Latest commit: **2026-08-03**, `"Merge pull request #3272 ... Bump activestorage from 7.2.3.1 to 7.2.3.2"`. Source: https://api.github.com/repos/TracksApp/tracks/commits?per_page=5
  - The 30 most recent commits (2026-03-03 → 2026-08-03) are **all Dependabot bumps/merges** (activestorage, sqlite3, bullet, yard, mini_racer, mocha, solargraph, rubocop, stripe, json, puma) — no feature work in that window. Source: same commits endpoint.
  - 252 open issues, 1,239 stars, 527 forks as of 2026-09-25. Source: https://api.github.com/repos/TracksApp/tracks
- Conclusion: dependency-maintained only, no releases since mid-2024; treat as dormant.

---

## 2. AppFlowy

**A. Tech stack**
- Client: Flutter (UI) + Rust (core). Source: https://raw.githubusercontent.com/AppFlowy-IO/AppFlowy/main/README.md ("Built With — Flutter, Rust")
- Self-hosted backend: originally Rust ("⚡ The AppFlowy Cloud written with Rust 🦀"), deployed with Postgres (`pgvector/pgvector:pg16`), Redis, MinIO (S3), GoTrue (Supabase auth), Nginx; the official deployment is now the Docker Compose repo `AppFlowy-SelfHost-Commercial`. Sources: https://raw.githubusercontent.com/AppFlowy-IO/AppFlowy-SelfHost-Commercial/main/docker-compose.yml and https://raw.githubusercontent.com/AppFlowy-IO/AppFlowy-Cloud/main/README.md

**B. Client coverage**
- Windows / macOS / Linux desktop downloads; iOS (App Store); Android (Play Store); plus AppFlowy Web. Source: https://raw.githubusercontent.com/AppFlowy-IO/AppFlowy/main/README.md ("User Installation": desktop releases, FlatHub, Snapcraft, App Store iPhone, Play Store Android 10+, Web/self-host)
- Official release channel version at time of research: **v0.14.5** (site metadata), latest changelog entry v0.14.3 dated 2026-09-15. Source: https://appflowy.com/what-is-new

**C. Offline-first?** Yes — marketed as local-first/"true offline support" and the site's schema declares "Offline-first workspace". Source: https://appflowy.com/pricing (also `featureList` in https://appflowy.com/)

**D. Features vs TickTick**
- Database views: **Grid, Kanban, Calendar, Gallery, List, Feed, Chart**. Source: AppFlowy site `featureList` (https://appflowy.com/)
- Calendar view: multi-day ranges, weekly view, drag-and-drop rescheduling (v0.14.3, 2026-09-15). Source: https://appflowy.com/what-is-new
- Tags/priorities/subtasks: expressible as database select/relation properties (multi-view databases, two-way relations added v0.10.7) — a task schema you build yourself, not dedicated task fields. Source: https://appflowy.com/what-is-new
- Reminders/native notifications: **not present** as of AppFlowy issue #8708, which requests them ("Currently, AppFlowy lacks the real-time reminder functionality expected from modern productivity platforms"). Source: https://github.com/AppFlowy-IO/appflowy/issues/8708
- Recurring tasks: 未核实. Natural-language date parsing: 未核实. Eisenhower matrix: only as a template (no native four-quadrant view verified). Pomodoro: no. Habit tracking: no.
- Calendar two-way sync: Calendar integration exists (Google Calendar setup documented for web/desktop) and Zapier connectivity exists; native CalDAV two-way sync: 未核实. Sources: https://raw.githubusercontent.com/AppFlowy-IO/AppFlowy-SelfHost-Commercial/main/README.md (Google Calendar connections guide), https://zapier.com/apps/appflowy/integrations/google-calendar/255646002/create-detailed-google-calendar-events-from-updated-appflowy-database-items

**E. Public API**
- REST API docs: 未核实 (no first-party REST API reference confirmed during research). Webhooks: none native verified (Zapier is the integration path). CalDAV/ICS: no evidence.

**F. Reuse difficulty — license is the blocker**
- AppFlowy **client** is AGPL-3.0. Source: https://raw.githubusercontent.com/AppFlowy-IO/AppFlowy/main/LICENSE, README license badge ("License: AGPL", AGPLv3)
- The **self-hosted server is no longer open source**: `AppFlowy-Cloud` is archived and states the active backend is "our **closed-source commercial codebase**" under a Commercial License Agreement; the new `AppFlowy-SelfHost-Commercial` repo has **no LICENSE file** (only `SELF_HOST_LICENSE_AGREEMENT.md`), which forbids copying, modifying, distributing, sublicensing or reverse-engineering, is licensed per server/machine with a license key, and is a **1-year term**. Sources: https://raw.githubusercontent.com/AppFlowy-IO/AppFlowy-Cloud/main/README.md, https://raw.githubusercontent.com/AppFlowy-IO/AppFlowy-SelfHost-Commercial/main/SELF_HOST_LICENSE_AGREEMENT.md, repo root listing of https://github.com/AppFlowy-IO/AppFlowy-SelfHost-Commercial (README.md + SELF_HOST_LICENSE_AGREEMENT.md; `LICENSE` returns 404)
- Paid/enterprise editions: yes — AppFlowy Cloud: Free, **Pro $12.5 → $10/user/month billed annually**, AI MAX $8/user/month, Vault Workspace $6/user/month; self-hosted commercial free tier = **1 user seat**. Source: https://appflowy.com/pricing
- Biggest obstacle to forking a personal TickTick clone: you can fork the AGPL Flutter client, but the only maintained sync/self-host backend is closed-source and license-key-gated (free tier: 1 seat).

---

## 3. Nextcloud Tasks

**A. Tech stack**
- Backend: PHP Nextcloud app (`composer.json`: `php >=8.1 <=8.4`, license AGPL). Source: https://raw.githubusercontent.com/nextcloud/tasks/master/composer.json
- Frontend: Vue (`@nextcloud/vue 9.11.0`, Vite build, `src/**/*.vue`), with CalDAV logic via `@nextcloud/calendar-js`, `@nextcloud/cdav-library`, `ical.js`. Sources: https://raw.githubusercontent.com/nextcloud/tasks/master/package.json, https://github.com/nextcloud/tasks/tree/master/src
- Database: task data lives in the **Nextcloud server's CalDAV store** (the app declares `<backend>caldav</backend>` and `<dependencies>` on Nextcloud 31–35 and PHP 8.2–8.6). Source: https://raw.githubusercontent.com/nextcloud/tasks/master/appinfo/info.xml
- Latest app version: **0.18.1** (info.xml + Nextcloud app store listing). Source: https://apps.nextcloud.com/apps/tasks

**B. Client coverage**
- Web: yes (Nextcloud app, enabled under Apps → Organization). **Requires a Nextcloud server** (info.xml `<dependencies><nextcloud min-version="31" max-version="35"/>`). Source: info.xml + README.
- No official iOS/Android/desktop Tasks app. Sync via third-party CalDAV/VTODO clients (README's own list): Apple Reminders (iOS/macOS), 2Do, DAVx5 + Tasks.org / OpenTasks / jtx Board (Android), Outlook CalDAV Synchronizer (Windows), Thunderbird, QOwnNotes (read-only), BusyCal, aCalendar+, GNOME Todo, Kalendar, planify, vdirsyncer, NowThis (iOS/macOS). Source: https://raw.githubusercontent.com/nextcloud/tasks/master/README.md

**C. Offline-first?** No for the app itself (server-side Nextcloud app); offline capability comes only from caching CalDAV clients such as DAVx5/Tasks.org.

**D. Features vs TickTick**
- Yes: title/description/start & due dates, priority, status, **subtasks**, smart collections (important/current/upcoming), drag-and-drop between calendars and into subtasks, task sharing between users, ICS download per calendar. Source: https://raw.githubusercontent.com/nextcloud/tasks/master/appinfo/info.xml and README.
- Tags/labels: 未核实 as a first-class field (VTODO CATEGORIES are standard CalDAV; not verified in this repo). Recurring tasks: 未核实. Checkllists: partial (markdown task lists in description via `markdown-it-task-lists`). Calendar view: no dedicated calendar view (list/collection UI). Kanban/board: no. Collaboration: sharing only. Reminders/VALARM: 未核实. Natural-language parsing: no. Eisenhower matrix: no. Pomodoro: no. Habit tracking: no.
- Calendar two-way sync: **yes via CalDAV** (it is itself a CalDAV/VTODO client), i.e. it syncs with any standards-compliant CalDAV server client pair, but has no native Google/Outlook connector. Source: info.xml `<backend>caldav</backend>`, README ("Apps which sync with Nextcloud Tasks (using CalDAV)").

**E. Public API**
- No documented public REST API for task CRUD. The app exposes only internal routes: `page#index` plus `/api/v1/collections` and `/api/v1/settings`. Source: https://raw.githubusercontent.com/nextcloud/tasks/master/appinfo/routes.php
- The actual programmatic interface is **Nextcloud CalDAV (WebDAV) + ICS** (per-calendar ICS export; ETag-based conflict detection is documented in the README). Webhooks: 未核实 (not in this app).

**F. Reuse difficulty**
Biggest obstacle: it is a Vue skin over Nextcloud's CalDAV server — you cannot run it without a full Nextcloud instance, and it has no kanban, calendar view, Eisenhower, Pomodoro or habits; you would build all of that on top of VTODO. AGPL-3.0 copyleft applies (LICENSE + `licence agpl`).

---

## 4. Nextcloud Deck

**A. Tech stack**
- Backend: PHP Nextcloud app (`composer.json` license `AGPLv3`). Source: https://raw.githubusercontent.com/nextcloud/deck/main/composer.json
- Frontend: Vue (`lint: eslint --ext .js,.vue src`, `@nextcloud/*` packages, webpack build). Source: https://raw.githubusercontent.com/nextcloud/deck/main/package.json
- Data: app-owned tables in the Nextcloud database; app registers DAV types (`<types><dav/></types>`). Source: https://raw.githubusercontent.com/nextcloud/deck/main/appinfo/info.xml
- Version: **main = 2.0.0-dev.0**; latest stable release **v1.19.0** (app store). Sources: https://raw.githubusercontent.com/nextcloud/deck/main/package.json, https://apps.nextcloud.com/apps/deck, https://github.com/nextcloud-releases/deck/releases

**B. Client coverage**
- Web: yes (Nextcloud app). Requires a Nextcloud server.
- Android: **third-party** official-listed app `stefan-niedermann/nextcloud-deck` (GPLv3; F-Droid + Play Store; README feature list includes "Works offline"). Source: https://raw.githubusercontent.com/stefan-niedermann/nextcloud-deck/master/README.md
- iOS: **third-party** `holger-dev/nextdeck` (App Store). Source: https://raw.githubusercontent.com/nextcloud/deck/main/README.md
- Windows/macOS/Linux: no native app — web only.

**C. Offline-first?** Web app: no. The third-party Android client advertises "Works offline". Source: https://raw.githubusercontent.com/stefan-niedermann/nextcloud-deck/master/README.md

**D. Features vs TickTick**
- Kanban: **yes** — boards/stacks/cards, drag-and-drop ordering, archive/done flags, labels, Markdown card descriptions, attachments, comments, activity stream, sharing with users/groups, Circles integration, Trello import. Sources: https://raw.githubusercontent.com/nextcloud/deck/main/README.md and API endpoints (`/boards`, `/stacks/{boardId}/reorder`, `/cards/{cardId}/done`, `/cards/{cardId}/archive`, …) in https://raw.githubusercontent.com/nextcloud/deck/main/appinfo/routes.php
- Due dates exist on cards; an `/upcoming` view exists. Source: routes.php
- Priorities: only labels (no priority field verified). Recurring tasks: no (未核实 / not found). Checklists: via Markdown task lists in the description. Subtasks: 未核实. Reminders: 未核实. Natural-language date parsing: no. Eisenhower matrix: no. Pomodoro: no. Habit tracking: no. Calendar view: no (only "upcoming"). Collaboration: yes (sharing, comments, activity).
- Calendar two-way sync (CalDAV/Google/Outlook): no — Deck cards are not VTODOs; there is no CalDAV/ICS card sync found.

**E. Public API**
- Yes: documented **REST API v1.0** at `/index.php/apps/deck/api/v1.0` (Boards, Stacks, Cards, Labels, Attachments, Comments, Sessions; OCS-APIRequest header required), plus an OCS API section and a documented data model. Source: https://deck.readthedocs.io/en/latest/API/
- CalDAV/ICS: not for cards (Deck declares DAV types for its own endpoint only). Webhooks: 未核实.

**F. Reuse difficulty**
Biggest obstacle: Deck is a Nextcloud-bound PHP app whose model is boards/stacks/cards — no reminders, recurrence, priorities-as-data, calendar sync or Eisenhower/Pomodoro; building a TickTick clone means re-implementing a task engine inside Nextcloud's app framework. AGPL-3.0-or-later copyleft (SPDX headers in README/info.xml).

---

## 5. Lunatask (closed source)

**A. Tech stack** — 未核实 / not public. No source code is published (see below), so backend/frontend/DB are unknown.

**B. Client coverage**
- Native apps for **Windows, macOS, Linux (DMG), iOS, Android**. Source: footer download links on https://lunatask.app/ (`/download/windows`, `/download/mac`, `/download/linux`, `/download/ios`, `/download/android`)
- Web app: not offered (no web client link found). Source: same page.

**C. Offline-first?** The apps are local clients that sync an encrypted dataset; explicit offline-first wording 未核实.

**D. Features vs TickTick**
- Confirmed first-party: tasks, subtasks, recurring tasks, bulk edit, workflows, scheduling/future tasks, time blocking, estimation, timers, WIP limit, habits, journaling, mood, relationships (CRM), Today view, calendar, quick note, notifications, integrations (email, browser extension, Zapier), import/export. Source: docs navigation + pages under https://lunatask.app/docs/
- **E2E encryption: always on**, data encrypted on-device before sync ("your data is end-to-end encrypted... Encryption isn't optional"). Source: https://lunatask.app/docs/getting-started/privacy
- **Pomodoro-style timer**: yes, but deliberately not a classic Pomodoro (timer always tied to a specific task). Source: https://lunatask.app/docs/features/tasks/timers
- **Eisenhower matrix**: the official site's own pricing page lists only "Automatic Prioritization"; the Eisenhower matrix + Must/Should/Want method is described by third parties (Medium article, toolguide.io review), not verified on a first-party page → **partially verified (third-party only)**. Sources: https://lunatask.app/pricing, https://medium.com/@danielasgharian/tired-of-complex-productivity-apps-meet-lunatask-your-new-digital-life-manager-b7b4685a20c0, https://toolguide.io/en/tool/lunatask
- Not a match for TickTick in: kanban/board (no), four-quadrant view as a first-party feature (unverified), collaboration/team sharing (the product is a personal single-user app behind E2E encryption — 未核实 explicitly, but the E2E model precludes server-side sharing). CalDAV/Google/Outlook two-way sync: an Outlook integration exists ("Authorize Outlook integration" in docs nav); CalDAV 未核实.

**E. Public API**
- Yes: a documented API (Tasks/Notes/Habits/Journal/People entities, create/update/delete). Source: https://lunatask.app/api/overview
- **No webhooks**, and the API **cannot read** E2E-encrypted fields; names/notes are not returned. Source: same page.

**F. Reuse difficulty (licensing)**
- **Not open source, not self-hostable.** The GitHub repo `lunatask/lunatask` contains only `README.md` and `badge.png` and states: "This repository holds releases of Lunatask". Sources: https://raw.githubusercontent.com/lunatask/lunatask/master/README.md and the repo root file listing on https://github.com/lunatask/lunatask
- Data is stored in Lunatask's own cloud ("securely stored in our cloud and synced across all your devices"); no self-host/deployment option is documented anywhere in the docs or pricing. Sources: https://lunatask.app/docs/getting-started/privacy, https://lunatask.app/pricing
- Pricing/licensing: **Free** plan; **Premium $8/mo monthly or $6/mo billed annually**; **one-time lifetime license $300** (not available in the mobile app / Mac App Store; use DMG builds); invoice-based lifetime $200 (+VAT; £150 for UK organizations). Sources: https://lunatask.app/pricing, https://lunatask.app/docs/subscriptions
- Biggest obstacle: there is nothing to fork — proprietary binaries + a paid cloud + E2E encryption mean a "fork into a personal TickTick clone" is legally and technically impossible.

---

## 6. Docmost

**A. Tech stack**
- Backend: **NestJS 11** on **Fastify**, with **Kysely** (`nestjs-kysely`, `kysely-postgres-js`) against **PostgreSQL** (+ `pgvector`), **Redis** and **BullMQ** for queues; real-time collaboration via **Hocuspocus** (Yjs) and Socket.IO. Sources: https://raw.githubusercontent.com/docmost/docmost/main/apps/server/package.json, https://raw.githubusercontent.com/docmost/docmost/main/package.json
- Frontend: **React 19** + TipTap 3 editor + TanStack Query/Table + Vite. Source: https://raw.githubusercontent.com/docmost/docmost/main/apps/client/package.json
- Version on main: **0.96.0**. Source: https://raw.githubusercontent.com/docmost/docmost/main/package.json

**B. Client coverage**
- Web only (self-hosted or Docmost Cloud). No official desktop (Windows/macOS/Linux) or iOS/Android app found. Source: https://raw.githubusercontent.com/docmost/docmost/main/README.md (features list has no clients; installation is server/Docker)

**C. Offline-first?** No — real-time collaborative web app requiring the server.

**D. Features vs TickTick**
- Docmost is a **wiki/documentation** product: real-time collaboration, spaces, permissions, groups, comments, page history, full-text search, attachments, diagrams (Draw.io/Excalidraw/Mermaid), embeds. Source: https://raw.githubusercontent.com/docmost/docmost/main/README.md
- **"Bases"** = a database block with **Table and Kanban views** ("a list of tasks can appear as a table for editing and as a Kanban board for tracking"). **However Bases is a commercial feature: "An active Business or Enterprise license is required. Bases is not available in the free, open source edition."** Source: https://docmost.com/docs/user-guide/bases
- No dedicated task entity (no priorities, due dates, reminders, recurrence, reminders, Eisenhower, Pomodoro, habits verified). Editor checklists exist (`task-list.css`, `@tiptap/extension-list`). Task-related code in the repo is import/queue/file tasks, not task management. Source: tarball listing of docmost@main
- Collaboration: yes (multi-user). Calendar view: no.

**E. Public API**
- Yes: an API reference exists at https://docmost.com/docs/user-guide/api and a full reference at https://docmost.com/api-docs (both linked from the docs navigation). Also an MCP integration page. Source: https://docmost.com/docs/user-guide/bases (nav links)
- CalDAV/ICS: no evidence. Webhooks: 未核实.

**F. Reuse difficulty**
Biggest obstacle: it is a wiki, not a task manager — and the only board/table feature (Bases) is paywalled behind the non-OSS Business/Enterprise license, so a fork of the AGPL core cannot ship a kanban task manager. AGPL-3.0 core is copyleft.

**Enterprise-license directories (exact)**
- README states: "All files in the following directories are licensed under the Docmost Enterprise license defined in `packages/ee/License`": **`apps/server/src/ee`**, **`apps/client/src/ee`**, **`packages/ee`**. Source: https://raw.githubusercontent.com/docmost/docmost/main/README.md
- Verified against the current `main` tarball (2026-09-25):
  - `apps/client/src/ee/LICENSE` — header "Files in this directory are subject to the Docmost Enterprise Edition license", body = **The Docmost Enterprise License** (production use requires a valid Docmost Enterprise Edition subscription; copying/merging/publishing/distributing/sublicensing/selling forbidden). 491 files under `apps/client/src/ee/`.
  - `packages/ee/LICENSE` — same **The Docmost Enterprise License** text; `packages/ee/` currently contains **only** that LICENSE file.
  - `apps/server/src/ee/` **exists but is empty** on current `main` (only the directory entry; zero files).
  - Note: the README's quoted path is `packages/ee/License`, but the actual file on disk is `packages/ee/LICENSE` (`License`/`License.md` return 404).
- Docs now describe **three** self-hosted editions: Open Source (AGPL-3.0), **Business**, and **Enterprise** (audit logs, SIEM, page verification), all requiring a license key beyond Open Source. Source: https://docmost.com/docs/user-guide/license-and-editions

---

## 7. Extra candidates ("note-type" bases for a task manager)

### 7a. AFFiNE
- Repo: https://github.com/toeverything/AFFiNE — default branch is **`canary`** (`main` returns 404 for LICENSE).
- **Licensing (verified from repo files):** root `LICENSE` (canary) says most content is **MIT** (`LICENSE-MIT`), **but** "All content that resides under the `packages/backend` and `packages/common/native` directory … is licensed under the license defined in `packages/backend/server/LICENSE`". That file is the **AFFiNE Enterprise Edition (EE) license**: the Software "may only be used in production, if you … have a valid AFFiNE Enterprise Edition subscription for the correct number of user seats"; copying, merging, publishing, distributing, sublicensing and selling are forbidden. Sources: https://raw.githubusercontent.com/toeverything/AFFiNE/canary/LICENSE, https://raw.githubusercontent.com/toeverything/AFFiNE/canary/packages/backend/server/LICENSE
- The README's license section still claims "AFFiNE Community Edition (CE) … free for self-host under the MIT license" — **this contradicts the repo LICENSE file**; treat the file as authoritative. Source: https://raw.githubusercontent.com/toeverything/AFFiNE/canary/README.md
- Paid subscription: yes — Free / Pro / **Team $10 per seat/month** / Enterprise (private cloud & self-hosted "Book a Demo"); the site advertises "MIT editor, source-available backend" and a free self-hosted Basic tier. Source: https://affine.pro/pricing
- Stack: TypeScript monorepo (`@affine/monorepo`, MIT in root package.json), React frontend, NestJS + Prisma backend; self-host Docker Compose runs server + **Postgres + Redis**. Sources: https://raw.githubusercontent.com/toeverything/AFFiNE/canary/package.json, https://docs.affine.pro/self-host-affine/
- Offline-first: yes ("local-first & real-time collaborative" README; pricing "MIT editor, local-first by design").
- Clients: Windows/macOS/Linux desktop + web + mobile (App Store/Play links on https://affine.pro/download).
- Task management: databases with **Kanban/table/calendar views** and community templates including an **Eisenhower grid** template — but no dedicated task entity with reminders/recurrence. Sources: https://affine.pro/templates/kanban-boards, https://affine.pro/blog/canvas-calendar-to-kanban
- API: 未核实. CalDAV/ICS: no evidence.
- Fork obstacle: the backend server tree is EE-licensed (paid subscription required for production), so only the editor/frontend is MIT — you cannot legally run the full server stack for free in production.

### 7b. SiYuan
- Repo: https://github.com/siyuan-note/siyuan (branch `master`), license **AGPL-3.0**. Source: https://raw.githubusercontent.com/siyuan-note/siyuan/master/README.md (AGPLv3 badge) and GitHub repo page.
- Stack: Go **kernel** (plugin API documented in `siyuan-note/plugin-sample`: "Frontend API / Backend API"), TypeScript frontend; self-hostable via Docker/K8s; data stored as local workspace files (FAQ: "How does SiYuan store data?"). Sources: https://raw.githubusercontent.com/siyuan-note/siyuan/master/README.md, https://github.com/siyuan-note/plugin-sample
- Task management: **no real task manager** — block-style Markdown editor with block references, SQL query embed, a **Table view database**, flashcards, OCR. Source: README "Features"
- Clients: desktop (Windows/macOS/Linux), mobile, Docker-hosted browser access. Source: README download/deployment sections.
- Fork obstacle: it is a knowledge base, not a task system; you'd build tasks/calendar/reminders from scratch under AGPL-3.0.

### 7c. Joplin
- Repo: https://github.com/laurent22/joplin (branch `dev`). License: **AGPL-3.0-or-later for the repo, unless a directory contains its own LICENSE** — and `packages/server` does: **JOPLIN SERVER PERSONAL USE LICENSE** (non-FOSS, personal use only). Sources: https://raw.githubusercontent.com/laurent22/joplin/dev/LICENSE, https://raw.githubusercontent.com/laurent22/joplin/dev/packages/server/LICENSE.md
- Stack: Electron desktop + React Native mobile + Node.js; local SQLite; sync via file system/WebDAV/S3/Dropbox/OneDrive/Nextcloud/Joplin Cloud with optional **E2EE**. Source: https://raw.githubusercontent.com/laurent22/joplin/dev/README.md
- Offline-first: **yes, explicitly** ("Joplin is 'offline first'"). Source: README
- Clients: Windows, Linux, macOS, Android, iOS + Web Clipper. Source: README
- Task management: **to-do notes** (convert between note/to-do), inline task lists, ordering/visibility of completed to-dos, **per-to-do alarms with OS notifications**. Sources: https://raw.githubusercontent.com/laurent22/joplin/dev/readme/apps/to-dos.md, https://raw.githubusercontent.com/laurent22/joplin/dev/readme/apps/notifications.md
- Recurring tasks: not documented natively → **未核实** (likely via plugin). Priorities, kanban, calendar view, Eisenhower, Pomodoro, habits: none native. CalDAV/ICS: no evidence.
- API: yes — **Data API** (HTTP, create/modify/delete notes, notebooks, tags, resources) plus **Plugin API**; used by the Web Clipper. Sources: https://raw.githubusercontent.com/laurent22/joplin/dev/readme/api/index.md, https://raw.githubusercontent.com/laurent22/joplin/dev/readme/api/references/rest_api.md
- Fork obstacle: Joplin is a notes-first app; the task layer is thin (to-dos + alarms only), and the server component is under a **personal-use-only** license.

### 7d. Memos
- Repo: https://github.com/usememos/memos (branch `main`), **MIT** license. Source: https://raw.githubusercontent.com/usememos/memos/main/README.md
- Stack: **Go** backend (Echo v5, ConnectRPC, grpc-gateway) + **React/Vite** frontend; DB **SQLite / MySQL / PostgreSQL**; APIs: **REST and gRPC**. Sources: https://raw.githubusercontent.com/usememos/memos/main/go.mod, https://raw.githubusercontent.com/usememos/memos/main/web/package.json, https://raw.githubusercontent.com/usememos/memos/main/README.md ("Run a single Go binary or Docker container with SQLite, MySQL, or PostgreSQL", "Build on the REST and gRPC APIs")
- Task management: **none** — a timeline-first Markdown quick-capture note tool (tags, search, pins, sharing). Source: https://raw.githubusercontent.com/usememos/memos/main/README.md
- Clients: self-hosted web app / Docker (mobile apps: 未核实). Offline-first: no.
- Fork obstacle: MIT and Go/React make it easy to fork, but there is no task model, scheduling, reminders or calendar — everything must be built.

---

## Cross-cutting summary

| Project | License (core) | Backend | Offline-first | Board | Calendar view | Reminders | Rec. tasks | API | Forkable into TickTick clone? |
|---|---|---|---|---|---|---|---|---|---|
| Tracks | GPL-2.0 | Rails 7.2 | No | No | ICS only | 未核实 | Yes | XML REST + ICS/RSS | Dormant; UI/mobile missing |
| AppFlowy | AGPL-3.0 client / **proprietary server** | Rust + PG/Redis/MinIO | Yes | Yes | Yes | No (#8708) | 未核实 | 未核实 | Blocked by closed-source, license-keyed server |
| Nextcloud Tasks | AGPL-3.0 | PHP + CalDAV | No | No | No | 未核实 | 未核实 | CalDAV + internal only | Needs full Nextcloud; thin VTODO UI |
| Nextcloud Deck | AGPL-3.0-or-later | PHP (+Vue) | Web no / Android yes | **Yes** | No | 未核实 | No | **REST v1.0 documented** | Needs Nextcloud; no task-engine features |
| Lunatask | **Proprietary** | Unknown | 未核实 | No | Yes | Yes | Yes | Yes (encrypted-limited) | **Not possible** (no source, no self-host) |
| Docmost | AGPL-3.0 + **EE dirs** | NestJS/Fastify+Kysely+PG+Redis | No | **Paid (Bases)** | No | No | No | Yes (docs + /api-docs) | Wiki-first; kanban is paywalled |
| AFFiNE (extra) | MIT except **EE backend dirs** | NestJS/Prisma + PG/Redis | Yes | Yes (DB view) | Yes (DB view) | No | 未核实 | 未核实 | Backend is EE-licensed |
| SiYuan (extra) | AGPL-3.0 | Go kernel + TS | Yes (local-first) | No | No | No | No | Kernel API (未核实 details) | Note-only base |
| Joplin (extra) | AGPL-3.0 (server: personal-use) | Electron/RN + Node | **Yes** | No | No | **Yes (alarms)** | 未核实 | **Data API + Plugin API** | Thin task layer; server license restricted |
| Memos (extra) | MIT | Go (Echo) + React | No | No | No | No | No | REST + gRPC | Note-only base |