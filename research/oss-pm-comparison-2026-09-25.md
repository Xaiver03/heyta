# Open-source task/project tools vs 滴答清单/TickTick — verified research
Date of research: 2026-09-25. Every non-obvious claim has a source URL. Unverifiable items are marked **未核实**.
Note: GitHub's unauthenticated REST API hit its 60 req/h limit, so repo metadata came from raw.githubusercontent.com, GitHub HTML pages, commits `.atom` feeds, and blobless git clones where noted.

---

## 1. Plane — https://github.com/makeplane/plane

**License / edition verification (CRITICAL)**
- The repo is **AGPL-3.0-only**. Root `LICENSE.txt` is the verbatim GNU AGPLv3 text; `COPYRIGHT.txt` states `SPDX-License-Identifier: AGPL-3.0-only`; README §License links AGPLv3. Sources: `https://raw.githubusercontent.com/makeplane/plane/master/LICENSE.txt`, `.../COPYRIGHT.txt`, `.../README.md`.
- **No commercial/enterprise-licensed code found inside this repo.** A blobless clone file scan (5,023 tracked files) found no `ee/`, `enterprise/`, or proprietary-license directory; no SAML/OIDC/audit-log code. The only license plumbing is `apps/api/plane/license/`, whose `InstanceEdition` enum contains exactly one value — `PLANE_COMMUNITY`. Sources: `apps/api/plane/license/models/instance.py`, `COPYRIGHT_CHECK.md`.
- A **separate paid edition does exist**: the official site sells a self-hosted **"Commercial Edition"** plus Cloud **Free / Pro $6 / Business $13 / Enterprise Grid (contact)** per seat/month billed annually. Source: `https://plane.so/pricing`, `https://plane.so/self-hosted` (JSON-LD offers extracted).
- **Branch caveat**: the default branch is now **`preview`**, not `master`; `master` still exists. Source: github.com/makeplane/plane repo page (`"defaultBranch":"preview"`).
- Stars ≈59.9k, forks ≈5.9k, not archived (repo page, 2026-09-25).

**A. Stack** — Backend: Django + DRF (`apps/api`, Python; README builds-with badges list Django). Frontend: React + React Router (`apps/web`, README badge). DB/cache: PostgreSQL + Redis (repo topics `postgresql`, `redis`; docker-compose). Exact Django 5.2 / DRF version and Celery: **未核实**.
**B. Clients** — Web yes. Native **Mac, Windows, iOS, Android** official downloads (`go.plane.so/macos`, `/windows`, `/app-store`, `/play-store` in the site footer). No Linux native client advertised: **未核实**.
**C. Offline-first** — **未核实**.
**D. vs TickTick** — Present: kanban/board views, cycles/sprints, modules, views, pages, analytics, sub-work-items/properties, rich comments, webhooks (repo topics `kanban`, `gantt`; README feature list). Checklists, priorities, tags likely present but not individually verified. Recurring tasks, reminders, natural-language date parsing, Eisenhower matrix, Pomodoro, habit tracking, calendar two-way sync (CalDAV/Google/Outlook): **未核实** (none advertised).
**E. API** — Public REST API + developer docs: `https://developers.plane.so/`. Webhooks exist (changelog references "Webhook delivery logs"). CalDAV/ICS: **未核实**.
**F. Fork difficulty** — Biggest obstacle: Plane is an enterprise PM system, not a personal GTD daily-task app, and its commercial/paid features are **not in the repo**, so a fork can only ever be the Community Edition. License: AGPL-3.0-only — forking and commercial use are allowed, but running a modified version as a network service obliges you to offer the corresponding source (network copyleft); no trademark grant for the "Plane" brand. Deployment: multi-container Docker/Kubernetes stack (web + api + proxy + live + Postgres + Redis); weight **未核实**.

---

## 2. Huly — https://github.com/hcengineering/platform

