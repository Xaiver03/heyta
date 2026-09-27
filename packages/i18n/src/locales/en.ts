/**
 * 英文词条表。
 *
 * 🔴 `satisfies Record<MessageKey, string>` 是这一整套设计的关键一行：
 *   - 少任何一条 zh-CN 里的词条 → **编译报错**（不是运行时兜底）；
 *   - 多任何一条 zh-CN 里没有的 key → **多余属性检查报错**。
 *
 * 所以这里**不要**用 `...spread` 拼装（展开会让多余属性检查失效）。
 *
 * ⚠️ 词条内容由 check:ui-language 门禁把关：英文表里**不允许出现汉字** ——
 * 否则出现"把中文复制过来当英文交差"，人眼不一定看得出来，门禁一定看得出来。
 *
 * ⚠️ 同理，英文里也**不能出现中文标点**（`，` `。` `：` 这些全角符号的码位
 * 落在门禁的 CJK 区段里）。用 ASCII 标点。
 */
import type { MessageKey } from './zh-CN.js';

export const en = {
  // ── Shared ────────────────────────────────────────────────
  'common.brand': 'heyta',
  'common.a11y.toLightTheme': 'Switch to light theme',
  'common.a11y.toDarkTheme': 'Switch to dark theme',

  /**
   * Language **endonyms** — deliberately the SAME word in both catalogs.
   *
   * The switcher shows each language in its own script, because the user who
   * cannot read the current language is exactly the one who needs that entry
   * point; labelling it in a script they can't read defeats the purpose.
   *
   * 🔴 `'common.lang.zh': '中文'` is therefore the ONLY legitimate case of CJK
   * appearing in the English catalog, and it is allow-listed **by key** in
   * both the gate and the reconciliation test — not by relaxing the rule,
   * which would also let "pasted the Chinese in as English" slip through.
   */
  'common.lang.zh': '中文',
  'common.lang.en': 'English',

  // Known sync failures. Both shells share these sentences on purpose - see zh file.
  'common.sync.error.notConfigured': 'Sync is not configured yet',
  'common.sync.error.notSignedIn': 'You are not signed in, so syncing cannot start',
  'common.sync.error.noPassword': 'No end-to-end encryption password was set, so syncing stopped - heyta will not upload anything unencrypted',
  'common.sync.error.localOpMissing': 'That local change is no longer queued; sync again',
  'common.sync.error.remoteVersionUnavailable': 'The other version is unavailable, so keeping the remote copy is not possible - keep the local one instead',
  'common.sync.error.undecryptableOps': 'Some older data could not be decrypted with the current password (it may have been written under a different one) and was skipped - everything else synced',
  'common.sync.error.uploadRejected': 'Some changes were rejected by the server and are not in the cloud — retrying them has stopped. See sync details.',

  // ── Landing · generic ─────────────────────────────────────
  'landing.skipLink': 'Skip to main content',

  // ── Landing · nav ─────────────────────────────────────────
  'landing.nav.ariaLabel': 'Page navigation',
  'landing.nav.capabilities': 'Capabilities',
  'landing.nav.showcase': 'Screens',
  'landing.nav.sync': 'Sync',
  'landing.nav.pricing': 'Pricing',
  'landing.nav.selfhost': 'Self-host',
  'landing.nav.switchLanguage': 'Switch to {language}',

  // ── Landing · feature names (nav / cards / showcase / mockup) ──
  'landing.feature.tasks': 'Tasks',
  'landing.feature.quadrant': 'Quadrants',
  'landing.feature.habits': 'Habits',
  'landing.feature.focus': 'Focus timer',

  // ── Landing · quadrants (action name and definition are both kept) ──
  'landing.quadrant.do': 'Do now',
  'landing.quadrant.plan': 'Schedule',
  'landing.quadrant.delegate': 'Delegate',
  'landing.quadrant.drop': 'Do not do',
  'landing.quadrant.q1': 'Important and urgent',
  'landing.quadrant.q2': 'Important, not urgent',
  'landing.quadrant.q3': 'Urgent, not important',
  'landing.quadrant.q4': 'Neither important nor urgent',
  'landing.quadrant.dropHere': 'Drag tasks here',

  // ── Landing · hero ────────────────────────────────────────
  // Mass readers first: encryption, self-hosting and local-first are developer
  // reasons, not mass-market ones. They belong in Privacy and SelfHost, which
  // only readers who scroll that far will reach.
  'landing.hero.eyebrow': 'Tasks · Lists · Habits · Focus',
  'landing.hero.titleLead': 'See what to do today, ',
  'landing.hero.titleEmphasis': 'at a glance',
  'landing.hero.lede': 'Jot things down and it works out the order for you. Tasks, lists, habits and focus sessions in one place - note it on your phone, pick it up on your laptop.',
  'landing.hero.ctaShowcase': 'See what it looks like',
  'landing.hero.ctaPricing': 'See pricing',
  'landing.hero.floatSynced': 'Synced to 3 devices',
  'landing.hero.floatOffline': 'Works fine offline',

  // ── Landing · facts ───────────────────────────────────────
  'landing.facts.ariaLabel': 'Product facts',
  // This strip sits right under the hero, so it leads with mass reasons too.
  // The MIT licence and one-command self-hosting moved to Footer and SelfHost.
  // The encryption fact deliberately promises only the sync channel: turning on
  // cloud AI does send plaintext out, so it must not read as a blanket claim.
  'landing.facts.offline.value': 'Offline',
  'landing.facts.offline.label': 'Keep writing with no connection; it syncs once you are back',
  'landing.facts.devices.value': 'Any device',
  'landing.facts.devices.label': 'Self-hosting is free forever, with no device cap and no expiry',
  'landing.facts.encrypted.value': 'Encrypted sync',
  'landing.facts.encrypted.label': 'Tasks are encrypted before upload, so the sync channel cannot read them',
  'landing.facts.oneData.value': 'One dataset',
  'landing.facts.oneData.label': 'Lists, quadrants, habits and focus share one dataset - not several apps bolted together',

  // ── Landing · capabilities ────────────────────────────────
  'landing.capabilities.title': 'Subscriptions sell six things as one bundle. We rebuilt them as separate parts',
  'landing.capabilities.lede': 'Tasks, calendar, quadrants, habit tracking, focus timer, recurring tasks. Each has a proven design; the hard part is making them share one dataset and one set of sync rules.',
  'landing.capabilities.quadrant.body': 'Importance and urgency are two independent axes. Drag a task into a cell and it is classified there. Urgency comes from the due date, never from what you type.',
  'landing.capabilities.habits.title': 'Habit tracking',
  'landing.capabilities.habits.body': 'The heatmap shows intensity through one hue at different depths, not through different colours, so it reads the same with colour-vision differences.',
  'landing.capabilities.focus.body': 'Focus sessions are written to a local log and linked to tasks.',
  'landing.capabilities.breakdown.title': 'Smart breakdown',
  'landing.capabilities.breakdown.body': 'Turn one sentence into an actionable checklist. Use your own API key, or turn the whole feature off.',
  'landing.capabilities.repeat.title': 'Recurring tasks',
  'landing.capabilities.repeat.body': 'Roll forward by rule: tick off this round and the next one appears, with the same result on every device.',
  'landing.capabilities.offline.title': 'Works offline',
  'landing.capabilities.offline.body': 'Read and write with no connection. Changes upload when you reconnect, and conflicts are handed to you instead of being decided for you.',

  // ── Landing · showcase ────────────────────────────────────
  'landing.showcase.title': 'This is what it looks like today',
  'landing.showcase.lede': 'These three are not mockups: they reproduce the structure and values of the real interface.',
  'landing.showcase.hint': 'Now showing: {label}',
  'landing.showcase.quadrant.title': 'No need to decide what comes first',
  'landing.showcase.quadrant.body': 'Importance and urgency are two independent axes. Urgency comes from the due date, so you only answer whether the task matters; the matrix does the rest.',
  'landing.showcase.habits.title': 'Streaks matter more than check-in counts',
  'landing.showcase.habits.body': 'The heatmap shows intensity through one hue at different depths, not through different colours, so it reads the same with colour-vision differences.',
  'landing.showcase.focus.title': 'Focus records live with your tasks',
  'landing.showcase.focus.body': 'Every focus session is linked to a specific task and written to a local log, so "where did this week go" is a question you can answer.',

  // ── Landing · privacy ─────────────────────────────────────
  'landing.privacy.title': 'The server never sees your plaintext, not even once',
  'landing.privacy.ledeLead': 'Encryption happens on your device and the key never leaves it. All the server receives is something it cannot open, and ',
  'landing.privacy.ledeStrong': 'no switch can make it see the plaintext',
  'landing.privacy.ledeTail': ' — not "we promise not to look", but "we cannot look".',
  'landing.privacy.plaintext': 'Buy Mom a birthday present',
  'landing.privacy.yourDevice': 'Your device',
  'landing.privacy.server': 'Server',
  'landing.privacy.keyNote': 'The key is here, and it stays here',
  'landing.privacy.noteIdle': 'Scroll down to see what the server actually receives',
  'landing.privacy.noteProgress': 'Encrypted {done} / {total} characters',

  // ── Landing · self-host ───────────────────────────────────
  'landing.selfhost.title': 'Your own server, one command away',
  'landing.selfhost.lede': 'No account and no subscription. The server only relays ciphertext and orders concurrent changes: replace it, shut it down, or move it to another machine and your data is unaffected.',
  'landing.selfhost.terminal': 'Terminal',
  'landing.selfhost.step1.title': 'Clone and build',
  'landing.selfhost.step1.body': 'Needs Node 22+ and pnpm 11.8.0. Install dependencies and run a full build once.',
  'landing.selfhost.step2.title': 'Start the server',
  'landing.selfhost.step2.body': 'One command brings up the sync service and the database. The server stores only ciphertext; it has no key to decrypt it.',
  'landing.selfhost.step3.title': 'Point the client at it',
  'landing.selfhost.step3.body': 'On first launch, pick one: your own server address or the hosted option. You can switch whenever you want.',
  'landing.selfhost.warnStrong': 'Do not run Prisma migrations directly.',
  'landing.selfhost.warnBody': 'The project has 5 migrations that build indexes concurrently. Prisma wraps migrations in a transaction, and PostgreSQL does not allow concurrent index creation inside one, so the sixth migration fails. Use the repository ',
  'landing.selfhost.warnCode': 'migration script scripts/migrate-deploy.sh.',
  // The repository is private today, so the `git clone` command above does not
  // work for visitors. This is an honest disclosure, not marketing copy.
  'landing.selfhost.sourcePending': 'The source is not public yet, so the first line leaves the repository address as a placeholder. Once it is public that line runs as-is, and the two lines after it take you to a running self-host.',

  // ── Landing · pricing ─────────────────────────────────────
  // 🔴 These prices must match the server price list and both legal texts --
  // `scripts/check-pricing-consistency.mjs` reads these entries and asserts all
  // three agree. Read docs/reference/pricing-and-entitlements.md before changing.
  // ASCII punctuation only in this table (see the file header).
  'landing.pricing.ariaLabel': 'Pricing and entitlements',
  'landing.pricing.title': 'The software is free forever. Only hosting and AI cost money.',
  'landing.pricing.lede': 'Every feature of the app itself is free: self-hosting is free forever, with no validation and no device limit. Exactly two things cost money -- us running the server for you, and our cloud AI.',
  'landing.pricing.noFeatureGate': 'Both paid tiers do exactly the same things -- you pay for us running the server, not to unlock features.',
  'landing.pricing.free.name': 'Self-host',
  'landing.pricing.free.price': 'Free',
  'landing.pricing.free.period': 'forever',
  'landing.pricing.free.body': 'Runs on your own server. No account to create, and nobody checks how long you have been using it. You can point AI at your own endpoint too.',
  'landing.pricing.free.feature1': 'Every feature, none held back',
  'landing.pricing.free.feature2': 'Unlimited devices',
  'landing.pricing.free.feature3': 'Your data and your keys stay with you',
  'landing.pricing.free.cta': 'Self-host now',
  'landing.pricing.hosted.name': 'Managed hosting',
  'landing.pricing.hosted.priceCny': 'CNY 5 / month',
  'landing.pricing.hosted.priceUsd': '$5 / month',
  'landing.pricing.hosted.regionCny': 'Mainland China',
  'landing.pricing.hosted.regionUsd': 'International',
  'landing.pricing.hosted.body': 'We run the relay for you. The data is still ciphertext, and we still cannot open it.',
  'landing.pricing.hosted.feature1': 'Every feature, identical to self-hosting',
  'landing.pricing.hosted.feature2': 'Sync across your devices',
  'landing.pricing.hosted.feature3': 'Server records are kept in full, not deleted when a period ends',
  'landing.pricing.hosted.cta': 'Opening soon',
  'landing.pricing.hostedAi.name': 'Managed hosting + cloud AI',
  'landing.pricing.hostedAi.priceCny': 'CNY 12 / month',
  'landing.pricing.hostedAi.priceUsd': '$12 / month',
  'landing.pricing.hostedAi.regionCny': 'Mainland China',
  'landing.pricing.hostedAi.regionUsd': 'International',
  'landing.pricing.hostedAi.body': 'Everything above, plus our cloud AI. Note that this step sends your content to our servers, and it is not covered by end-to-end encryption.',
  'landing.pricing.hostedAi.feature1': 'Everything in the tier above',
  'landing.pricing.hostedAi.feature2': 'Cloud AI, 300 actions a month',
  'landing.pricing.hostedAi.feature3': 'AI on your own endpoint is unaffected -- still free and unlimited',
  'landing.pricing.hostedAi.cta': 'Opening soon',
  'landing.pricing.statusNote': 'Checkout is not wired up yet: the payment channels for both mainland China and international are still waiting on merchant approval, so orders cannot be placed today.',

  // ── Landing · final CTA ───────────────────────────────────
  'landing.cta.title': 'Your task list should never become an asset someone else owns',
  'landing.cta.lede': 'Self-hosting is free forever: once the source is public, one command brings up your own server and moves your data back to your machine.',
  'landing.cta.selfHost': 'Self-host now',

  // ── Landing · footer ──────────────────────────────────────
  'landing.footer.tagline': 'Local-first task management. Data lands on your device first; the cloud is only a sync channel.',
  'landing.footer.group.product': 'Product',
  'landing.footer.group.gettingStarted': 'Getting started',
  'landing.footer.pricing': 'Pricing',
  'landing.footer.syncHow': 'How sync works',
  'landing.footer.privacy': 'Privacy',
  'landing.footer.selfHostServer': 'Self-host the server',
  'landing.footer.disclaimer': 'A personal project, not affiliated with TickTick or its affiliates.',
  'landing.footer.licenseNote': 'heyta is MIT licensed; third-party attribution is itemised in THIRD_PARTY_LICENSES.md.',

  // ── Landing · sync ────────────────────────────────────────
  'landing.sync.title': 'Every device writes on its own, and they still do not collide',
  'landing.sync.ledeLead': 'Every change is a separate record carrying "which changes I have seen". When two devices edit the same task at once, the server marks it as a concurrent conflict and ',
  'landing.sync.ledeStrong': 'hands the decision to you',
  'landing.sync.ledeTail': ', instead of quietly letting the later write overwrite the earlier one.',
  'landing.sync.canvasLabel': 'Encrypted change records flowing between three devices, with one marked as a concurrent conflict',
  'landing.sync.legendChange': 'One change',
  'landing.sync.legendDevice': 'One device',

  // ── Landing · mockup sample data ──────────────────────────
  'landing.mock.inbox': 'Inbox',
  'landing.mock.today': 'Today',
  'landing.mock.projectsSection': 'Lists',
  'landing.mock.project.work': 'Work',
  'landing.mock.project.personal': 'Personal',
  'landing.mock.project.reading': 'Reading',
  'landing.mock.date': 'Date',
  'landing.mock.countdown': 'Countdown',
  'landing.mock.synced': 'Synced',
  'landing.mock.composeHint': 'Add a task and press Enter (try "tomorrow", "next Wednesday", "!1")',
  'landing.mock.add': 'Add',

  'landing.mock.task.quote': 'Reply to the client about the quote',
  'landing.mock.task.weeklyReport': 'Compile the weekly report and send it to the team',
  'landing.mock.task.q4Draft': 'Draft the Q4 goal breakdown',
  'landing.mock.task.bookChapter': 'Read chapter 3 of "The 7 Habits of Highly Effective People"',
  'landing.mock.task.dentist': 'Book the dentist and confirm next Wednesday morning',
  'landing.mock.task.photoBackup': 'Sort out the photo backup from last month',
  'landing.mock.task.expense': 'Submit the September expense report',
  'landing.mock.task.quarterlyReview': 'Prepare material for the quarterly review',
  'landing.mock.due.overdue2': '2 days overdue',
  'landing.mock.due.today1800': 'Today 18:00',
  'landing.mock.due.in3Days': '3 days left',
  'landing.mock.due.in5Days': '5 days left',
  'landing.mock.due.tomorrow': 'Tomorrow',
  'landing.mock.due.done': 'Done',

  'landing.mock.habit.earlyRise': 'Early rise',
  'landing.mock.habit.earlyRise.streak': '12-day streak',
  'landing.mock.habit.reading': 'Read 30 minutes',
  'landing.mock.habit.reading.streak': '5-day streak',
  'landing.mock.habit.running': 'Running',
  'landing.mock.habit.running.streak': '3-day streak',
  'landing.mock.heat.less': 'Less',
  'landing.mock.heat.more': 'More',

  'landing.mock.focus.phase': 'Focus',
  'landing.mock.focus.pause': 'Pause',
  'landing.mock.focus.stop': 'Stop',
  'landing.mock.focus.linkedTask': 'Linked task: {task}',
  'landing.mock.focus.completedToday': '3 focus sessions completed today',
  'landing.mock.focus.break5': '5-minute break',
  'landing.mock.focus.startNext': 'Start next session',

  // ═══════════════════════════════════════════════════════════
  // Web (apps/web)
  // ═══════════════════════════════════════════════════════════

  // ── Web · shell and navigation ────────────────────────────
  // The shell (`App.tsx`) is the first thing a user sees: sidebar, view tabs,
  // empty states. Nav labels are stored as **keys** (`NavEntry.labelKey`), so
  // switching language re-renders them without rebuilding the arrays.
  'web.shell.nav.aria': 'Main navigation',
  'web.shell.nav.quadrantSection': 'Quadrants',
  'web.shell.nav.inbox': 'Inbox',
  'web.shell.nav.today': 'Today',
  'web.shell.nav.completed': 'Completed',
  'web.shell.nav.quadrant': 'Quadrants',
  'web.shell.nav.project': 'List',
  'web.shell.nav.tasks': 'Tasks',
  'web.shell.nav.q1': 'Important and urgent',
  'web.shell.nav.q2': 'Important, not urgent',
  'web.shell.nav.q3': 'Urgent, not important',
  'web.shell.nav.q4': 'Not important, not urgent',
  'web.shell.views.aria': 'Views',
  'web.shell.views.habits': 'Habits',
  'web.shell.views.focus': 'Focus timer',
  'web.shell.views.timeline': 'Timeline',
  'web.shell.views.settings': 'Settings',
  'web.shell.dueMode.aria': 'Due date display',
  'web.shell.dueMode.date': 'Date',
  'web.shell.dueMode.countdown': 'Countdown',
  // Icon-only buttons on a task row: the name must carry the task title, or a
  // screen reader reads out a run of indistinguishable "button"s.
  'web.shell.tasks.complete': 'Complete: {title}',
  'web.shell.tasks.uncomplete': 'Mark incomplete: {title}',
  'web.shell.tasks.delete': 'Delete: {title}',
  // Empty states: every list needs one, and it must say what to do next -
  // a blank screen makes users think the app is broken.
  'web.shell.empty.all.title': 'Your inbox is empty',
  'web.shell.empty.all.hint': 'Add your first task in the box above',
  'web.shell.empty.today.title': 'Nothing is due today',
  'web.shell.empty.today.hint': 'Give a task a due date and it will show up here',
  'web.shell.empty.completed.title': 'No completed tasks yet',
  'web.shell.empty.completed.hint': 'Try completing a task',
  'web.shell.empty.quadrant.title': 'This quadrant is empty',
  'web.shell.empty.quadrant.hint': 'Mark a task important and give it a due date',

  // ── Web · error screen ────────────────────────────────────
  'web.error.storage.title': 'Could not initialize local storage',
  'web.error.storage.hint': 'Your browser may have disabled its local database (common in private mode). Turn off private mode or try another browser.',
  'web.error.storage.blockedHint': 'Another tab is holding the old version open. Close the other windows or tabs of this app, then reload.',
  'web.error.storage.bugHint': 'This looks like a problem in heyta rather than something you did. Restart and try again; if it keeps happening, send us the details below.',
  'web.error.details': 'Technical details',

  // ── Web · sync bar ────────────────────────────────────────
  'web.sync.resolveConflicts': 'Resolve conflicts',
  'web.sync.a11y.syncNow': 'Sync now',
  'web.sync.settings.title': 'Sync settings',
  'web.sync.settings.close': 'Close sync settings',
  'web.sync.serverUrl.label': 'Server URL',
  'web.sync.token.label': 'Access token',
  'web.sync.password.label': 'End-to-end encryption passphrase',
  // Three-part split around `<strong>`, same as the landing page's
  // ledeLead/ledeStrong/ledeTail: markup boundaries are never guessed from
  // symbols inside a translated string.
  'web.sync.password.lead': 'The passphrase is ',
  'web.sync.password.strong': 'never',
  'web.sync.password.tail': ' saved to disk - it lives only in this session. If it is lost, already-synced data can no longer be decrypted, so keep it safe. Sync is refused without it; the server only accepts end-to-end encrypted payloads.',
  'web.sync.clearCredentials': 'Clear credentials',
  'web.sync.saveAndSync': 'Save and sync',
  // Status wording. It used to come back as Chinese from
  // `features/sync/store.ts`'s `describeStatus`; the sentence now lives in the
  // shell so the English UI is not permanently Chinese.
  'web.sync.status.idle': 'Not synced yet',
  'web.sync.status.uploading': 'Uploading...',
  'web.sync.status.downloading': 'Downloading...',
  'web.sync.status.synced': 'Synced',
  'web.sync.status.offline': 'Offline - changes queued, will retry when back online',
  'web.sync.status.conflict': '{count} changes need your review',
  // Singular sibling; one change is the common case.
  'web.sync.status.conflictOne': '{count} change needs your review',
  'web.sync.status.errorRetryable': 'Sync error: {message}',
  // ── Web · conflict dialog ─────────────────────────────────
  // Payload summary: `text` is the user's own words (never translated) and
  // `fields` reports only a count - field names such as `completedAt` are
  // internal identifiers and must not reach user-visible copy.
  'web.conflict.payload.empty': '(empty)',
  'web.conflict.payload.fields': '{count} fields changed',
  // Singular sibling; one changed field is the common case.
  'web.conflict.payload.fieldsOne': '{count} field changed',
  'web.conflict.title': 'Both sides changed these {count} places',
  // Singular sibling. This one deliberately does not use the number:
  // "this one place" reads better than "these 1 places".
  'web.conflict.titleOne': 'Both sides changed this one place',
  'web.conflict.bodyLead': 'heyta will not decide which version to keep for you - picking one automatically would ',
  'web.conflict.bodyStrong': 'silently drop',
  'web.conflict.bodyTail': ' the changes made on the other side. Look at each one before you choose. Anything you skip stays local and is never lost.',
  'web.conflict.newer': 'Newer',
  'web.conflict.remoteUnavailable': 'The version from this side is unavailable',
  'web.conflict.keepThis': 'Keep this version',
  'web.conflict.side.local': 'This device',
  'web.conflict.side.remote': 'Other devices',
  'web.conflict.close': 'Handle later',

  // ── Web · focus timer ─────────────────────────────────────
  'web.focus.a11y.progress': 'Progress {percent}%',
  'web.focus.phase.work': 'Focus',
  'web.focus.phase.break': 'Break',
  'web.focus.a11y.start': 'Start focus session',
  'web.focus.start': 'Start',
  'web.focus.a11y.pause': 'Pause focus session',
  'web.focus.pause': 'Pause',
  'web.focus.a11y.stop': 'Stop focus session',
  'web.focus.stop': 'Stop',
  'web.focus.task.label': 'Linked task (optional)',
  'web.focus.task.none': 'No task',
  'web.focus.completedToday': 'Completed {count} focus sessions today',
  // Singular sibling; a count of 1 is reachable.
  'web.focus.completedTodayOne': 'Completed {count} focus session today',
  // The store carries only `{ reason }` (raw text from the failing layer, i.e.
  // data); the sentence is assembled here so the English UI stays English.
  'web.focus.error.saveFailed': 'Could not save the focus record: {reason}',

  // ── Web · habits ──────────────────────────────────────────
  'web.habits.addPlaceholder': 'New habit, for example "Drink water"',
  'web.habits.addLabel': 'New habit name',
  'web.habits.add': 'Add habit',
  'web.habits.empty': 'No habits yet. Add one to start checking in.',
  'web.habits.streak.current': 'Streak {count} days',
  // Singular sibling; a streak of 1 is reachable.
  'web.habits.streak.currentOne': 'Streak {count} day',
  'web.habits.streak.longest': 'Longest {count} days',
  // Singular sibling; a longest streak of 1 is reachable.
  'web.habits.streak.longestOne': 'Longest {count} day',
  'web.habits.a11y.checkIn': 'Check in "{name}"',
  'web.habits.a11y.undo': 'Undo check-in for "{name}" today',
  'web.habits.checkedIn': 'Checked in',
  'web.habits.checkIn': 'Check in',

  // ── Web · lists and tags ──────────────────────────────────
  'web.projects.ariaLabel': 'Lists and tags',
  'web.projects.heading': 'Lists',
  'web.projects.newPlaceholder': 'New list',
  'web.projects.newLabel': 'New list name',
  'web.projects.add': 'Add list',
  'web.projects.delete': 'Delete list "{name}"',
  'web.tags.heading': 'Tags',
  'web.tags.newPlaceholder': 'New tag',
  'web.tags.newLabel': 'New tag name',
  'web.tags.add': 'Add tag',
  'web.tags.delete': 'Delete tag "{name}"',

  // ── Web · per-row "organize" (list + tags) ────────────────
  'web.organize.summary': 'Organize task "{title}"',
  'web.organize.projectLabel': 'List',
  'web.organize.projectSelect': 'List that task "{title}" belongs to',
  'web.organize.inbox': 'Inbox',
  'web.organize.tagsLegend': 'Tags',
  'web.organize.tagToggle': 'Add or remove tag "{name}" on task "{title}"',
  'web.organize.noTags': 'No tags yet — create one under "Tags" on the left.',

  // ── Web · quadrants ───────────────────────────────────────
  'web.quadrant.do': 'Do now',
  'web.quadrant.q1': 'Important and urgent',
  'web.quadrant.plan': 'Schedule',
  'web.quadrant.q2': 'Important, not urgent',
  'web.quadrant.delegate': 'Delegate',
  'web.quadrant.q3': 'Urgent, not important',
  'web.quadrant.drop': 'Drop',
  'web.quadrant.q4': 'Not important, not urgent',
  'web.quadrant.a11y.cell': 'Quadrant: {title}, {hint}',
  'web.quadrant.dropHere': 'Drag a task here',
  'web.quadrant.dragging': 'Dragging a task',
  'web.quadrant.footnote': 'Urgency is derived from the due date. To make a task actually land in the cell you drop it on, dragging also adjusts the due date beyond setting "important": dropping into an urgent cell pushes it to within an hour; dropping into a non-urgent cell clears it.',

  // ── Web · timeline ────────────────────────────────────────
  // The timeline lays out each task's checklist plus AI estimates as a Gantt
  // chart. A task with nothing to schedule is **not** silently skipped:
  // a blank area reads as "the view is broken", so every block explains itself.
  'web.timeline.aria.empty': 'Timeline',
  'web.timeline.aria.group': 'Timeline: {count} tasks',
  // Singular sibling; the catalog has no ICU, so the caller branches.
  'web.timeline.aria.groupOne': 'Timeline: {count} task',
  'web.timeline.empty': 'No tasks to schedule yet. Create one in the inbox, then add a few checklist items (or let AI break it down), and the timeline will have something to show.',
  'web.timeline.aiEstimate': 'AI estimate: {duration} (whole task)',
  'web.timeline.noChecklist': 'This task has no schedulable checklist yet. Write a few to-dos in its note, or let AI break it down once; for now it is scheduled as a single block.',
  // {count} is always >= 2 here (the split problem only exists with several
  // checklist items), so there is deliberately no singular sibling.
  'web.timeline.unattributable': 'The AI estimate of {duration} covers the whole task and cannot be split across {count} checklist items. Those items use the default duration instead of inventing a per-step estimate.',

  // ── Web · Gantt chart ─────────────────────────────────────
  // Duration units. `formatMinutes` is the single implementation for minute
  // counts (bars, axis ticks, ranges), so the unit must come from here too -
  // otherwise English UI would render "90 分钟". The English side uses
  // abbreviations (`min` / `h`): they do not inflect, so one key suffices.
  'web.gantt.minutes': '{count} min',
  'web.gantt.hours': '{count} h',
  'web.gantt.hoursMinutes': '{hours} h {minutes} min',
  'web.gantt.title': 'Timeline',
  'web.gantt.empty': 'This plan is still empty - the checklist has no schedulable items yet. Write a few to-dos in the note, then come back.',
  'web.gantt.aria.group': 'Timeline: {count} items, total {total}',
  // Singular sibling; the catalog has no ICU, so the caller branches.
  'web.gantt.aria.groupOne': 'Timeline: {count} item, total {total}',
  'web.gantt.span': '{count} items · total {total}',
  // Singular sibling; the catalog has no ICU, so the caller branches.
  'web.gantt.spanOne': '{count} item · total {total}',
  'web.gantt.rangeFrom': 'from {when}',
  'web.gantt.today': 'Today · day {day}',
  'web.gantt.dayBand': 'Day {day}',
  'web.gantt.unestimatedSummary': '{count} unestimated, using {duration}',
  // Singular sibling; the catalog has no ICU, so the caller branches.
  'web.gantt.unestimatedSummaryOne': '{count} unestimated, using {duration}',
  'web.gantt.aiSummary': '{count} scheduled with AI estimates',
  // Singular sibling; the catalog has no ICU, so the caller branches.
  'web.gantt.aiSummaryOne': '{count} scheduled with an AI estimate',
  'web.gantt.durationDefault': 'Not estimated (using {duration})',
  'web.gantt.durationAi': 'About {duration} · AI estimate',
  'web.gantt.durationManual': 'About {duration}',
  'web.gantt.dependsOn': 'Depends on: {title}',
  'web.gantt.overlap': 'Overlaps its dependency',

  // ═══════════════════════════════════════════════════════════
  // Web · AI (breakdown / capture / duration / prioritize / settings / memory)
  // ═══════════════════════════════════════════════════════════
  //
  // The four panels share the disclosure copy ("who gets it / what is sent /
  // how long it is kept"). Sharing is deliberate: one wording per fact, so the
  // promise made to the user cannot diverge between panels.
  //
  // `web.ai.feature.*` and `web.ai.needs.*` are deliberately two sets of
  // feature names, matching the source: the settings page and the capability
  // hints already used different wording (`One-sentence capture` vs
  // `Quick capture`). This pass only migrates, it does not rewrite product copy.
  //
  // Pure punctuation (the list separator and paired brackets) is NOT a catalog
  // entry: a zh entry must contain an ideograph, so those live in
  // `apps/web/src/features/ai/locale-punctuation.ts`.

  'web.ai.action.cancel': 'Cancel',
  'web.ai.action.send': 'Send',
  'web.ai.action.close': 'Close',
  'web.ai.action.retry': 'Retry',
  'web.ai.action.discard': 'Discard',
  'web.ai.loading.waiting': 'Waiting for the endpoint...',

  // ── Web · AI · pre-send disclosure (shared by all four panels) ──
  'web.ai.disclosure.heading': 'Confirm before sending',
  'web.ai.disclosure.destinationLead': 'Sending to: ',
  'web.ai.disclosure.model': 'Model {model}',
  'web.ai.disclosure.local': 'Data stays on this device',
  'web.ai.disclosure.remote': 'Data leaves this device',
  'web.ai.disclosure.fallbackLead': 'If it fails, these are tried in order: ',
  'web.ai.disclosure.retentionLead': 'Retention: ',
  // "How long is it kept" now comes from the structured disclosure
  // (`disclosure.retentionDisclosure.kind`), not from the cross-package Chinese
  // compatibility sentence `retentionText`. Those sentences stay in
  // `packages/ai` (a zero-dependency package used by the CLI and
  // check-ai-coverage); the web shell simply has no production consumer left.
  'web.ai.disclosure.retentionNotApplicable': 'Data does not leave this device, so there is no server-side retention.',
  'web.ai.disclosure.retentionThirdParty': 'Retention is decided by your own endpoint; heyta has no way to know.',
  // Panel-side fallback for when an endpoint reports no retention policy. The
  // real disclosure chain in `packages/ai` is handled separately (plan §9).
  'web.ai.disclosure.retentionUndecided': 'Undecided - this endpoint stays disabled until heyta explains it clearly.',
  'web.ai.health.ok': 'OK',
  'web.ai.health.failing': 'Recent failures: {failures}',
  'web.ai.health.circuitOpen': 'Temporarily stopped (recent failures: {failures}; retrying in {retryInSeconds}s)',
  'web.ai.disclosure.fieldsLead': 'These fields will be sent: ',
  // Two parts around `<strong>`; the final period sits inside the strong part
  // because a punctuation-only zh entry would be rejected by the catalog test.
  'web.ai.disclosure.e2eeLead': 'Task content on this device is end-to-end encrypted, but this copy is ',
  'web.ai.disclosure.e2eeStrong': 'not protected by end-to-end encryption.',
  'web.ai.source.local': 'From this device',
  'web.ai.source.remote': 'From the cloud',

  'web.ai.noTarget.capture': 'No endpoint is configured for "One-sentence capture" yet. Add an endpoint in Settings and route the feature to it.',
  'web.ai.noTarget.breakdown': 'No endpoint is configured for "Task breakdown" yet. Add an endpoint in Settings and route the feature to it.',
  'web.ai.noTarget.duration': 'No endpoint is configured for "Time estimate" yet. Add an endpoint in Settings and route the feature to it.',
  'web.ai.noTarget.prioritize': 'No endpoint is configured for "Prioritization" yet. Add an endpoint in Settings and route the feature to it.',

  // ── Web · AI · feature / capability names ─────────────────
  'web.ai.feature.capture': 'One-sentence capture',
  'web.ai.feature.breakdown': 'Task breakdown',
  'web.ai.feature.prioritize': 'Priority suggestions',
  'web.ai.feature.duration': 'Time estimate',
  'web.ai.needs.capture': 'Quick capture',
  'web.ai.needs.breakdown': 'Task breakdown',
  'web.ai.needs.prioritize': 'Sorting suggestions',
  'web.ai.needs.duration': 'Time estimate',
  'web.ai.capability.structuredOutput': 'Structured output',
  'web.ai.capability.longContext': 'Long context',
  'web.ai.capability.vision': 'Image understanding',
  'web.ai.capability.toolCalling': 'Tool calling',

  // ── Web · AI · breakdown panel ────────────────────────────
  'web.ai.breakdown.button': 'AI breakdown',
  'web.ai.breakdown.runAria': 'Break down with AI: {title}',
  'web.ai.breakdown.applied': 'Written to the note',
  'web.ai.breakdown.disclosureAria': 'AI breakdown - confirm before sending',
  'web.ai.breakdown.proposalAria': 'AI breakdown result',
  'web.ai.breakdown.proposalHead': 'Breakdown result ({count} items)',
  'web.ai.breakdown.truncated': 'The result was too long, so only the first {count} items were kept.',
  'web.ai.breakdown.noteLead': 'Once confirmed it is appended as a',
  'web.ai.breakdown.noteStrong': 'Markdown checklist',
  'web.ai.breakdown.noteMid': 'to this task note, which is left otherwise untouched. Selected',
  'web.ai.breakdown.noteCount': '/ {count} items.',
  'web.ai.breakdown.apply': 'Write to note',
  'web.ai.breakdown.failedAria': 'AI breakdown failed',
  'web.ai.breakdown.failedHead': 'Could not break it down',
  'web.ai.breakdown.manual': 'Write an empty checklist myself',

  // ── Web · AI · capture panel ──────────────────────────────
  'web.ai.capture.button': 'AI capture',
  'web.ai.capture.runAria': 'Parse this sentence with AI',
  'web.ai.capture.applied': 'Candidate fields filled in',
  'web.ai.capture.disclosureAria': 'AI capture - confirm before sending',
  'web.ai.capture.textPreviewLead': 'Parsing: ',
  'web.ai.capture.proposalAria': 'AI capture result',
  'web.ai.capture.proposalHead': 'Capture result (editable)',
  'web.ai.capture.droppedLead': 'The model value for ',
  'web.ai.capture.droppedTail': ' cannot be used, so it was left blank - fill it in yourself if you need it.',
  'web.ai.capture.field.title': 'Title',
  'web.ai.capture.field.titleAria': 'Task title',
  'web.ai.capture.field.dueDate': 'Due date',
  'web.ai.capture.field.dueTime': 'Due time',
  'web.ai.capture.field.priority': 'Priority',
  'web.ai.capture.priority.none': 'Not set',
  'web.ai.capture.priority.low': 'Low',
  'web.ai.capture.priority.medium': 'Medium',
  'web.ai.capture.priority.high': 'High',
  'web.ai.capture.noteLead': 'Once confirmed, the fields above are written in. The due date is ',
  'web.ai.capture.noteStrong': 'the model estimate',
  'web.ai.capture.noteTail': ', so check it before saving.',
  'web.ai.capture.apply': 'Fill in task',
  'web.ai.capture.failedAria': 'AI capture failed',
  'web.ai.capture.failedHead': 'Could not capture',

  // ── Web · AI · duration panel ─────────────────────────────
  'web.ai.duration.button': 'AI estimate',
  'web.ai.duration.runAria': 'Estimate the time with AI: {title}',
  'web.ai.duration.applied': 'Time written in',
  'web.ai.duration.disclosureAria': 'AI time estimate - confirm before sending',
  'web.ai.duration.proposalAria': 'AI time estimate result',
  'web.ai.duration.proposalLead': 'Estimated at',
  'web.ai.duration.proposalRest': 'minutes ({humanized})',
  'web.ai.duration.minutes': '{minutes} min',
  'web.ai.duration.hours': '{hours} h',
  'web.ai.duration.hoursMinutes': '{hours} h {minutes} min',
  'web.ai.duration.clamped': 'The model value was outside the {min}-{max} minute range, so it was clamped to {minutes} minutes.',
  'web.ai.duration.basis.none': 'No usable history this time - only the model general judgement, which may be wrong.',
  'web.ai.duration.basis.historyLead': 'Based on your last',
  'web.ai.duration.basis.historyMid': 'actual/planned ratios',
  'web.ai.duration.basis.historyOverflow': '(you have {total} records in total; only the most recent {max} are sent to limit egress)',
  'web.ai.duration.note': 'Once confirmed, this number is written into the task time estimate. You can change it at any time.',
  'web.ai.duration.apply': 'Use this number',
  'web.ai.duration.manualLead': 'Enter your own:',
  'web.ai.duration.manualAria': 'Manual time estimate (minutes)',
  'web.ai.duration.manualUnit': 'minutes',
  'web.ai.duration.retry': 'Try again',
  'web.ai.duration.failedAria': 'AI time estimate failed',
  'web.ai.duration.failedHead': 'Could not estimate',

  // ── Web · AI · prioritize panel ───────────────────────────
  'web.ai.prioritize.button': 'AI prioritize',
  'web.ai.prioritize.runAria': 'Prioritize these tasks with AI',
  'web.ai.prioritize.applied': 'Applied',
  'web.ai.prioritize.disclosureAria': 'AI prioritize - confirm before sending',
  'web.ai.prioritize.proposalAria': 'AI priority suggestions',
  'web.ai.prioritize.proposalHead': 'Priority suggestions ({count} items)',
  'web.ai.prioritize.truncated': 'There were too many tasks, so only the first {max} were sent; the rest were not ranked this time.',
  'web.ai.prioritize.countLead': 'This will send',
  'web.ai.prioritize.countTail': 'tasks (no notes, tags or lists).',
  'web.ai.prioritize.noteLead': 'Once confirmed, the',
  'web.ai.prioritize.noteStrong': 'priority field',
  'web.ai.prioritize.noteMid': 'of these tasks is written. Notes, tags and lists are left untouched. Selected',
  'web.ai.prioritize.noteCount': '/ {count} items.',
  'web.ai.prioritize.apply': 'Apply priorities',
  'web.ai.prioritize.failedAria': 'AI prioritize failed',
  'web.ai.prioritize.failedHead': 'Could not sort',
  'web.ai.prioritize.priority.high': 'High',
  'web.ai.prioritize.priority.medium': 'Medium',
  'web.ai.prioritize.priority.low': 'Low',
  'web.ai.prioritize.priority.none': 'None',

  // ── Web · AI · settings panel ─────────────────────────────
  // The heading changed from the bare Latin `AI` to `AI settings`: a zh entry
  // must contain an ideograph, and the gate requires every bare literal in a
  // migrated file to go through `t()`.
  'web.ai.settings.title': 'AI settings',
  'web.ai.settings.enabled.label': 'Enable AI features',
  'web.ai.settings.enabled.note': 'While this is off, heyta sends data nowhere.',
  'web.ai.settings.memory.label': 'Let AI remember my preferences',
  'web.ai.settings.memory.note': 'Inferred from your own history (breakdown granularity, phrasing habits, time-estimate bias, and so on). Inference happens only on this device and is never uploaded; with it off, AI still works, it just does not know you.',
  'web.ai.settings.allowRemote.label': 'Allow remote endpoints',
  'web.ai.settings.allowRemote.note': 'While this is off, only on-device endpoints are used (data does not leave this device).',
  'web.ai.settings.remote.lead': 'Remote endpoints can see your task content in plaintext. This path is ',
  'web.ai.settings.remote.strong': 'not protected by end-to-end encryption',
  'web.ai.settings.remote.tail': ', and it is a different channel from task sync. Each feature needs separate consent.',
  'web.ai.settings.endpoints.title': 'Endpoints',
  // The leading `heyta` comes from `common.brand`, so this starts at the verb.
  'web.ai.settings.managed.offer': 'will soon offer',
  'web.ai.settings.managed.rest': 'a cloud AI service (still in development, not yet available). Until then you need to connect an endpoint yourself (on-device or remote). The hosted mode is different in kind: with it, your task content reaches the heyta servers ',
  'web.ai.settings.managed.strongPlain': 'in plaintext',
  'web.ai.settings.managed.mid': ', so it is ',
  'web.ai.settings.managed.strongNot': 'not',
  'web.ai.settings.managed.tail': ' end-to-end encrypted - we will label it separately as an exception.',
  'web.ai.settings.endpoints.empty': 'No endpoints yet. You can add an on-device endpoint - it needs no consent and data does not leave the device.',
  'web.ai.settings.field.name': 'Name',
  'web.ai.settings.field.url': 'Address',
  'web.ai.settings.field.model': 'Model',
  'web.ai.settings.field.capability': 'Capabilities',
  'web.ai.settings.nameAria': 'Name for {name}',
  'web.ai.settings.urlAria': 'Address for {name}',
  'web.ai.settings.modelAria': 'Model for {name}',
  'web.ai.settings.capabilityAria': 'Capability {capability} for {name}',
  'web.ai.settings.keyAria': 'Key for {name}',
  'web.ai.settings.keyKnown': 'Already set for this session',
  'web.ai.settings.keyPlaceholder': 'Enter key',
  'web.ai.settings.keyRemember': 'Remember (this session)',
  'web.ai.settings.deleteAria': 'Delete endpoint {name}',
  'web.ai.settings.tag.local': 'On-device, data stays here',
  'web.ai.settings.tag.remote': 'Remote, data leaves this device',
  'web.ai.settings.presetAdd': 'Add {name}',
  'web.ai.settings.presetAdded': 'Added {name}',
  'web.ai.settings.addCustom': 'Add custom endpoint',
  'web.ai.settings.customLabel': 'Custom endpoint {n}',
  // Preset name and prerequisite. The originals live in `@heyta/ai`'s
  // `AI_ENDPOINT_PRESETS` as cross-package data, which the gate cannot see
  // (a variable is rendered). The English values are new: without them the
  // English UI would show Chinese. Unknown preset ids fall back to the
  // cross-package value (there are only these two on-device presets today).
  'web.ai.settings.preset.ollama.label': 'On-device Ollama',
  'web.ai.settings.preset.ollama.prerequisite': 'Install Ollama first and pull a model (for example ollama pull qwen3:8b).',
  'web.ai.settings.preset.lmStudio.label': 'On-device LM Studio',
  'web.ai.settings.preset.lmStudio.prerequisite': 'Turn on the local server inside LM Studio (default port 1234).',
  'web.ai.settings.features.title': 'Features',
  'web.ai.settings.features.hintLead': 'Pick which endpoint serves which feature.',
  'web.ai.settings.features.hintStrong': 'List order is try order',
  'web.ai.settings.features.hintTail': ' (earlier ones are tried first).',
  'web.ai.settings.features.empty': 'Add an endpoint first',
  'web.ai.settings.consentLead': '"{feature}" has a remote endpoint, so your consent to send data out is required.',
  'web.ai.settings.grant': 'Allow',
  // Trailing space: the missing-capability list is spliced in right after.
  'web.ai.settings.gapLead': 'Warning: "{feature}" needs ',
  'web.ai.settings.gapMid': ', but ',
  'web.ai.settings.gapTail': 'does not declare it - the feature will never work.',
  'web.ai.settings.gapFix': 'Add it to "{name}"',
  'web.ai.settings.granted': 'Data egress allowed',
  'web.ai.settings.revoke': 'Revoke',
  'web.ai.settings.localApi.title': 'On-device API',
  'web.ai.settings.localApi.hintLead': 'Let other programs on this machine (editors, scripts, AI assistants) read and write your tasks.',
  'web.ai.settings.localApi.hintStrong': 'Off by default, and each tool must be enabled separately.',
  // The `**bold**` markers are carried over verbatim (they render literally).
  // That is a pre-existing display bug; this pass migrates copy only.
  'web.ai.settings.localApi.source.part1': 'These settings live only in the **browser**. What actually makes the MCP service work is the config file',
  'web.ai.settings.localApi.source.file': 'File ~/.heyta/local-api.json',
  'web.ai.settings.localApi.source.part2': ', generated from the command line:',
  'web.ai.settings.localApi.source.command': 'Command heyta-ai local-api init',
  'web.ai.settings.localApi.source.part3': '(it generates a token and prints the client config snippet). The two sides do **not** sync automatically for now.',
  'web.ai.settings.localApi.enabled.label': 'Enable on-device API',
  'web.ai.settings.localApi.enabled.note': 'Listens only on {address} and is not exposed to the local network.',
  'web.ai.settings.localApi.token.label': 'Access token',
  'web.ai.settings.localApi.token.aria': 'On-device API access token',
  'web.ai.settings.localApi.token.hint': 'The token guards against other programs on this machine, not network attacks - without it, any program can read all your tasks.',
  'web.ai.settings.localApi.kind.write': 'Changes data',
  'web.ai.settings.localApi.kind.read': 'Read-only',
  // Moved here from `WEB_KEY_STORAGE_NOTICE` in `aiStore.ts`. It must sit next
  // to the key inputs: otherwise "I have to type it again" looks like a bug.
  'web.ai.settings.keyNotice': 'There is no system keychain in the browser, so keys are kept only in the memory of this tab. You will need to enter them again after closing or refreshing the page. Desktop keeps keys in the system keychain.',
  'web.ai.settings.reset': 'Reset to defaults (everything off)',
  // Rejection reason -> primary copy. Pick the catalog entry by `reason` code
  // instead of rendering the cross-package Chinese `message`: the gate cannot
  // see `{r.message}` (a variable, not a literal), but the user can.
  // These come from `@heyta/ai`'s `validateEndpointUrl()` (four reasons).
  'web.ai.settings.endpointError.unparseable': 'The endpoint address cannot be parsed: {url}',
  'web.ai.settings.endpointError.badScheme': 'The endpoint must be http or https; it is currently {protocol}',
  'web.ai.settings.endpointError.credentialsInUrl': 'Do not put a username/password in the endpoint address - use a separate credential field.',
  'web.ai.settings.endpointError.plaintextRemote': 'Remote endpoints must use https. Sending plaintext http to a remote endpoint means your task content crosses the network in the clear - that conflicts with the heyta end-to-end encryption promise. (On-device endpoints are exempt: http://localhost:11434/v1 is allowed.)',
  // Same idea, from `@heyta/local-api`'s `validateLocalApiConfig()` (three reasons).
  'web.ai.settings.localApi.error.badPort': 'The port must be an integer from 1-65535; it is currently {port}.',
  'web.ai.settings.localApi.error.tokenRequired': 'Enabling the on-device API requires an access token. Without a token, any program on this machine can read all your tasks.',
  'web.ai.settings.localApi.error.notLoopback': 'Only loopback addresses (127.0.0.1 / ::1 / localhost) may be listened on; "{address}" was rejected. Listening on other addresses exposes your tasks to others on the same network - if you really want that, the right approach is your own reverse proxy, not having heyta listen publicly.',

  // ── Web · AI · memory panel ───────────────────────────────
  // Preference names and evidence sentences - see the zh file for why these
  // duplicate `preferenceEvidenceText()`. A web test compares them byte for byte.
  'web.memory.pref.estimateBias': 'Estimate bias',
  'web.memory.pref.deepWorkWindow': 'Deep work window',
  'web.memory.pref.leadTime': 'Lead time',
  'web.memory.pref.granularity': 'Task granularity',
  'web.memory.pref.titleStyle': 'Writing style',
  'web.memory.pref.feedbackGranularity': 'Adopted breakdown size',
  'web.memory.pref.feedbackKeepRatio': 'Suggestion keep ratio',

  'web.memory.evidence.estimateBiasAccurate': 'Based on {samples} focus sessions, your time estimates are accurate (tasks take about {multiplier}x what you planned)',
  'web.memory.evidence.estimateBiasUnder': 'Based on {samples} focus sessions, you tend to underestimate how long tasks take - they actually take about {multiplier}x your estimate',
  'web.memory.evidence.estimateBiasOver': 'Based on {samples} focus sessions, you tend to overestimate how long tasks take - they actually take about {multiplier}x your estimate',
  'web.memory.evidence.deepWorkWindow': 'Based on {samples} focus sessions, {percent}% of them fall between {from} and {to}',
  'web.memory.evidence.leadTimeAhead': 'Based on {samples} completed tasks, you finish about {days} days early on average',
  'web.memory.evidence.leadTimeLate': 'Based on {samples} completed tasks, you finish about {days} days late on average',
  'web.memory.evidence.leadTimeOnTime': 'Based on {samples} completed tasks, you usually finish right on the due date',
  'web.memory.evidence.granularity': 'Across your {samples} checklist tasks, the median is {items} items',
  'web.memory.evidence.titleStyle': 'Based on {samples} tasks, your titles are {lang}, averaging {median} characters{emoji}',
  'web.memory.evidence.titleStyleLangZh': 'mostly in Chinese',
  'web.memory.evidence.titleStyleLangEn': 'mostly in English',
  'web.memory.evidence.titleStyleLangMixed': 'a mix of Chinese and English',
  'web.memory.evidence.titleStyleEmoji': ', often with emoji',
  'web.memory.evidence.feedbackGranularity': 'Based on the {adopted} breakdowns you accepted, you usually want {items} items',
  'web.memory.evidence.feedbackKeepRatioAlmostAll': 'Based on {adopted} accepted suggestions, you almost always keep the whole AI breakdown',
  'web.memory.evidence.feedbackKeepRatioTrimmed': 'Based on {adopted} accepted suggestions, you usually keep only {percent}% - the AI gives you too much',
  'web.memory.evidence.feedbackKeepRatioPartial': 'Based on {adopted} accepted suggestions, you usually keep about {percent}% of the items',

  'web.memory.off': 'Memory is off - heyta does not infer your preferences, and AI receives nothing about who you are. AI features still work as usual.',
  'web.memory.known.title': 'What I have learned about you',
  'web.memory.known.empty': 'I do not know you well yet. After a while, habits I summarise from your own data will show up here.',
  'web.memory.withheld.title': 'Not known yet',
  // "Not known yet" reasons - see the zh file for why these moved out of the domain.
  'web.memory.withheld.noData.estimateBias': 'No completed focus sessions yet',
  'web.memory.withheld.noData.deepWorkWindow': 'No focus sessions yet',
  'web.memory.withheld.noData.leadTime': 'No completed tasks with a due date yet',
  'web.memory.withheld.noData.granularity': 'No task notes with a checklist yet',
  'web.memory.withheld.noData.titleStyle': 'No task titles yet',
  'web.memory.withheld.noData.feedbackGranularity': 'No AI breakdowns accepted yet',
  'web.memory.withheld.noData.feedbackKeepRatio': 'No comparable suggestions yet',
  'web.memory.withheld.notEnoughSamples.estimateBias': '{remaining} more focus sessions needed',
  'web.memory.withheld.notEnoughSamples.deepWorkWindow': '{remaining} more focus sessions needed',
  'web.memory.withheld.notEnoughSamples.leadTime': '{remaining} more completed tasks with a due date needed',
  'web.memory.withheld.notEnoughSamples.granularity': '{remaining} more checklist tasks needed',
  'web.memory.withheld.notEnoughSamples.titleStyle': '{remaining} more tasks needed',
  'web.memory.withheld.notEnoughSamples.feedbackGranularity': '{remaining} more accepted suggestions needed',
  'web.memory.withheld.notEnoughSamples.feedbackKeepRatio': '{remaining} more accepted suggestions needed',
  'web.memory.withheld.notStableEnough.estimateBias': 'Your session durations vary too much to pin down a stable estimate bias',
  'web.memory.withheld.notStableEnough.deepWorkWindow': 'Your focus times are too scattered to show a fixed deep work window',
  'web.memory.withheld.notStableEnough.leadTime': 'Your lead times vary too much to show a fixed habit',
  'web.memory.withheld.notStableEnough.granularity': 'Your checklist sizes vary too much to compute a stable granularity',
  'web.memory.withheld.notStableEnough.titleStyle': 'Your title lengths vary too much to compute a stable writing style',
  'web.memory.withheld.notStableEnough.feedbackGranularity': 'The sizes you accept vary too much to show a fixed preference',
  'web.memory.withheld.notStableEnough.feedbackKeepRatio': 'How much you keep varies too much to show a fixed habit',
  'web.memory.withheld.disabled': 'This preference is turned off',
  // Subscription notice - moved here from the web shell's temporary local table (round 16).
  'web.subscription.notice.expired.title': 'Hosted sync has expired',
  'web.subscription.notice.expired.body': 'This device no longer syncs through heyta\'s hosted service. Your tasks, lists and settings are all still here and were not changed — you can point the app at your own server at any time and syncing resumes immediately.',
  'web.subscription.notice.refused.title': 'Hosted sync is unavailable',
  'web.subscription.notice.refused.body': 'The server did not allow hosted sync for this device. Your tasks, lists and settings are all still here and were not changed.',
  'web.subscription.notice.localData': 'Everything on this device can still be viewed, edited and exported — no renewal needed.',
  'web.subscription.notice.selfHost': 'Use your own server',
  'web.subscription.notice.a11y': 'Hosted sync status notice',
  // AI panel failure states - see the zh file for why these moved out of app-host.
  'web.ai.failure.breakdown.emptyTitle': 'This task has no title, so there is nothing to break down.',
  'web.ai.failure.breakdown.unparseable': 'The model did not return a recognisable list of steps. Try again, or write them yourself.',
  'web.ai.failure.capture.emptyText': 'Nothing has been entered yet.',
  'web.ai.failure.capture.unparseable': 'The model response could not be read as task fields. Try again, or fill them in yourself.',
  'web.ai.failure.duration.emptyTitle': 'This task has no title, so no estimate can be made.',
  'web.ai.failure.duration.unparseable': 'The model response did not contain a recognisable number of minutes (as in “about two hours”). Try again, or enter one yourself.',
  'web.ai.failure.prioritize.emptyTasks': 'There are no tasks to rank.',
  'web.ai.failure.prioritize.unparseable': 'The model response did not contain recognisable priority suggestions. Try again, or adjust them yourself.',
  'web.ai.failure.capture.textTooLong': 'That sentence is too long ({length} characters, limit {max}). One-line capture only handles short sentences.',
  'web.ai.failure.aiUnavailable': 'The AI service is unavailable right now.',
  'web.ai.failure.cause.notConfigured': 'AI is not enabled. Choose \u201cuse my own AI endpoint\u201d in Settings to turn it on.',
  'web.ai.failure.cause.egressNotAuthorized': 'This feature needs your permission before any data leaves the device.',
  'web.ai.failure.cause.noRoute': 'No available endpoint can handle this feature. Check that an endpoint is enabled with a valid address.',
  'web.ai.failure.cause.fallbackNeedsConsent': 'The first endpoint failed, and the fallback would send your data elsewhere, so no automatic switch was made. It needs your permission again.',
  'web.ai.failure.cause.network': 'Could not reach the endpoint. Check your network and that the address is reachable.',
  'web.ai.failure.cause.httpError': 'The endpoint returned an error status. Check the API key, balance and model name.',
  'web.ai.failure.cause.emptyResponse': 'The endpoint returned nothing. Try a different model.',
  'web.ai.failure.details': 'Technical details',

  // Module 2: route explanations + the endpoint disable switch.
  // Each sentence has to answer both "why" and "what do I do next" - a reason
  // without a next step leaves the user exactly where they were.
  'web.ai.routeExplain.remoteNotAllowed': 'Every endpoint is off this device, but \u201cAllow remote endpoints\u201d is off. Turn it on to give this feature a usable endpoint.',
  'web.ai.routeExplain.capabilityMissing': 'The endpoint does not declare the capability this feature needs. Tick it in Settings, or the endpoint will never be selected.',
  'web.ai.routeExplain.endpointDisabled': 'The endpoint this feature routes to is disabled. Re-enable it in Settings, or route the feature somewhere else.',
  'web.ai.routeExplain.endpointUrlRejected': 'The endpoint address did not pass validation (it must be a reachable http/https address). Fix it in Settings.',
  'web.ai.routeExplain.circuitOpen': 'The endpoint failed repeatedly and has been tripped for now. Wait for the cooldown, or check its address and key in Settings.',
  'web.ai.routeExplain.endpointMissing': 'This feature routes to an endpoint that no longer exists, so the configuration is out of sync. Pick an endpoint again in Settings.',
  'web.ai.routeExplain.unknown': 'No endpoint is usable, and the reason cannot be determined from the current configuration. Check endpoints and routes in Settings.',
  'web.ai.action.openSettings': 'Open settings',

  'web.ai.settings.endpointDisabled.label': 'Disable',
  'web.ai.settings.endpointDisabled.aria': 'Disable endpoint: {name}',
  'web.ai.settings.endpointDisabled.note': 'A disabled endpoint is skipped by routing; its configuration and key are kept.',
  'web.ai.settings.endpointDisabled.tag': 'Disabled',
  'web.memory.forgotten.title': 'You have forgotten',
  'web.memory.forgotten.note': 'I will not use this one again.',
  'web.memory.forget': 'Forget',
  'web.memory.forgetAria': 'Forget "{name}"',
  'web.memory.restore': 'Restore',
  'web.memory.footer': 'This inference happens only on this device and is never uploaded. What is sent to AI is just the one summary that the current decision needs, and you are told before it is sent.',

  // ── Web · memory panel · "said vs done" gaps ──────────────
  // 🔴 Deliberately does NOT render the Chinese sentences built by the domain
  //    layer's `describeFocusGaps()`; the shell composes from `FocusGap` facts.
  'web.memory.gap.title': 'Said vs done',
  'web.memory.gap.note': 'For these tasks you set a priority, marked them important, or gave a due date, but almost no focus time went in.',
  'web.memory.gap.empty': 'No clear gap right now - you are spending time on what matters.',
  // Honest degradation when the store is not ready / the event log cannot be read:
  // it must NOT pretend "postponed 0 times".
  'web.memory.gap.unavailable': 'Postponements cannot be computed right now (the event log is unavailable), so gaps are hidden.',
  'web.memory.gap.declared': 'Importance you declared: {declared}',
  'web.memory.gap.focusMinutes': 'Actual focus: {minutes} min',
  'web.memory.gap.postponed': 'Postponed {count} times',
  // Singular sibling: the count is very often 1 ("postponed once" is the common case).
  'web.memory.gap.postponedOne': 'Postponed {count} time',
  'web.memory.gap.overdue': 'Overdue by {days} days',
  // Singular sibling: "overdue by 1 day" must not read "1 days".
  'web.memory.gap.overdueOne': 'Overdue by {days} day',

  // ── Web · capture composer ────────────────────────────────
  // The embedded `formatRemainingUntil()` still returns Chinese (cross-package,
  // `packages/domain` is not converted yet - plan §7.1); this pass migrates only
  // the shell wording and the brackets around it.
  'web.capture.placeholder': 'Add a task, press Enter to confirm (you can write "tomorrow", "next Wednesday", "!1")',
  'web.capture.addLabel': 'New task title',
  'web.capture.add': 'Add',
  'web.capture.matches.aria': 'Recognized fields',
  'web.capture.priority.high': 'High priority',
  'web.capture.priority.medium': 'Medium priority',
  'web.capture.priority.low': 'Low priority',
  'web.capture.priority.none': 'No priority',
  'web.capture.rejected': 'Ignored (treated as title text)',
  'web.capture.restoreAria': 'Restore match: {raw}',
  'web.capture.ignoreAria': 'Ignore match: {raw}',
  'web.capture.unused': 'Not used, still in the title',
  'web.capture.previewLead': 'Actual title:',
  'web.capture.previewEmpty': '(empty)',

  // ── Mobile (apps/mobile) ──────────────────────────────────
  'mobile.common.today': 'Today',
  'mobile.common.cancel': 'Cancel',
  'mobile.common.add': 'Add',
  'mobile.common.prevMonth': 'Previous month',
  'mobile.common.nextMonth': 'Next month',
  'mobile.common.sync': 'Sync',
  'mobile.common.complete': 'Mark complete',
  'mobile.common.uncomplete': 'Mark incomplete',
  'mobile.common.badge.new': 'New content',
  'mobile.common.badge.count': '{count} items',
  // 🔴 Singular sibling. The catalog deliberately has no plural/ICU support
  // (see `packages/i18n/src/types.ts`), so callers branch on the count and
  // pick this key when it is exactly 1. Without it English renders "1 items".
  'mobile.common.badge.countOne': '{count} item',

  // Weekday column headers, index 0 = Monday (matches monthGrid / isoWeekday).
  'mobile.weekday.mon': 'Mon',
  'mobile.weekday.tue': 'Tue',
  'mobile.weekday.wed': 'Wed',
  'mobile.weekday.thu': 'Thu',
  'mobile.weekday.fri': 'Fri',
  'mobile.weekday.sat': 'Sat',
  'mobile.weekday.sun': 'Sun',

  // ── Mobile · bottom tab bar ───────────────────────────────
  'mobile.tab.tasks': 'Tasks',
  'mobile.tab.calendar': 'Calendar',
  'mobile.tab.focus': 'Focus',
  'mobile.tab.profile': 'Profile',

  // ── Mobile · due dates ────────────────────────────────────
  'mobile.due.overdue': '{days} days overdue',
  // Singular sibling; `remainingDays === -1` is reachable.
  'mobile.due.overdueOne': '{days} day overdue',
  'mobile.due.tomorrow': 'Tomorrow',
  'mobile.due.dayAfterTomorrow': 'Day after tomorrow',
  'mobile.due.remaining': '{days} days left',

  // ── Mobile · recurrence rules ─────────────────────────────
  //
  // The domain layer (`packages/domain/src/recurrence.ts`) only answers "what
  // does this rule mean" (`recurrenceParts` → freq/interval/dates). The wording
  // lives here, because `describeRecurrence` returned a Chinese sentence and it
  // leaked straight into the English UI — a cross-package return value the
  // language gate cannot see.
  //
  // ⚠️ Some fragments carry a leading space (`monthDay.n` = ' day {n}'): they are
  // pieces spliced into a sentence, never sentences on their own. The old
  // implementation branched on "does this start with a digit" to decide the
  // spacing; putting the space in the fragment removes that branch entirely.
  //
  // English needs no fragment-vs-sentence split for `yearDay.n`: "every year on
  // September 26" wants a bare `26`, while "every month on day 14" reads better
  // with the word.
  // The list separator is deliberately **not** a catalog entry: it lives in a
  // `Record<Locale, string>` in `apps/mobile/src/lib/recurrence-display.ts`.
  // It is orthography, not copy, and the Chinese value is a bare punctuation
  // mark — which the catalog test rejects, correctly: an entry with no
  // ideograph cannot identify its own language.
  'mobile.recurrence.daily': 'every day',
  'mobile.recurrence.dailyEvery': 'every {n} days',
  'mobile.recurrence.weekly': 'every week',
  'mobile.recurrence.weeklyEvery': 'every {n} weeks',
  'mobile.recurrence.weeklyOn': 'every week on {days}',
  'mobile.recurrence.weeklyOnEvery': 'every {n} weeks on {days}',
  'mobile.recurrence.monthly': 'every month',
  'mobile.recurrence.monthlyEvery': 'every {n} months',
  // "day of month" and "nth weekday of month" share one sentence shape.
  'mobile.recurrence.monthlyOn': 'every month on {days}',
  'mobile.recurrence.monthlyOnEvery': 'every {n} months on {days}',
  'mobile.recurrence.yearly': 'every year',
  'mobile.recurrence.yearlyEvery': 'every {n} years',
  'mobile.recurrence.yearlyInMonths': 'every year in {months}',
  'mobile.recurrence.yearlyInMonthsEvery': 'every {n} years in {months}',
  'mobile.recurrence.yearlyOnMonthDays': 'every year on {months} {days}',
  'mobile.recurrence.yearlyOnMonthDaysEvery': 'every {n} years on {months} {days}',
  'mobile.recurrence.monthDay.n': 'day {n}',
  'mobile.recurrence.yearDay.n': '{n}',
  'mobile.recurrence.day.last': 'the last day',
  'mobile.recurrence.day.beforeEnd': '{n} days before the end',
  'mobile.recurrence.byDay.plain': '{weekday}',
  'mobile.recurrence.byDay.nth': 'the {ordinal} {weekday}',
  'mobile.recurrence.byDay.last': 'the last {weekday}',
  'mobile.recurrence.byDay.beforeLast': 'the {ordinal}-to-last {weekday}',
  // Ordinals are words here and digits in Chinese, so the `byDay.*` templates
  // take `{ordinal}` (never `{n}`), and `ordinal.n` is the one that takes `{n}`
  // for counts past five.
  'mobile.recurrence.ordinal.1': 'first',
  'mobile.recurrence.ordinal.2': 'second',
  'mobile.recurrence.ordinal.3': 'third',
  'mobile.recurrence.ordinal.4': 'fourth',
  'mobile.recurrence.ordinal.5': 'fifth',
  'mobile.recurrence.ordinal.n': '{n}th',
  'mobile.recurrence.weekday.mo': 'Monday',
  'mobile.recurrence.weekday.tu': 'Tuesday',
  'mobile.recurrence.weekday.we': 'Wednesday',
  'mobile.recurrence.weekday.th': 'Thursday',
  'mobile.recurrence.weekday.fr': 'Friday',
  'mobile.recurrence.weekday.sa': 'Saturday',
  'mobile.recurrence.weekday.su': 'Sunday',
  'mobile.recurrence.month.1': 'January',
  'mobile.recurrence.month.2': 'February',
  'mobile.recurrence.month.3': 'March',
  'mobile.recurrence.month.4': 'April',
  'mobile.recurrence.month.5': 'May',
  'mobile.recurrence.month.6': 'June',
  'mobile.recurrence.month.7': 'July',
  'mobile.recurrence.month.8': 'August',
  'mobile.recurrence.month.9': 'September',
  'mobile.recurrence.month.10': 'October',
  'mobile.recurrence.month.11': 'November',
  'mobile.recurrence.month.12': 'December',

  // ── Mobile · priority ─────────────────────────────────────
  'mobile.priority.none': 'None',
  'mobile.priority.low': 'Low',
  'mobile.priority.medium': 'Medium',
  'mobile.priority.high': 'High',
  'mobile.priority.badge': '{level} priority',

  // ── Mobile · tasks screen ─────────────────────────────────
  'mobile.tasks.title': 'Tasks',
  'mobile.tasks.new': 'New task',
  'mobile.tasks.composer.placeholder': 'What needs doing?',
  'mobile.tasks.composer.close': 'Close the new-task panel',
  'mobile.tasks.loadError.title': 'Could not open the local database',
  'mobile.tasks.loadError.hint': 'Your data is local and will not be lost. Restarting the app usually recovers it.',
  'mobile.tasks.loadError.detail': 'Technical details: {detail}',
  'mobile.tasks.loading.title': 'Opening local data',
  'mobile.tasks.loading.hint': 'Restoring the state from last time. One moment.',
  'mobile.tasks.summary.empty': 'No tasks yet',
  'mobile.tasks.summary.counts': '{pending} to do, {completed} done',
  'mobile.tasks.empty.title': 'Nothing scheduled for today',
  'mobile.tasks.empty.hint': 'Tap the plus button in the corner and write down your first task.',
  'mobile.tasks.mode.date': 'Date',
  'mobile.tasks.mode.countdown': 'Countdown',
  'mobile.tasks.view.list': 'List',
  'mobile.tasks.view.quadrant': 'Quadrants',
  'mobile.quadrant.q1': 'Important & urgent',
  'mobile.quadrant.q2': 'Important, not urgent',
  'mobile.quadrant.q3': 'Urgent, not important',
  'mobile.quadrant.q4': 'Neither',
  'mobile.tasks.quadrant.empty': 'Nothing here yet',
  'mobile.tasks.group.overdue': 'Overdue',
  'mobile.tasks.group.inbox': 'Inbox',
  'mobile.tasks.group.completed': 'Completed',
  'mobile.tasks.a11y.complete': 'Complete: {title}',
  'mobile.tasks.a11y.uncomplete': 'Mark as not done: {title}',
  'mobile.tasks.a11y.open': 'Open task: {title}',
  'mobile.tasks.a11y.openRepeat': 'Open task: {title}, repeats: {repeat}',
  'mobile.tasks.a11y.delete': 'Delete task: {title}',

  // ── Mobile · calendar ─────────────────────────────────────
  'mobile.calendar.title': 'Calendar',
  'mobile.calendar.monthTitle': '{month}/{year}',
  'mobile.calendar.dayTitle': '{weekday}, {month}/{day}',
  'mobile.calendar.dayEmpty': 'Nothing is due on this day.',
  'mobile.calendar.backToToday': 'Back to today',
  'mobile.calendar.footnote': 'Tasks without a due date are not on the calendar; they live in the Inbox on the Tasks tab.',
  'mobile.calendar.a11y.dayWithTasks': '{date}, {count} tasks',
  // Singular sibling; a day with exactly one due task is common.
  'mobile.calendar.a11y.dayWithTasksOne': '{date}, {count} task',
  'mobile.calendar.a11y.dayNoTasks': '{date}, no tasks',
  'mobile.calendar.a11y.markDone': 'Mark done: {title}',
  'mobile.calendar.a11y.unmarkDone': 'Mark as not done: {title}',

  // ── Mobile · date picker ──────────────────────────────────
  'mobile.datePicker.clear': 'Clear',
  'mobile.datePicker.dayLabel': '{month}/{day}',
  'mobile.quickDate.tomorrow': 'Tomorrow',
  'mobile.quickDate.weekend': 'This weekend',
  'mobile.quickDate.nextWeek': 'Next Monday',

  // ── Mobile · focus screen ─────────────────────────────────
  'mobile.focus.title': 'Focus',
  'mobile.focus.kind.work': 'Focus',
  'mobile.focus.kind.shortBreak': 'Short break',
  'mobile.focus.kind.longBreak': 'Long break',
  'mobile.focus.phase.paused': 'Paused',
  'mobile.focus.phase.idle': 'Ready when you are',
  'mobile.focus.phase.working': 'Focusing',
  'mobile.focus.phase.breaking': 'On a break',
  'mobile.focus.action.pause': 'Pause',
  'mobile.focus.action.resume': 'Resume',
  'mobile.focus.action.startWork': 'Start focusing',
  'mobile.focus.action.startBreak': 'Start a break',
  'mobile.focus.abort': 'Give up this round',
  // Sentences shown when persisting/opening fails. `{reason}` is the underlying
  // implementation's raw text (data, not translated), so the shell composes it.
  'mobile.focus.error.saveFailed': 'Could not save the focus record: {reason}',
  'mobile.focus.error.openFailed': 'Could not open the local database: {reason}',
  'mobile.focus.roundLength': 'This round: {duration}',
  'mobile.focus.linkedTask': 'Linked task',
  'mobile.focus.changeTask': 'Pick another task',
  'mobile.focus.noPending': 'No pending tasks yet. Create one on the Tasks tab and link it to your focus session.',
  'mobile.focus.a11y.linkTask': 'Link task: {title}',
  'mobile.focus.stats.completed': 'Completed',
  'mobile.focus.stats.focusDuration': 'Focus time',
  'mobile.focus.stats.aborted': 'Abandoned',
  'mobile.focus.stats.completedValue': '{count}',
  'mobile.focus.stats.abortedValue': '{count}',
  'mobile.focus.duration.minutes': '{minutes} min',
  'mobile.focus.duration.hours': '{hours} h',
  'mobile.focus.duration.hoursMinutes': '{hours} h {minutes} min',

  // ── Mobile · task detail sheet ────────────────────────────
  'mobile.detail.title': 'Task details',
  'mobile.detail.close': 'Close task details',
  'mobile.detail.field.title': 'Title',
  'mobile.detail.field.dueDate': 'Due date',
  'mobile.detail.field.repeat': 'Repeat',
  'mobile.detail.repeat.none': 'Does not repeat',
  'mobile.detail.repeat.current': 'Current: {rule}',
  'mobile.detail.repeat.daily': 'Daily',
  'mobile.detail.repeat.weekly': 'Weekly',
  'mobile.detail.repeat.weekdays': 'Weekdays',
  'mobile.detail.repeat.monthly': 'Monthly',
  'mobile.detail.field.priority': 'Priority',
  'mobile.detail.field.important': 'Important',
  'mobile.detail.important.hint': 'Urgency is derived from the due date — you do not set it.',
  'mobile.detail.field.project': 'List',
  'mobile.detail.project.inbox': 'Inbox',
  'mobile.detail.project.create': 'New list',
  'mobile.detail.project.newPlaceholder': 'List name',
  'mobile.lists.empty': 'No lists yet',
  'mobile.lists.empty.hint': 'Tasks that are not filed anywhere live in the Inbox — nothing is lost.',
  'mobile.lists.nameLabel': 'List name',
  'mobile.lists.newPlaceholder': 'Name your new list',
  'mobile.lists.add': 'New list',
  'mobile.lists.removeHint': 'Deleting a list does not delete its tasks — they go back to the Inbox.',
  'mobile.lists.remove': 'Delete list "{name}"',
  'mobile.profile.section.tags': 'Tags',
  'mobile.tags.empty': 'No tags yet',
  'mobile.tags.empty.hint': 'Tags group tasks across lists — for example "Urgent" or "Waiting".',
  'mobile.tags.nameLabel': 'Tag name',
  'mobile.tags.newPlaceholder': 'Name your new tag',
  'mobile.tags.add': 'New tag',
  'mobile.tags.removeHint': 'Deleting a tag does not delete any task — it only removes that tag from them.',
  'mobile.tags.remove': 'Delete tag "{name}"',
  'mobile.detail.field.tags': 'Tags',
  'mobile.detail.tags.empty': 'No tags yet — create one on the Me tab first.',
  'mobile.detail.important.on': 'Mark as important',
  'mobile.detail.important.off': 'Remove important',
  'mobile.detail.markIncomplete': 'Mark as not done',
  'mobile.detail.markComplete': 'Mark as done',
  'mobile.detail.delete': 'Delete',

  // ── Mobile · profile screen ───────────────────────────────
  'mobile.profile.title': 'Profile',
  'mobile.profile.section.sync': 'Sync',
  'mobile.profile.section.status': 'Status',
  'mobile.profile.section.language': 'Language',
  'mobile.profile.section.lists': 'Lists',
  // Stated plainly: a choice that silently resets on restart looks like a bug.
  'mobile.profile.language.hint': 'This choice lasts for the current session only; reopening the app returns to the device language.',
  'mobile.profile.serverUrl.label': 'Server address',
  'mobile.profile.serverUrl.hint': 'On an emulator use 10.0.2.2 (pointing at this computer); on a real device use your LAN address.',
  'mobile.profile.transport.plaintext': 'Plaintext connection, and the target does not look like a local network. The access token travels the network in the clear and can be intercepted. Task contents are still end-to-end encrypted, but use https:// on the public internet.',
  'mobile.profile.transport.plaintextLocal': 'Plaintext connection (local network). Task contents are end-to-end encrypted, but the access token travels the network in the clear, so only use this on a trusted network.',
  'mobile.profile.token.label': 'Access token',
  'mobile.profile.token.placeholder': 'Obtained after signing in to the server',
  'mobile.profile.password.label': 'End-to-end encryption passphrase',
  'mobile.profile.password.hint': 'Kept in memory only; re-enter it after restarting the app. The server never sees the plaintext.',
  'mobile.profile.sync.busy': 'Syncing...',
  'mobile.profile.sync.now': 'Sync now',
  'mobile.profile.sync.notConfigured': 'Fill in the server address and access token to sync.',
  'mobile.profile.sync.slowKdf': 'This device has no WebAssembly, so key derivation runs in pure JS batch by batch: the first sync can take anywhere from tens of seconds to several minutes (the more history, the longer). Later syncs in the same session are fast. Task contents are unaffected and offline use still works.',
  'mobile.profile.pending.label': 'Pending upload',
  'mobile.profile.pending.loading': 'Reading...',
  'mobile.profile.pending.allUploaded': 'All uploaded',
  'mobile.profile.pending.count': '{count} items',
  // Singular sibling; `1` is the most likely pending count.
  'mobile.profile.pending.countOne': '{count} item',
  'mobile.profile.lastSync.label': 'Last successful sync',
  'mobile.profile.lastSync.never': 'Never',
  'mobile.profile.clearCredentials': 'Clear credentials saved on this device',
  'mobile.profile.footnote': 'Credentials are kept in memory only and must be re-entered after the app fully exits.',
  'mobile.profile.conflict.body': 'Both sides changed these places, and heyta will not choose for you - picking one automatically would silently drop the other side. Nothing is lost, but nothing uploads until you choose.',
  'mobile.profile.conflict.open': 'Review one by one',

  // ── Mobile · conflict sheet ───────────────────────────────
  'mobile.conflict.title': 'Both sides changed these {count} places',
  // Singular sibling. `count` is always >= 1 here, so the plural branch is
  // only correct from 2 upward -- exactly the case this key covers.
  'mobile.conflict.titleOne': 'Both sides changed this one place',
  'mobile.conflict.body': 'heyta will not decide which version to keep for you - picking one automatically would silently drop the other side. Look at each one before choosing; anything you skip stays on this device and is not lost.',
  'mobile.conflict.close': 'Deal with it later',
  'mobile.conflict.newer': 'Newer',
  'mobile.conflict.remoteUnavailable': 'This side is unavailable',
  'mobile.conflict.keepThis': 'Keep this version',
  'mobile.conflict.side.local': 'This device',
  'mobile.conflict.side.remote': 'Other device',
  'mobile.conflict.position': 'Item {index} of {total}',
  'mobile.conflict.blocked.remoteMissing': 'The other version is unavailable, so you can only keep this device version',
  'mobile.conflict.choice.local': 'Kept this device version',
  'mobile.conflict.choice.remote': 'Kept the other device version',
  'mobile.conflict.reason.concurrent': 'Two devices changed it without knowing about each other',
  'mobile.conflict.reason.superseded': 'This change was based on a version that is no longer the latest',
  'mobile.conflict.reason.timestampOrTie': 'The two changes are too close in time to order',
  'mobile.conflict.reason.localTimestamp': 'This device change is newer',
  'mobile.conflict.reason.remoteDeleteWins': 'The other device deleted it',
  'mobile.conflict.reason.localDeleteWins': 'This device deleted it',
  'mobile.conflict.reason.remoteArchive': 'The other device archived it',
  'mobile.conflict.reason.localArchive': 'This device archived it',
  'mobile.conflict.reason.fallback': 'Both sides made different changes to the same thing',
  // Payload summary: `text` is the user's own words (never translated) and
  // `fields` reports only a count - field names are internal identifiers.
  'mobile.conflict.payload.empty': '(empty)',
  'mobile.conflict.payload.fields': '{count} fields changed',
  // Singular sibling; one changed field is the common case.
  'mobile.conflict.payload.fieldsOne': '{count} field changed',

  'mobile.entity.TASK': 'Task',
  'mobile.entity.PROJECT': 'List',
  'mobile.entity.TAG': 'Tag',
  'mobile.entity.NOTE': 'Note',
  'mobile.entity.TASK_REPEAT_CFG': 'Repeat rule',
  'mobile.entity.REMINDER': 'Reminder',
  'mobile.entity.HABIT': 'Habit',
  'mobile.entity.HABIT_LOG': 'Check-in record',
  'mobile.entity.FOCUS_SESSION': 'Focus session',
  'mobile.entity.AI_FEEDBACK': 'AI usage record',
  'mobile.entity.PREFERENCE_CORRECTION': 'Preference correction',
  'mobile.entity.GLOBAL_CONFIG': 'Global settings',
  'mobile.entity.MIGRATION': 'Data migration',
  'mobile.entity.RECOVERY': 'Disaster recovery',
  'mobile.entity.ALL': 'All data',

  // ── Mobile · sync status ──────────────────────────────────
  'mobile.sync.idle': 'Not synced yet',
  'mobile.sync.downloading': 'Downloading...',
  'mobile.sync.uploading': 'Uploading...',
  'mobile.sync.synced': 'Up to date',
  'mobile.sync.offline': 'Offline',
  'mobile.sync.conflict': 'You have {count} conflicts to resolve',
  // Singular sibling; a single conflict is the common case.
  'mobile.sync.conflictOne': 'You have {count} conflict to resolve',
  'mobile.sync.error': 'Sync failed',
} satisfies Record<MessageKey, string>;