**Frozen / shutdown verification (CRITICAL — both confirmed)**
- README on the default branch (`develop`, not `main`) states verbatim: *"**This repository is frozen and is no longer actively maintained.** Development continues in [Platform-Collective/platform]."* and *"**Hosted Huly has shut down.** The hosted Huly service has been discontinued because its hosting is no longer funded."* Source: `https://raw.githubusercontent.com/hcengineering/platform/develop/README.md`.
- Last commit: **2026-09-25T03:09:55Z**, SHA `e749ab9d7bff453ab0642b7e2cd90449436ca99c`, message `"Frozen maintenance (#11045)"`. Stars **27,774**; spdx **EPL-2.0**; not archived.
- Hosted service corroboration: `app.huly.io` → `huly.app` returns **HTTP 522** (Cloudflare origin down); `huly.io` returns 200 but serves a "Page not found" shell.
- **Successor** https://github.com/Platform-Collective/platform: **EPL-2.0**, **34 stars**, 6 forks, 6 open issues, default branch `develop`, pushed 2026-09-25T03:22:38Z. README: *"It is a fork of Huly Platform by Hardcore Engineering Inc. and is developed independently."* Sources: repo metadata + `https://raw.githubusercontent.com/Platform-Collective/platform/develop/README.md`.

**License restrictions** — Root `LICENSE` and all six `foundations/*/LICENSE` files are **byte-identical EPL-2.0** (same md5). No other LICENSE files, no `enterprise/`/`commercial/` directories, no commercial-only subdirectory license found (blobless clone, 10,643 files). EPL-2.0 **permits commercial use**; its §4 "Commercial Distribution" imposes indemnity duties on distributors of commercial products, not a use restriction.
**A. Stack** — TypeScript Rush monorepo; Node.js v20.11.0 required (README Pre-requisites); **MongoDB + Elasticsearch + MinIO** per self-hosted docs/secondary listing. Svelte frontend and "30+ microservices": **未核实**.
**B. Clients** — Web + official **macOS, Windows, Linux desktop** apps ("Easily access online or on macOS, Windows, and Linux" — `https://huly.io/download`). iOS/Android: **未核实** (hosted service discontinued).
**C. Offline-first** — **未核实**.
**D. vs TickTick** — Huly is an all-in-one Linear/Jira/Slack/Notion replacement (Project Management, Chat, CRM, HRM, ATS, plus a Typed API client). Recurring tasks, Eisenhower matrix, Pomodoro, habit tracking, natural-language date parsing, calendar two-way sync: **未核实** (none advertised).
**E. API** — Typed API client (not REST) documented in `hcengineering/huly.core` `packages/api-client`; examples in `hcengineering/huly-examples` (README). CalDAV/ICS/Webhooks: **未核实**.
**F. Fork difficulty** — Biggest obstacle: the original repo is **frozen and the hosted product is dead**; you must adopt the tiny, independent successor (34 stars) or self-host a heavyweight stack. License: EPL-2.0 permits commercial use/rebranding subject to its reciprocity/patent and commercial-distributor indemnity clauses; no trademark grant. Deployment weight is heavy — official self-host docs: **minimum 2 vCPU / 8 GB RAM, recommended 4 vCPU / 16 GB RAM or more** (`https://raw.githubusercontent.com/hcengineering/huly-selfhost/master/README.md`).

---

## 3. Focalboard — https://github.com/mattermost/focalboard

**Unmaintained / canonical / license verification (CRITICAL)**
- **Canonical repo is `mattermost-community/focalboard`**: `https://github.com/mattermost/focalboard` returns **HTTP 301 → `https://github.com/mattermost-community/focalboard`**. Not archived (`isArchived:false`). Stars 26,486.
- **Unmaintained**: last commit on default branch `main` is **2025-06-11T13:30:05Z** (a dependabot commit); last human commits 2025-06-09/10, after a gap since 2024-09-27 (commits `.atom` feed). Latest release **v8.0.0** (~2024-06).
- **Hybrid license, verbatim from `LICENSE.txt`**: compiled versions produced by Mattermost → **MIT**; source to build your own compiled version → either **AGPL-3.0** (with exceptions) **or a commercial license** from Mattermost (`commercial@mattermost.com`); `webapp/html-templates/`, `app-config.json`, `config.json`, `webapp/i18n/`, `server/model/`, `plugin/` → **Apache-2.0**; the AGPL copyleft is promised not to be enforced if you only use Admin Tools/Config Files without linking to Focalboard or creating a derivative work. "Mattermost" mark use requires prior written approval. Source: `https://raw.githubusercontent.com/mattermost-community/focalboard/main/LICENSE.txt`. GitHub's license detector returns **NOASSERTION**.
- **Mattermost Boards plugin**: official forum announcement **2023-08-16** — effective **2023-09-15** Boards became fully community-supported (no new features/bug fixes) and it was **removed from all Mattermost Cloud instances on 2023-09-28**; Mattermost support article titled "Boards Plugin in Maintenance Mode". Sources: `https://forum.mattermost.com/t/upcoming-product-changes-to-boards-and-various-plugins/16669`, `https://support.mattermost.com/hc/en-us/articles/19614000831252-Boards-Plugin-in-Maintenance-Mode`.

**A. Stack** — Go server + React/Redux webapp (README build targets, `server/`, `webapp/`). SQLite/Postgres/MySQL support: **未核实**.
**B. Clients** — Web (Docker server) + official single-user **Personal Desktop** for **macOS** (Mac App Store id1556908618), **Windows** (Microsoft Store 9NLN2T0SX9VF), **Linux** (`focalboard-linux.tar.gz`) — README. iOS/Android: none, **未核实**.
**C. Offline-first** — Personal Desktop runs a local single-user server (local-first for one user); general offline-first sync: **未核实**.
**D. vs TickTick** — Kanban boards/cards, properties, comments. Checklists, priorities, tags, recurring tasks, calendar view, reminders, natural-language parsing, Eisenhower, Pomodoro, habit tracking, calendar two-way sync: **未核实** (not advertised).
**E. API** — Swagger/OpenAPI docs linked from README (`server/swagger/docs/html`); server routes `/api/v2`, `/api/v3` (`server/api/api.go`). CalDAV/ICS/Webhooks: **未核实**.
**F. Fork difficulty** — Biggest obstacle: the project is **effectively unmaintained (last commit 2025-06)** and the license is a three-way hybrid whose source-code path is AGPL-3.0-or-commercial with a trademark restriction, so a rebranded fork must untangle Mattermost's licensing/trademark terms. Deployment: lightweight Go binary + SQLite (desktop) or Docker server; weight low.

---

## 4. Leantime — https://github.com/Leantime/leantime

**Paid/cloud editions + open-core (CRITICAL)**
- **Open-core, structurally not by a license split.** Root `LICENSE` is verbatim AGPLv3 and `composer.json` declares `"license": "AGPL-3.0-only"`. No second code license exists in the repo (full tarball scan found only third-party asset licenses). Instead `app/Plugins` is a **git submodule → `git@github.com:Leantime/plugins.git`**, which is **private/nonexistent publicly (HTTP 404)** and ships empty. Core code branches on paid plugins (PgmPro, StrategyPro, Copilot, Whiteboardscanvas, Llamadorian). Sources: `.../LICENSE`, `.../composer.json`, `.../.gitmodules`, `https://github.com/Leantime/plugins` (404).
- The README's own **"LICENSE Exceptions"** states: *"Plugins within the `/app/Plugins` directory which may contain plugins licensed under other licenses including our enterprise license."* Source: `.../README.md` lines 287–290.
- **Paid offerings**: single cloud plan **Leantime Pro $10/user/mo monthly, $8/user/mo annual** (14-day trial, 500 AI credits; no free SaaS tier), free self-hosted Community Edition (AGPLv3), plus marketplace plugins that carry the TickTick-relevant features — **Recurring Tasks $39**, **Pomodoro Timer $19**, Notes $29, Whiteboards $39, Custom Fields $39, Program Plans $39, Strategies $39, SAML $39, MCP Server $29. Sources: `https://leantime.io/pricing/`, `https://marketplace.leantime.io/product-category/plugins/`. Hosted Starter $49/mo and Hosting Premium $499/mo, on-prem support $480–$1,998: `https://marketplace.leantime.io/shop/`.
- Support FAQ: *"Our strategy, program management, and AI are currently unavailable in the open source space. We anticipate releasing them as paid plugins at a later date."* Source: `https://support.leantime.io/en/category/faqs-1bi3ww1`.

**A. Stack** — PHP `^8.2` + **Laravel `^11.44`** (composer.json); server-rendered Blade (331 `.blade.php`, 0 `.vue`) + jQuery/htmx/Tailwind; **MySQL 5.7+ / MariaDB 10.2+**. Sources: `.../composer.json`, `.../package.json`, Leantime docs system-requirements.
**B. Clients** — Web yes. **Android**: official "Leantime: Tasks & Focus" (`io.leantime.mobile`, open testing, updated 2026-07-28, Play Store). **iOS**: beta via public TestFlight; retail App Store release **未核实**. Windows/Linux native: none. No PWA (no manifest/service worker in repo).
**C. Offline-first** — **No.** No PWA/service worker; the mobile app only caches profile/recent content for offline viewing — a read cache, not offline write/sync. Source: `https://leantime.io/privacy`.
**D. vs TickTick** — Core OSS has: checklists/subtasks (unlimited + dependencies), 5-level priorities (critical→lowest), tags, kanban/Gantt/table/list/**calendar** views, milestones, sprints, comments/@mentions/roles, time tracking, wikis, idea boards, Lean canvas, SWOT, retrospectives. **Not in OSS core**: recurring tasks (paid $39 plugin), Pomodoro (paid $19 plugin), Eisenhower/four-quadrant matrix (not found), habit tracking (not found), natural-language date parsing (未核实; AI is the paid Copilot plugin). **Calendar sync**: core is a **one-way iCal feed** (`/calendar/ical`) plus read-only external iCal/Google import; docs say direct two-way sync requires the CalDAV plugin, which was not in the current marketplace listing.
**E. API** — **JSON-RPC 2.0, not REST**: single endpoint `/api/jsonrpc`, `x-api-key` auth, methods `leantime.rpc.{Domain}.{Service}.{Method}`; docs `https://docs.leantime.io/`. **Webhooks not built in** (only outbound Slack/Discord/Mattermost/Zulip messenger webhooks). ICS: yes (one-way). CalDAV: plugin-only. Sources: `https://raw.githubusercontent.com/Leantime/docs/master/api/usage.md`, `.../installation/frequently-asked-questions.md`.
**F. Fork difficulty** — Biggest obstacle: the TickTick-defining features (recurring tasks, Pomodoro, two-way CalDAV, AI capture) are **paid closed-source plugins in a private submodule**, so the AGPL core you can fork lacks them. License: AGPL-3.0-only — forking/commercial use allowed but **network copyleft** (must offer source to network users); no trademark rights to the Leantime name. Deployment: lightweight PHP 8.2 + MySQL, ~512 MB RAM min / 1 GB recommended, Docker image ~293 MiB.

---

## 5. OpenProject — https://github.com/opf/openproject

**Community vs Enterprise (CRITICAL)**
- One root `LICENSE` = verbatim **GPLv3**; `COPYRIGHT`/`COPYRIGHT_short` present; **no `LICENSE_EE`, no `ee/` directory**, no proprietary Enterprise notice (verified by blobless clone scan of 24,185 files and raw fetches). GitHub license field GPL-3.0.
- Enterprise add-ons are **gated by a signed Enterprise token/license key**, not a separate proprietary license. Official Enterprise guide: Community edition + paid Enterprise plans **Community / Basic / Professional / Premium / Corporate**; official FAQ states *"all features, also the Enterprise add-ons, are developed under the GPL v3."* Sources: `https://www.openproject.org/docs/enterprise-guide/`, `https://www.openproject.org/docs/faq`, `https://www.openproject.org/legal/terms-of-service`.
- Pricing (official): Community **€0**; per-user **€5.95 Basic / €10.95 Professional / €15.95 Premium** (min 25/25/100 users); Enterprise cloud min 5 users, on-prem min 25; 14-day trial. Source: `https://www.openproject.org/pricing/`.
- Metadata: stars 16,202, forks 3,508, default branch `dev`, pushed 2026-09-25, latest release **v17.8.0** (2026-09-02).

**A. Stack** — Ruby 4.0.7 + **Rails 8.1.3.1** (`.ruby-version`, `Gemfile.lock`); frontend is **hybrid, not pure Angular** — Angular 22.1.7 for feature areas plus Rails server-rendered ViewComponent 4.15.0 + turbo-rails 2.0.23 + Stimulus; **PostgreSQL 16+ only** (no MySQL), Node ^24. Sources: `.../Gemfile.lock`, `.../frontend/package.json`, `.../docs/installation-and-operations/system-requirements/README.md`.
**B. Clients** — Web yes. Official native **iOS** "OpenProject Mobile (Beta)" (App Store id6474431879, requires OpenProject ≥17.0.0, iOS 15+) and **Android** (`org.openproject.app`, Android 12+). Windows/Linux: none. macOS: only an App-Store scaled iPad build, explicitly not desktop-optimized. PWA: **未核实**. Sources: `.../docs/mobile-app-guide/…`.
**C. Offline-first** — **No.** Mobile docs: *"Offline mode is not supported. The app requires an active internet connection to load and sync content."*
**D. vs TickTick** — Community: priorities, calendar view, kanban/agile boards + backlogs, subtasks/hierarchies, collaboration, reminders/date alerts, time tracking. Checklists/tags: **未核实** (no native models found). Recurring tasks: no (recurring *meetings* only). NL date parsing, Eisenhower, Pomodoro, habit tracking: **未核实**/none found. Calendar two-way sync: **no** — one-way read-only iCal subscription (`GET /projects/:id/calendars/:id/ical`, `POST /api/v3/queries/:id/ical_url`), **no CalDAV**. None of the ordinary TickTick features above are Enterprise-only; EE add-ons are SSO, OneDrive/SharePoint, team planner, baseline comparison, resource/portfolio management, LDAP/SCIM, custom themes, etc.
**E. API** — REST **API v3** (HATEOAS) + OpenAPI spec, plus SCIM, MCP, BCF v2.1; **webhooks** yes (outgoing, signed) + incoming hooks; ICS yes (read-only). Sources: `.../docs/api/README.md`, `.../docs/system-admin-guide/api-and-webhooks/README.md`.
**F. Fork difficulty** — Biggest obstacle: a large, PostgreSQL-only Rails 8 monolith (~24k tracked files; ~4 GB RAM / 4 cores / 20 GB disk minimum, ≥2 web workers even for 5 users) whose core model is enterprise project/work-package management, not personal daily GTD. License: GPL-3.0 — commercial use and rebranding allowed, but distributed derivatives must stay GPL-3.0 with notices preserved; because the EE token-gating code itself ships under GPL-3.0, a fork can technically enable EE features. Deployment: all-in-one Docker bundles Postgres + memcached; `slim` image for compose/Helm.

---

## 6. WeKan — https://github.com/wekan/wekan

**Maintenance / bus factor (CRITICAL)**
- **Very active but effectively single-maintainer**: default branch is **`main`** (repo page `"defaultBranch":"main"`; `master` also exists). Recent commits are essentially all authored by **xet7** (2026-09-25T00:20:23Z, 2026-09-24T23:47, 23:46, 23:33, plus github-actions), i.e. a strong one-person bus factor. Source: `https://github.com/wekan/wekan/commits/main.atom`.
- README: *"We also welcome sponsors for features and bugfixes."* and "1 GB RAM minimum free for WeKan. Production server should have minimum total 4 GB RAM." Contributor counts: **未核实** (API rate-limited).
- **License**: root `LICENSE` = **MIT**, "Copyright (c) Lauri Ojansivu"; README repeatedly uses the registered mark "**WeKan ®**" and states it is MIT-licensed. Sources: `.../LICENSE`, `.../README.md`. Explicit rebranding/trademark policy text: **未核实**. No differing subdirectory licenses found.

**A. Stack** — Meteor/Node + MongoDB (project docs/docker images). Exact Meteor version: **未核实**. Frontend: Blaze/React (WeKan's UI framework) — **未核实**.
**B. Clients** — Web + Docker (`ghcr.io/wekan/wekan`, `wekanteam/wekan`), npm/snap-style installs at `https://wekan.fi/install/`. The current README contains **no Cordova/mobile references** (grep for cordova/android/ios returned nothing), so historical Cordova mobile apps: **未核实**/not advertised now.
**C. Offline-first** — **未核实**.
**D. vs TickTick** — Kanban boards/cards, checklists (card checklist items), tags/labels, comments, swimlanes, real-time UI. Recurring tasks, priorities, calendar view, Eisenhower matrix, Pomodoro, habit tracking, natural-language date parsing, calendar two-way sync: **未核实** (none advertised in README).
**E. API** — **REST API** documented at `https://github.com/wekan/wekan/blob/main/docs/API/REST-API.md`; **Webhooks** documented (payloads for card create/move/archive/comment) at `https://wekan-doc.readthedocs.io/en/latest/api/webhook`. CalDAV/ICS: **未核实**.
**F. Fork difficulty** — Biggest obstacle: the project's continuity rests on a single maintainer (xet7), so a long-lived personal clone would inherit that bus-factor risk. License: **MIT** — the most permissive here, allowing commercial use and rebranding, subject to the "WeKan ®" trademark on the name/logo. Deployment: Meteor/Node + MongoDB; ~1 GB RAM min, 4 GB recommended in production.

---

## Cross-project one-liners

| Project | License core | Commercial gate | TickTick-clone verdict |
|---|---|---|---|
| Plane | AGPL-3.0-only (whole repo) | Separate paid Commercial Edition + Cloud | Enterprise PM, not personal GTD; AGPL network copyleft |
| Huly | EPL-2.0 (all files) | None found; hosted service dead | Frozen repo, tiny successor, 8–16 GB RAM |
| Focalboard | MIT binaries / AGPL-or-commercial source / Apache-2.0 parts | Commercial license offered by Mattermost | Unmaintained; hybrid license + trademark friction |
| Leantime | AGPL-3.0-only core | Paid private plugins + Pro cloud | Recurring/Pomodoro/CalDAV are paid plugins |
| OpenProject | GPL-3.0 | Enterprise token (code still GPL) | Huge Rails monolith, not personal GTD |
| WeKan | MIT | None | Permissive but single-maintainer risk |

**Items explicitly left as 未核实** (to avoid guessing): exact Django/DRF/Celery versions for Plane; Svelte/microservice count for Huly; Focalboard DB matrix; Plane/Huly/WeKan offline-first behavior; TickTick-style recurring/reminder/Eisenhower/Pomodoro/habit/NL-date features for Plane, Huly, Focalboard and WeKan; CalDAV/ICS for Plane, Huly, Focalboard, WeKan; WeKan contributor counts and trademark policy; WeKan mobile app current status.
