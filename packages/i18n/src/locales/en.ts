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
  'common.sync.error.undecryptablePage': 'Nothing on this page could be decrypted with the current password, so syncing is paused and no history was skipped - this usually means the end-to-end encryption password does not match the data on the server. Check your password and sync again.',
  'common.sync.error.uploadRejected': 'Some changes were rejected by the server and are not in the cloud — retrying them has stopped. See sync details.',

  // ── Landing · generic ─────────────────────────────────────
  'landing.skipLink': 'Skip to main content',

  // ── Landing · nav ─────────────────────────────────────────
  'landing.nav.ariaLabel': 'Page navigation',
  'landing.nav.github': 'GitHub repository',
  'landing.nav.languageMenu': 'Choose language',
  'landing.nav.capabilities': 'Capabilities',
  'landing.nav.showcase': 'Screens',
  'landing.nav.sync': 'Sync',
  'landing.nav.pricing': 'Pricing',
  'landing.nav.selfhost': 'Self-host',

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
  // The showcase's fourth screen: the timeline (step 4 of the `timeline` cut).
  'landing.showcase.timeline.title': 'See whether the week actually fits',
  'landing.showcase.timeline.body': 'Each task is laid out by its estimated duration: a checklist is spread across its items when it can be, and says "cannot be attributed" when it cannot — no tidy-looking illusion.',

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
  // 🔴 No shell commands, repository paths or database internals in this
  // section -- the criterion and the reason live in
  // `apps/landing/tests/public-copy-register.spec.tsx`. What has to be typed
  // line by line belongs to the runbook the `guide.*` keys link to, because
  // that file updates with the build while a copy on this page does not.
  'landing.selfhost.step1.title': 'Start the server',
  'landing.selfhost.step1.body': 'One docker compose file brings the sync service and the database up on your own machine. The server stores only ciphertext; it has no key to decrypt it.',
  'landing.selfhost.step2.title': 'Point the client at it',
  'landing.selfhost.step2.body': 'On first launch, pick one: your own server address or the hosted option. You can switch whenever you want.',
  'landing.selfhost.step3.title': 'You set the secrets',
  'landing.selfhost.step3.body': 'There are no default credentials — it is not a zero-thought installer, but every step is documented.',
  'landing.selfhost.guide.title': 'The full walk-through lives in the repo',
  'landing.selfhost.guide.body': 'Every command, requirement and config file is in the self-hosting guide; follow it once and it comes up.',
  'landing.selfhost.guide.link': 'Open the self-host guide',

  // ── Landing · pricing ─────────────────────────────────────
  // 🔴 These prices must match the server price list and both legal texts --
  // `scripts/check-pricing-consistency.mjs` reads these entries and asserts all
  // three agree. Read docs/reference/pricing-and-entitlements.md before changing.
  // ASCII punctuation only in this table (see the file header).
  'landing.pricing.ariaLabel': 'Pricing and entitlements',
  'landing.pricing.title': 'The software is free forever. Only hosting and AI cost money.',
  'landing.pricing.lede': 'Every feature of the app itself is free: self-hosting is free forever, with no validation and no device limit. Exactly two things cost money -- us running the server for you, and our cloud AI.',
  'landing.pricing.noFeatureGate': 'Neither paid tier withholds a feature -- the extra you pay for the second tier buys our cloud AI, not unlocked functionality.',
  'landing.pricing.free.name': 'Open-source self-host',
  'landing.pricing.free.price': 'Free',
  'landing.pricing.free.period': 'forever',
  'landing.pricing.free.body': 'MIT-licensed on GitHub. Everything except our cloud AI is free forever -- no account, and nobody checks how long you have been using it. Point AI at your own endpoint and that is free and unlimited too.',
  'landing.pricing.free.feature1': 'Every feature except cloud AI, free forever',
  'landing.pricing.free.feature2': 'Unlimited devices',
  'landing.pricing.free.feature3': 'Your data and your keys stay with you',
  'landing.pricing.free.cta': 'Self-host now',
  'landing.pricing.hosted.name': 'Managed hosting',
  'landing.pricing.hosted.priceCny': 'CNY 5 / month',
  'landing.pricing.hosted.priceUsd': '$5 / month',
  'landing.pricing.hosted.regionCny': 'Mainland China',
  'landing.pricing.hosted.regionUsd': 'International',
  'landing.pricing.hosted.body': 'We run the relay for you. The data is still ciphertext, and we still cannot open it.',
  'landing.pricing.hosted.feature1': 'Every feature except cloud AI, same as self-hosting',
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
  'landing.pricing.statusNote': 'Checkout is wired up, but the payment channels for both mainland China and international are still waiting on merchant approval — orders cannot be placed today.',

  // ── Landing · final CTA ───────────────────────────────────
  'landing.cta.title': 'Your task list should never become an asset someone else owns',
  'landing.cta.lede': 'The code is open: self-hosting is free forever — one command brings up your own server and moves your data back to your machine.',
  'landing.cta.selfHost': 'Self-host now',
  // Same intent, the "it is live" state — swapped in at build time when
  // `VITE_APP_URL` is set (see lib/app-url.ts). Not a second feature.
  'landing.cta.useApp': 'Use it now',

  // ── Landing · footer ──────────────────────────────────────
  'landing.footer.tagline': 'Local-first task management. Data lands on your device first; the cloud is only a sync channel.',
  'landing.footer.group.product': 'Product',
  'landing.footer.group.gettingStarted': 'Getting started',
  'landing.footer.pricing': 'Pricing',
  'landing.footer.syncHow': 'How sync works',
  'landing.footer.privacy': 'Privacy',
  'landing.footer.selfHostServer': 'Self-host the server',
  'landing.footer.disclaimer': 'A personal project, not affiliated with TickTick or its affiliates.',
  'landing.footer.licenseNote': 'heyta is MIT licensed; the license obligations of every third-party component used are fulfilled.',
  'landing.cta.viewCode': 'View source on GitHub',
  'landing.footer.viewOnGithub': 'View on GitHub',
  'landing.footer.group.docs': 'Docs',
  'landing.footer.source': 'Source repository',
  'landing.footer.contributing': 'Contributing',
  'landing.footer.deployGuide': 'Self-hosting guide',
  'landing.footer.roadmap': 'Roadmap',
  'landing.footer.adr': 'Architecture decisions',
  'landing.footer.licenses': 'Third-party licenses',
  'landing.footer.docsIndex': 'Docs index',

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
  // The last two day ticks of the timeline mockup (the first two reuse
  // "Today / Tomorrow") plus its legend.
  'landing.mock.timeline.axis3': 'Day after',
  'landing.mock.timeline.axis4': 'Day 4',
  'landing.mock.timeline.legend': 'Solid bars follow your own estimate, dashed ones are AI estimates; when an estimate cannot be spread over sub-items it says so instead of faking a tidy bar.',
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
  'web.shell.nav.scopeAria': 'Scope of the current view',
  'web.shell.nav.inbox': 'Inbox',
  'web.shell.nav.today': 'Today',
  'web.shell.nav.completed': 'Completed',
  'web.shell.nav.quadrant': 'Quadrants',
  'web.shell.nav.project': 'List',
  'web.shell.nav.tag': 'Tag',
  'web.shell.search.placeholder': 'Search tasks',
  'web.shell.search.aria': 'Search tasks (title and note)',
  'web.shell.search.clear': 'Clear search',
  'web.shell.nav.tasks': 'Tasks',
  'web.shell.nav.q1': 'Important and urgent',
  'web.shell.nav.q2': 'Important, not urgent',
  'web.shell.nav.q3': 'Urgent, not important',
  'web.shell.nav.q4': 'Not important, not urgent',
  'web.shell.sidebar.resize': 'Resize the sidebar',
  'web.shell.views.aria': 'Views',
  'web.shell.views.groupMain': 'Main',
  'web.shell.modules.title': 'Feature modules',
  'web.shell.account.aria': 'Account',
  'web.shell.account.ariaAs': 'Account: {email}',
  'web.shell.account.settings': 'Settings',
  'web.shell.account.signOut': 'Sign out',
  'web.shell.nav.help': 'Help',

  // ── Notification centre + Activity (rewards centre) ─────────────────────
  // Entry point is the bell at the bottom of the rail (a sibling of "Help",
  // not a view tab). The panel has two tabs. The server sends kind + params;
  // all wording lives here.
  'web.inbox.aria': 'Notifications and activity',
  'web.inbox.trigger': 'Notifications',
  'web.inbox.badge.aria': '{count} unread notifications',
  'web.inbox.tabs.aria': 'Notifications and activity',
  'web.inbox.tab.notifications': 'Notifications',
  'web.inbox.tab.activity': 'Activity',
  'web.inbox.close': 'Close',
  'web.inbox.markAllRead': 'Mark all as read',
  'web.inbox.loading': 'Loading...',
  'web.inbox.error': 'Could not load. Please try again.',
  'web.inbox.retry': 'Retry',
  'web.inbox.unconfigured': 'Notifications arrive here once a sync server is configured.',
  'web.inbox.notifications.empty': 'No notifications yet',
  'web.inbox.activity.empty': 'No activities right now',
  'web.inbox.notification.referral.title': 'Invite reward granted',
  'web.inbox.notification.referral.body': '{name} activated. A {days}-day membership reward is now on your account.',
  'web.inbox.notification.referral.bodyUnknownActor': 'A friend activated. A {days}-day membership reward is now on your account.',
  'web.inbox.activity.invite.title': 'Invite friends, earn membership',
  'web.inbox.activity.invite.body': 'Send your invite code or link to a friend. Once they register and verify their email, you get {days} days of membership.',
  'web.inbox.activity.invite.codeLabel': 'My invite code',
  'web.inbox.activity.invite.copyCode': 'Copy code',
  'web.inbox.activity.invite.copyLink': 'Copy invite link',
  'web.inbox.activity.invite.copied': 'Copied',
  'web.inbox.activity.invite.copyFailed': 'Copy failed. Please select it manually.',
  'web.inbox.activity.invite.stats': 'Invited {invited}, activated {activated}, earned {days} days',
  'web.inbox.activity.invite.remaining': 'You can invite {remaining} more in this window',
  'web.inbox.activity.invite.listTitle': 'Invites',
  'web.inbox.activity.invite.status.activated': 'Activated, +{days} days',
  'web.inbox.activity.invite.status.pending': 'Waiting for email verification',
  'web.inbox.activity.invite.unknownName': 'A friend',
  'web.inbox.activity.invite.empty': 'No invites yet',
  'web.shell.modules.intro': 'Turn off what you do not use and it leaves the left nav. This device only.',
  'web.shell.modules.calendar.label': 'Calendar',
  'web.shell.modules.calendar.note': 'See what is due on which day.',
  'web.shell.modules.quadrant.label': 'Quadrants',
  'web.shell.modules.quadrant.note': 'Sort tasks into four boxes by importance and urgency.',
  'web.shell.modules.habits.label': 'Habits',
  'web.shell.modules.habits.note': 'Build habits and make discipline routine.',
  'web.shell.modules.timeline.label': 'Timeline',
  'web.shell.modules.timeline.note': 'Lay tasks out along a date axis.',
  'web.shell.modules.focus.label': 'Focus timer',
  'web.shell.modules.focus.note': 'Stay focused with a pomodoro timer.',
  'web.shell.modules.growth.label': 'Growth',
  'web.shell.modules.growth.note': 'See long-run trends and totals instead of today.',
  'web.shell.modules.notes.label': 'Notes',
  'web.shell.modules.notes.note': 'Jot something down without turning it into a task.',
  'web.shell.modules.savedHint': 'Saved - the left nav already changed.',
  'web.shell.views.groupMore': 'More',
  'web.shell.views.habits': 'Habits',
  'web.shell.views.focus': 'Focus timer',
  'web.shell.views.timeline': 'Timeline',
  'web.shell.views.growth': 'Growth',
  'web.shell.views.notes': 'Sticky notes',
  'web.shell.views.settings': 'Settings',
  'web.shell.settings.close': 'Close settings',
  'web.shell.dueMode.aria': 'Due date display',
  'web.shell.dueMode.date': 'Date',

  'web.settings.display.title': 'Display',
  'web.settings.display.dueNote': 'Show due dates on task rows as a date, or as a countdown to the deadline.',
  'web.shell.dueMode.countdown': 'Countdown',
  // Icon-only buttons on a task row: the name must carry the task title, or a
  // screen reader reads out a run of indistinguishable "button"s.
  'web.shell.tasks.complete': 'Complete: {title}',
  'web.shell.tasks.uncomplete': 'Mark incomplete: {title}',
  'web.shell.tasks.delete': 'Delete: {title}',

  // Task-list date group headers (Dida-style). Ordering/bucketing lives in
  // `groupTasksByDate` (@heyta/domain); only the wording lives here.
  'web.tasks.group.overdue': 'Overdue',
  'web.tasks.group.today': 'Today, {weekday}',
  'web.tasks.group.tomorrow': 'Tomorrow, {weekday}',
  'web.tasks.group.date': '{month}/{day}, {weekday}',
  'web.tasks.group.undated': 'No due date',
  'web.tasks.group.postpone': 'Postpone',
  'web.tasks.group.postponeAria': 'Postpone these {count} overdue tasks to today',

  // ── Task notes ──
  // 🔴 Before this there was no note input anywhere on the web: `Task.note` and
  // `setNote` both existed, but the only callers were AI breakdown and AI duration.
  // The data layer was wired (notes export and sync); only the last metre — a user
  // being able to write one — was missing. See `features/tasks/NoteEditor.tsx`.
  'web.note.toggle': 'Note',
  'web.note.placeholder': 'Write something (Markdown supported)',
  'web.note.a11y.edit': 'Edit the note on "{title}"',
  'web.note.hint': 'Saves when you leave the field',
  // ── 回收站 ── (Trash)
  // Entry point is the shell view tab (`VIEW_TABS` in `App.tsx`); the view
  // itself is `apps/web/src/features/trash/TrashView.tsx`. Deleting is still
  // a soft delete — this is where a user can see it and restore it. Permanent
  // deletion is a separate, confirmed, irreversible action.
  'web.trash.nav': 'Trash',
  'web.trash.intro': 'Deleted tasks land here. Restore one and it goes back where it was.',
  'web.trash.empty.title': 'Trash is empty',
  'web.trash.empty.hint': 'Tasks you delete show up here first',
  'web.trash.deletedAt': 'Deleted {date}',
  'web.trash.restore': 'Restore: {title}',
  'web.trash.purge': 'Delete permanently: {title}',
  'web.trash.confirm.title': 'Delete “{title}” permanently?',
  'web.trash.confirm.body': 'Once deleted permanently it leaves the trash and cannot be restored.',
  'web.trash.confirm.submit': 'Delete permanently',
  'web.trash.confirm.cancel': 'Cancel',
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
  'web.sync.serverUrl.placeholder': 'https://your-sync-server',
  'web.sync.token.label': 'Access token',
  'web.sync.password.label': 'End-to-end encryption passphrase',
  // Three-part split around `<strong>`, same as the landing page's
  // ledeLead/ledeStrong/ledeTail: markup boundaries are never guessed from
  // symbols inside a translated string.
  'web.sync.password.lead': 'The passphrase is ',
  'web.sync.password.strong': 'never',
  'web.sync.password.tail': ' saved to disk - it lives only in this session. If it is lost, already-synced data can no longer be decrypted, so keep it safe. Sync is refused without it; the server only accepts end-to-end encrypted payloads.',
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
  // ── Authentication ──
  // The server has had full authentication for a while; until now no client called
  // it. The only credential entry point was the hand-typed token field in sync
  // settings, and nothing told the user where a token comes from.
  // The email format check lives on the server (single source of truth); the
  // placeholder only shows the shape.
  'web.auth.title': 'Sign in or register',
  'web.auth.close': 'Close',
  'web.auth.open': 'Sign in or register to get a token',
  'web.auth.tokenHint': 'Access tokens are issued by the server. Sign in or register with the button above and the token is filled in automatically; if you already have one, paste it directly.',
  'web.auth.empty.title': 'No credentials yet',
  'web.auth.empty.body': 'Syncing needs an access token issued by the server. Sign in or register with your email to get one - the token is written into the sync settings below.',
  'web.auth.invite.label': 'Invite code (optional)',
  'web.auth.invite.placeholder': 'Invite code from a friend',
  'web.auth.invite.invalid': 'Invite codes are {length} letters or digits. Please check yours.',
  'web.auth.email.label': 'Email',
  'web.auth.email.placeholder': 'you@example.com',
  'web.auth.sendLoginLink': 'Send login link',
  'web.auth.register': 'Create account',
  'web.auth.passkey.register': 'Create an account with a passkey',
  'web.auth.passkey.login': 'Sign in with a passkey',
  'web.auth.passkey.unavailable': 'This browser or device does not support passkeys — use the email option above.',
  'web.auth.passkey.waiting': 'Complete the passkey step in the system prompt…',
  'web.auth.recovery.request': 'Lost your passkey? Email me a recovery link',
  'web.auth.terms.label': 'I agree to the terms of service and privacy policy published by this server',
  'web.auth.paste.label': 'Or paste a login link / token',
  'web.auth.paste.placeholder': 'Paste the link from your email, or the token itself',
  'web.auth.verify': 'Finish signing in',
  'web.auth.sent.login': 'If an account with that email exists, a login link is on its way. Open the link in the email, or paste it into the field above.',
  'web.auth.sent.register': 'Registration submitted. Check your email and open the verification link; come back here to sign in once verified.',
  'web.auth.sent.recovery': 'If an account with that email exists, a recovery link has been sent. Open it to register a new passkey for this account (this replaces the old one).',
  'web.auth.signedIn.title': 'Signed in',
  'web.auth.signedIn.body': 'The token has been written into the sync settings ({email}). Set the end-to-end encryption passphrase and syncing can start.',
  'common.auth.error.unconfigured': 'Fill in the server URL above first.',
  'common.auth.error.invalidInput': 'That email address or token does not look right - check it and try again.',
  'common.auth.error.notAllowed': 'This server does not allow registration with that email address.',
  'common.auth.error.unauthorized': 'That link is invalid or has expired. Send yourself a new one.',
  'common.auth.error.rateLimited': 'Too many requests - try again in a little while.',
  'common.auth.error.network': 'Could not reach the server. Check the URL and your connection.',
  'common.auth.error.server': 'The server is unavailable right now - try again later.',
  'common.auth.error.unknown': 'Signing in did not complete - try again.',
  'common.subtask.reject.taskNotFound': 'That task could not be found - it may have been deleted on another device.',
  'common.subtask.reject.parentNotFound': 'The task to move it under could not be found - it may have been deleted on another device.',
  'common.subtask.reject.self': 'A task cannot be moved under itself.',
  'common.subtask.reject.cycle': 'Cannot move it under one of its own subtasks - that would create a loop.',
  'common.subtask.reject.depthExceeded': 'Subtasks go at most three levels deep. Moving it there would exceed that.',
  'common.subtask.reject.childrenExceeded': 'That task already has the maximum number of subtasks. Tidy up first.',
  'common.subtask.reject.unknown': 'Could not move it. Try again.',
  'common.focus.error.unknownKind': 'This focus session was not saved: its type is not recognized.',
  'common.focus.error.nonPositivePlanned': 'This focus session was not saved: the planned length must be greater than zero.',
  'common.focus.error.missingCreatedAt': 'This focus session was not saved: it has no creation time.',
  'web.subtask.none': 'Subtask',
  'web.subtask.under': 'Under "{title}"',
  'web.subtask.trigger.aria': 'Move "{title}" under another task',
  'web.subtask.pick.label': 'Move under…',
  'web.subtask.pick.aria': 'Pick a parent task for: {title}',
  'web.subtask.option.topLevel': '(Top level)',
  'dev.shellHost.source': 'M2-B: data comes from the native shell (Jint + SQLite), not seed data - {note}',
  'dev.shellHost.waiting': 'Waiting for the host to push data…',
  'dev.shellHost.received': 'Received {count} item(s), {bytes} bytes raw',
  'dev.shellHost.noTasksField': 'The host payload has no tasks field',
  'dev.shellHost.tasksNotArray': 'tasks is not an array',
  'dev.shellHost.parseFailed': 'Could not parse the host payload',
  'dev.shellHost.noHostChannel': 'No host channel (not inside the WebView) - this click wrote nothing.',
  'common.auth.error.passkeyUnsupported': 'This browser or device does not support passkeys — use the email login link instead.',
  'common.auth.error.passkeyCancelled': 'The passkey step was cancelled or timed out. You can try again.',
  'common.auth.error.passkeyAlreadyRegistered': 'This device already has a passkey for this account — use "Sign in with a passkey" instead.',
  // Used only when the server answers `code: 'passkey_not_found'`: the credential
  // this device holds is no longer registered (usually removed elsewhere). It is a
  // deliberately different sentence from the rejected-assertion one, because the
  // action the user should take is different: register again, or use another method.
  'common.auth.error.passkeyNotFound': 'This passkey is no longer registered on the server — it may have been removed from another device. Register a new passkey, or use an email login link.',
  // Used when the server answers `code: 'passkey_verification_failed'`: the
  // credential is known but this assertion did not verify. Retrying is meaningful.
  'common.auth.error.passkeyRejected': 'The passkey could not be verified. Try once more; if it keeps failing, register a new one.',
  'common.auth.error.lastPasskey': 'This is the only passkey on the account. Removing it could lock you out — add a new passkey first, then remove this one.',
  // ── Web · self-service passkey management ─────────────────
  // The server had registration / login / recovery only; there was no way for a
  // user to see or remove their own credentials.
  'web.passkeys.title': 'Passkeys',
  'web.passkeys.lead': 'These are the passkeys registered for your account on the server. Removing one does not affect credentials on other devices.',
  'web.passkeys.add': 'Add a passkey',
  'web.passkeys.adding': 'Adding…',
  'web.passkeys.waitingForPrompt': 'Complete creating the passkey in the system prompt.',
  'web.passkeys.added': 'That passkey has been added.',
  'web.passkeys.refresh': 'Refresh list',
  'web.passkeys.loading': 'Loading…',
  'web.passkeys.needsSignIn': 'Sign in first to manage the passkeys on this account.',
  'web.passkeys.empty': 'This account has no passkeys yet.',
  'web.passkeys.createdAt': 'Created {date}',
  'web.passkeys.lastUsedAt': 'Last used {date}',
  'web.passkeys.neverUsed': 'Never used',
  'web.passkeys.delete': 'Remove',
  'web.passkeys.confirmDelete': 'Confirm removal',
  'web.passkeys.cancel': 'Cancel',
  'web.passkeys.deleting': 'Removing…',
  'web.passkeys.deleted': 'That passkey has been removed.',
  'web.passkeys.rename': 'Rename',
  'web.passkeys.renamePlaceholder': 'Give this passkey a name',
  'web.passkeys.save': 'Save',
  'web.passkeys.renamed': 'Name saved.',
  'web.passkeys.error.rename': 'Could not rename this passkey. Try again.',
  'web.passkeys.error.nameTooLong': 'That name is too long (up to {max} characters).',
  'web.passkeys.error.load': 'Could not load your passkeys.',
  'web.passkeys.error.passkeyNotFound': 'That passkey is no longer on the server — the list has been refreshed.',
  'web.passkeys.error.lastPasskey': 'This is the only passkey on the account, so it cannot be removed. Add a new passkey first.',
  'web.passkeys.error.unauthorized': 'Your sign-in has expired — sign in again.',
  'web.passkeys.error.network': 'Could not reach the server. Try again later.',

  // ── In-app widget journey (adding cards to the home screen) ─────────
  'mobile.widgetJourney.sectionTitle': 'Home screen widgets',
  'mobile.widgetJourney.card.today': 'Today\'s tasks',
  'mobile.widgetJourney.card.quadrant': 'Quadrants',
  'mobile.widgetJourney.card.habits': 'Today\'s habits',
  'mobile.widgetJourney.card.focus': 'Today\'s focus',
  'mobile.widgetJourney.intro': 'Today\'s tasks, quadrants, habits and focus — four cards you can keep on your home screen.',
  'mobile.widgetJourney.howTo': 'How to add',
  'mobile.widgetJourney.openOnce': 'If the card says “Open Heyta to show your widget” after adding it, opening Heyta once fills it in.',
  'mobile.widgetJourney.cannotAutoAdd': 'The system does not let an app place a widget for you, so you add it once by hand.',
  'mobile.widgetJourney.ios.step1': 'Touch and hold an empty spot on the home screen until the icons jiggle',
  'mobile.widgetJourney.ios.step2': 'Tap the “+” in the top-left corner',
  'mobile.widgetJourney.ios.step3': 'Search for “Heyta” and pick a size',
  'mobile.widgetJourney.ios.step4': 'Tap “Add Widget”',
  'mobile.widgetJourney.android.step1': 'Touch and hold an empty spot on the home screen',
  'mobile.widgetJourney.android.step2': 'Tap “Widgets”',
  'mobile.widgetJourney.android.step3': 'Find Heyta, then touch and hold it and drag it onto the home screen',
  'mobile.widgetJourney.other.step1': 'Touch and hold the home screen and find Heyta in the widget list',
  'mobile.widgetJourney.other.step2': 'Drag it onto the home screen',
  'mobile.widgetJourney.privacyTitle': 'Hide task titles on the lock screen',
  'mobile.widgetJourney.privacyHint': 'When on, lock screen and lock-screen widgets show only the number of tasks, not their titles.',
  'mobile.widgetJourney.privacyFailed': 'Could not save this setting. Try again.',

  // The one-line description shown by the PWA install panel (manifest `description`).
  'web.pwa.description': 'A local-first, end-to-end-encrypted app for tasks and habits',

  // ── Copy inside the widget cards (same source for iOS / Android / Windows) ──
  'widget.placeholder.openApp': 'Open Heyta to show the widget',
  'widget.today.title': 'Today\'s tasks',
  'widget.today.count': '{count} to do',
  'widget.today.empty': 'No tasks today',
  'widget.quadrant.title': 'Quadrants',
  'widget.quadrant.slotHeading': '{label} ({count})',
  'widget.quadrant.hint1': 'Do it now',
  'widget.quadrant.hint2': 'Schedule it',
  'widget.quadrant.hint3': 'Delegate it or handle it fast',
  'widget.quadrant.hint4': 'Cut it or delete it',
  'widget.habits.title': 'Habits',
  'widget.habits.empty': 'No habits yet',
  'widget.habits.doneToday': 'Done today',
  'widget.focus.title': 'Focus',
  'widget.focus.stale': 'Data is out of date — open Heyta to refresh',
  'widget.focus.idle': 'No focus session running',
  'widget.focus.target': 'Goal: {duration}',
  'widget.focus.minutes': '{minutes} min',
  'widget.card.desc.today': 'What is on the table today. Tap to finish an item.',
  'widget.card.desc.quadrant': 'Tasks grouped by importance and urgency',
  'widget.card.desc.habits': 'Today\'s habits and their streaks',
  'widget.card.desc.focus': 'The focus session in progress',

  // ── Windows widget background refresh (Web Push) ───────────────────
  'web.widgetPush.title': 'Widget background refresh',

  // ── Web/Windows widget journey (install the app first, then cards appear) ──
  'web.widgetJourney.sectionTitle': 'Desktop widgets',
  'web.widgetJourney.intro': 'heyta can become an app on your desktop. Four cards — today, quadrants, habits and focus — then show up in your system widget board.',
  'web.widgetJourney.status.standalone': 'Running as an app',
  'web.widgetJourney.status.browser': 'Running in a browser tab',
  'web.widgetJourney.howToInstall': 'How to install it as an app',
  'web.widgetJourney.windows.step1': 'Click the "…" or app icon on the right of the address bar',
  'web.widgetJourney.windows.step2': 'Choose "Apps" → "Install this site as an app"',
  'web.widgetJourney.windows.step3': 'Once installed, the four cards appear in the Windows widget board (press Win+W)',
  'web.widgetJourney.macos.step1': 'Click the "Install heyta" icon on the right of the address bar',
  'web.widgetJourney.macos.step2': 'Then open it from your Applications folder',
  'web.widgetJourney.other.step1': 'Look for "Install app" or "Add to Home screen" in your browser menu',
  'web.widgetJourney.other.step2': 'Then open it from your app list',
  'web.widgetJourney.note.widgetSource': 'Cards only come from an installed app — a website you have not installed will not appear in the widget board.',
  'web.widgetPush.description': 'When on, the heyta widget pinned on Windows updates by itself when your tasks change on another device. When off, it only refreshes after you open Heyta.',
  'web.widgetPush.rowLabel': 'Allow background widget refresh',
  'web.widgetPush.status.subscribed': 'On',
  'web.widgetPush.status.off': 'Off',
  'web.widgetPush.status.working': 'Working…',
  'web.widgetPush.status.denied': 'Your browser denied notification permission. Allow notifications for this site in your browser settings, then try again.',
  'web.widgetPush.status.disabled': 'This server has no Web Push configured, so the widget only refreshes when you open Heyta.',
  'web.widgetPush.status.failed': 'Could not turn on: {reason}',
  'web.widgetPush.status.failedOff': 'Could not turn off: {reason}',
  'web.widgetPush.reason.insecureContext': 'This page is not on a secure connection. Open it over https or from localhost.',
  'web.widgetPush.reason.noServiceWorker': 'This browser does not support background push.',
  'web.widgetPush.reason.noNotificationApi': 'This browser has no notification support.',
  'web.widgetPush.reason.permissionDenied': 'Your browser denied notification permission.',
  'web.widgetPush.reason.serverNotConfigured': 'This server does not have push notifications enabled.',
  'web.widgetPush.reason.needsLogin': 'You need to sign in first.',
  'web.widgetPush.reason.pushKeyHttp': 'The server did not return the push credentials (server replied {status}).',
  'web.widgetPush.reason.pushKeyMalformed': 'The push credentials from the server are not in a valid format.',
  'web.widgetPush.reason.pushKeyLength': 'The push credentials from the server have the wrong length (expected 65 bytes, got {length}).',
  'web.widgetPush.reason.noSubscription': 'The browser did not finish the subscription.',
  'web.widgetPush.reason.incompleteSubscription': 'The subscription returned by the browser is incomplete.',
  'web.widgetPush.reason.registerHttp': 'The server did not accept this subscription (server replied {status}).',
  'web.widgetPush.reason.unregisterHttp': 'The server did not remove this subscription (server replied {status}).',
  'web.widgetPush.reason.probeHttp': 'Could not tell whether this server has push enabled (server replied {status}).',
  'web.widgetPush.reason.unexpected': 'Something unexpected happened: {detail}',
  'web.widgetPush.note.privacy': 'The push payload only says "something changed" and contains none of your tasks — the server has no key, so decryption only happens on this device.',
  'web.widgetPush.note.windowsOnly': 'This switch only affects the Windows widget. Phone widgets refresh on the system schedule.',
  'web.passkeys.error.add': 'That passkey could not be added - try again.',
  'web.passkeys.error.passkeyUnsupported': 'This device or browser does not support passkeys.',
  'web.passkeys.error.passkeyCancelled': 'Creating the passkey was cancelled or timed out — you can try again.',
  'web.passkeys.error.passkeyAlreadyRegistered': 'This device already has a passkey for this account.',
  'web.passkeys.error.other': 'That did not work - try again.',
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
  // M3 second cut: the shared `@heyta/ui` panel now owns the pause -> resume
  // mapping, so web needs its own "Resume" entry (it previously had only
  // "Start", which called `start()` and discarded elapsed progress).
  'web.focus.a11y.resume': 'Resume focus session',
  'web.focus.resume': 'Resume',
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
  // Duration settings. Editable only while idle (changing mid-session would make
  // the current round's planned length ambiguous), so there is a dedicated line
  // explaining the disabled state — disabling without saying why is the worst option.
  'web.focus.config.title': 'Durations',
  'web.focus.config.work': 'Focus',
  'web.focus.config.shortBreak': 'Short break',
  'web.focus.config.longBreak': 'Long break',
  'web.focus.config.longBreakEvery': 'Long break every',
  'web.focus.config.minutes': '{minutes} minutes',
  'web.focus.config.sessions': '{count} sessions',
  'web.focus.config.locked': 'Durations cannot change while the timer runs — stop this round, edit, then start again.',
  'web.focus.config.a11y.minutes': '{label} duration in minutes',
  'web.focus.config.a11y.sessions': '{label} in sessions',

  // ── Web · habits ──────────────────────────────────────────
  'web.habits.addPlaceholder': 'New habit, for example "Drink water"',
  'web.habits.goal.aria': 'Edit the goal for "{name}"',
  'web.habits.goal.summaryAtLeast': 'At least {target}{unit}',
  'web.habits.goal.summaryAtMost': 'At most {target}{unit}',
  'web.habits.goal.summaryExactly': 'Exactly {target}{unit}',
  'web.habits.goal.target': 'Amount',
  'web.habits.goal.unit': 'Unit',
  'web.habits.goal.unitPlaceholder': 'cups / pages / minutes',
  'web.habits.goal.atLeast': 'At least',
  'web.habits.goal.atMost': 'At most',
  'web.habits.goal.exactly': 'Exactly',
  'web.habits.goal.defaultUnit': 'times',
  'web.habits.goal.invalid': 'The goal must be a number of at least 0 (0 is valid - it means never).',
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
  'web.habits.freeze': 'Days saved by a freeze in this streak: {count}',
  'web.habits.repair': 'You missed {date}. Repairing it makes this a {count}-day streak.',
  'web.habits.repairAction': 'Repair',
  'web.habits.a11y.repair': 'Repair "{name}" for {date}',
  'web.habits.freshStart': 'A {days}-day gap since your last check-in. Your record stays — a {longest}-day best and {total} logged — so starting again erases nothing.',
  'web.habits.freshStartAction': 'Start again today',
  'web.habits.a11y.freshStart': 'Check in "{name}" again today',
  // The third metric: the one that only ever grows (never reset by a break).
  'web.habits.streak.total': '{count} check-ins',
  'web.habits.streak.totalOne': '{count} check-in',
  // Heatmap copy is passed *by us* to react-activity-calendar; its defaults are English-only.
  // `{{count}}` is the library's own placeholder and must survive verbatim.
  // ── M3 knife 7 (habits): copy for the self-drawn heatmap ──
  // The key above is the *library's* shape (`{{count}}` is
  // react-activity-calendar's own placeholder), so the shared heatmap cannot
  // reuse it — it would render a literal `{5}`. These two use our shape.
  'web.habits.heatmap.a11y': '"{name}" check-in history: {count} logged in a {days}-day window',
  'web.habits.heatmap.cell': '{date}: {count}',

  // ── Web · habit icon vocabulary (list rows + picker) ──────
  // Stored values are the *closed-set keys* (`drop`, `moon`); the glyph is a web-side
  // Lucide mapping. None of these eight names a vice — unlike a colour, an icon
  // *labels* the slot, so this list is where the "never judge an activity healthy
  // or unhealthy" redline is actually held.
  'web.habits.icon.drop': 'Water',
  'web.habits.icon.activity': 'Exercise',
  'web.habits.icon.book': 'Reading',
  'web.habits.icon.moon': 'Sleep',
  'web.habits.icon.leaf': 'Meals',
  'web.habits.icon.pencil': 'Writing',
  'web.habits.icon.sun': 'Morning',
  'web.habits.icon.music': 'Music',
  'web.habits.icon.toggle': 'Icon',
  'web.habits.icon.group': 'Pick an icon',
  // "Default" does not mean "no icon": with nothing chosen the UI derives a stable one from the id.
  'web.habits.icon.default': 'Default',
  'web.habits.icon.a11y': 'Choose an icon for "{name}"',
  'web.habits.icon.a11yDefault': '"{name}" uses the derived icon',

  // ── Web · habits list + pane ──────────────────────────────
  'web.habits.list.aria': 'Habits list',
  'web.habits.pane.aria': 'Check-in history for "{name}"',
  'web.habits.week.aria': 'Last 7 days',
  'web.habits.week.done': '{date} checked in',
  'web.habits.week.missed': '{date} no check-in',
  // 🔴 **形状是承重的**：词条表没有 ICU 复数。这条必须保持"单数安全"的写法
  //    （连字符 `{n}-day` 复合词 + `in total`）—— 写成 `{longest} days` /
  //    `{total} check-ins` 的话，新建的习惯会被读成 "1 days, 1 check-ins"。
  'web.habits.row.aria': '"{name}": {current}-day streak, longest {longest}-day run, {total} in total',
  'web.habits.row.selectA11y': 'Show the check-in history for "{name}"',

  // ── Web · heatmap copy shared by habits and growth ────────
  'web.heatmap.month.1': 'Jan',
  'web.heatmap.month.2': 'Feb',
  'web.heatmap.month.3': 'Mar',
  'web.heatmap.month.4': 'Apr',
  'web.heatmap.month.5': 'May',
  'web.heatmap.month.6': 'Jun',
  'web.heatmap.month.7': 'Jul',
  'web.heatmap.month.8': 'Aug',
  'web.heatmap.month.9': 'Sep',
  'web.heatmap.month.10': 'Oct',
  'web.heatmap.month.11': 'Nov',
  'web.heatmap.month.12': 'Dec',
  'web.heatmap.less': 'Less',
  'web.heatmap.more': 'More',

  // ── Web · today progress (motivation L1) ──────────────────
  'web.progress.aria': 'Today progress',
  'web.progress.today': 'Today',
  // `done > total` is said as "beyond the plan" — that is how the negative number
  // is made structurally impossible instead of clamped away.
  'web.progress.hint.unplanned': '{count} done beyond the plan',
  'web.progress.hint.idle': 'Nothing planned for today',
  'web.progress.hint.allDone': 'Everything planned is done',
  'web.progress.hint.remaining': '{count} still to do',
  'web.progress.label.noPlan': '{count} done today, nothing was planned',
  'web.progress.label.bonus': '{done} done today: {total} planned plus {bonus} beyond the plan',
  'web.progress.label.plain': '{done} of {total} done today',
  // The number is its own span in JSX (`.tabular-nums`), so label and unit are split.
  'web.progress.focus': 'Focus',
  'web.progress.focusUnit': 'min',
  'web.progress.closed': 'Today is done',
  'web.progress.breakdown.habits': 'Habits',
  'web.progress.breakdown.tasks': 'Tasks',
  'web.progress.breakdown.bonus': 'Beyond plan',

  // ── Web · growth (motivation L3) ──────────────────────────
  'web.growth.week.title': 'This week',
  'web.growth.week.range': '{start} to {end}',
  'web.growth.week.empty': 'Nothing recorded this week yet. Start with one small thing today.',
  'web.growth.headline.checkIns': 'Most check-ins this week: {count}',
  'web.growth.headline.tasksCompleted': 'Most tasks completed this week: {count}',
  'web.growth.headline.focusMinutes': 'Most focus time this week: {count} minutes',
  'web.growth.week.bestDay': 'Most focused day was {date}, with {minutes} minutes.',
  'web.growth.stat.previous': 'Last week {count}',
  'web.growth.stat.checkIns': 'Check-ins',
  'web.growth.stat.checkIns.unit': 'times',
  'web.growth.stat.tasks': 'Tasks completed',
  'web.growth.stat.tasks.unit': 'done',
  'web.growth.stat.focus': 'Focus',
  'web.growth.stat.focus.unit': 'min',
  'web.growth.year.title': 'This year',
  'web.growth.year.note': 'One square is one day. Days with activity light up — check-ins, completed tasks and finished focus sessions all count.',
  'web.growth.year.heatmap': '{count} records in the past year',
  'web.growth.milestones.title': 'Milestones',
  'web.growth.milestones.note': 'They only grow. A break never makes these numbers smaller.',
  'web.growth.milestone.allReached': 'All {name} milestones reached',
  'web.growth.milestone.nextLabel': '{name}: next milestone is {threshold} {unit}, {gap} {unit} to go',
  'web.growth.milestone.next': 'Next milestone: {threshold} {unit} — {gap} {unit} to go',
  'web.growth.milestone.dimensionDone': 'Every milestone in this dimension is reached',
  'web.growth.kind.checkIns': 'Check-ins',
  'web.growth.kind.checkIns.unit': 'check-ins',
  'web.growth.kind.focusHours': 'Focus',
  'web.growth.kind.focusHours.unit': 'hours',
  'web.growth.kind.tasks': 'Tasks completed',
  'web.growth.kind.tasks.unit': 'tasks',
  'web.growth.kind.activeDays': 'Active days',
  'web.growth.kind.activeDays.unit': 'days',
  'web.growth.unit.streakDays': 'days in a row',
  'web.growth.tags.title': 'Your tags',
  'web.growth.tags.empty': 'No tags yet. Keep recording and they will grow here.',
  'web.growth.tags.near': '{name}: {gap} {unit} to go',
  'web.growth.tags.nearNote': 'These are the two closest. Reach them and they move up here.',
  'web.growth.tag.started': 'Getting started',
  'web.growth.tag.routine': 'Finding a rhythm',
  'web.growth.tag.steady': 'In it for the long run',
  'web.growth.tag.checkin-hundred': 'A hundred check-ins',
  'web.growth.tag.deep-fifty': '50 hours of deep work',
  'web.growth.tag.deep-two-hundred': '200 hours of deep work',
  'web.growth.tag.finisher-five-hundred': '500 tasks completed',
  'web.growth.tag.streak-thirty': '30-day streak',
  'web.growth.share.title': 'Take this week with you',
  'web.growth.share.note': 'Copy it as plain text and paste it anywhere. It carries no account, device or identifier.',
  'web.growth.share.copy': 'Copy the weekly summary',
  'web.growth.share.copied': 'Copied',
  'web.growth.share.failed': 'Copying is not allowed here — select the numbers above manually.',
  'web.growth.summary.title': 'Week summary ({start} to {end})',
  'web.growth.summary.line': '{checkIns} check-ins · {tasks} tasks completed · {minutes} focus minutes',
  'web.growth.summary.bestDay': 'Most focused day: {date} ({minutes} minutes)',
  'web.growth.summary.totals': 'All time: {checkIns} check-ins · {hours} focus hours · {tasks} tasks completed · {activeDays} active days',

  // ── Web · Category time (growth view) ─────────────────────
  // 🔴 Facts only: how long each category ran, and how that time was counted.
  //    No "most/least/imbalanced", no ranking, no share-of-total percentage.
  'web.categories.title': 'Time by category',
  'web.categories.note': 'Focus and check-in time per list and habit over the last 12 weeks. You decide what each color means; this page does not judge it.',
  'web.categories.empty': 'Nothing to sort into categories yet. Group tasks into lists, or track a habit in minutes, and rows will appear here.',
  'web.categories.range': '{start} to {end}',
  'web.categories.kind.project': 'List',
  'web.categories.kind.habit': 'Habit',
  'web.categories.slot.none': 'None',
  'web.categories.duration.minutes': '{minutes} min',
  'web.categories.duration.hours': '{hours} h',
  'web.categories.duration.hoursMinutes': '{hours} h {minutes} min',
  'web.categories.lane.aria': '{name} ({kind}), {duration} total',
  'web.categories.segment.aria': '{name}: {duration}',
  'web.categories.unassigned': 'Another {duration} is not attached to any list or habit — give those tasks a list and it will land there.',
  'web.categories.hint.unset': 'Set the color swatch beside a list or habit: tap the palette icon and pick any slot from 1 to 8.',
  'web.categories.cell.none': 'Nothing recorded this week',
  'web.categories.bars.aria': 'Stacked bars of total time per week over the last 12 weeks; each segment matches a category above.',
  'web.categories.picker.toggle': 'Set a category color for "{name}"',
  'web.categories.picker.group': 'Category color for "{name}"',
  'web.categories.picker.slot': 'Color slot {slot}',

  // ── Web · lists and tags ──────────────────────────────────
  'web.projects.ariaLabel': 'Lists and tags',
  'web.projects.heading': 'Lists',
  'web.projects.newPlaceholder': 'New list',
  'web.projects.newLabel': 'New list name',
  'web.projects.addNew': 'Create a list',
  'web.projects.add': 'Add list',
  'web.projects.delete': 'Delete list "{name}"',
  'web.tags.heading': 'Tags',
  'web.tags.newPlaceholder': 'New tag',
  'web.tags.newLabel': 'New tag name',
  'web.tags.addNew': 'Create a tag',
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

  // ── Web · repeat (B2-3) ───────────────────────────────────
  //    🔴 This family fixes an **inconsistency between the two ends**: mobile has
  //    been able to set repeats from the task sheet for a while, while web had no
  //    entry point at all. Preset semantics live in app-host `repeat-presets.ts`;
  //    only the words live here.
  'web.repeat.summary': 'Set the repeat rule for task "{title}"',
  'web.repeat.legend': 'Repeat',
  'web.repeat.none': 'Does not repeat',
  'web.repeat.daily': 'Daily',
  'web.repeat.weekly': 'Weekly',
  'web.repeat.weekdays': 'Weekdays',
  'web.repeat.monthly': 'Monthly',
  'web.repeat.optionAria': 'Set task "{title}" to "{label}"',
  'web.repeat.customChip': 'Custom: {rule}',
  'web.repeat.customLabel': 'Custom rule (RFC 5545 RRULE)',
  'web.repeat.customPlaceholder': 'e.g. FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
  'web.repeat.customAria': 'Enter a custom repeat rule for task "{title}"',
  'web.repeat.apply': 'Apply',
  'web.repeat.error.empty': 'Enter a rule first.',
  'web.repeat.error.invalid': 'That is not a valid RRULE (it needs FREQ=…).',

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
  'web.ai.noTarget.toolCalling': 'No endpoint is configured for "AI tool calling" yet. Add an endpoint in Settings, declare the "Tool calling" capability, and route the feature to it.',

  // ── Web · AI · feature / capability names ─────────────────
  'web.ai.feature.capture': 'One-sentence capture',
  'web.ai.feature.breakdown': 'Task breakdown',
  'web.ai.feature.prioritize': 'Priority suggestions',
  'web.ai.feature.duration': 'Time estimate',
  'web.ai.feature.toolCalling': 'AI tool calling',
  'web.ai.needs.capture': 'Quick capture',
  'web.ai.needs.breakdown': 'Task breakdown',
  'web.ai.needs.prioritize': 'Sorting suggestions',
  'web.ai.needs.duration': 'Time estimate',
  'web.ai.needs.toolCalling': 'Tool calling',
  'web.ai.capability.structuredOutput': 'Structured output',
  'web.ai.capability.longContext': 'Long context',
  'web.ai.capability.vision': 'Image understanding',
  'web.ai.capability.toolCalling': 'Tool calling',

  // ── Web · AI · tool calling panel ─────────────────────────
  'web.ai.tools.title': 'AI tool calling',
  'web.ai.tools.hint': 'Ask in one sentence and AI will call one tool. What the rules can handle never leaves this device.',
  'web.ai.tools.placeholder': 'e.g. list all tasks',
  'web.ai.tools.inputAria': 'Input for AI tool calling',
  'web.ai.tools.run': 'Run',
  // Accessible names for the tool-call panels. 🔴 These two had **no**
  // role/aria before — the four AI panels' failure/proposal screens all had
  // them; the 5th entry was the one that drifted (same shape as before).
  'web.ai.tools.failureAria': 'Tool call failed',
  'web.ai.tools.resultAria': 'Tool call result',
  'web.ai.tools.viaRule': 'Matched by a local rule — no network',
  'web.ai.tools.viaModel': 'Chosen by the model',
  'web.ai.tools.disclosureAria': 'AI tool calling — confirm before sending',
  'web.ai.tools.observationLead': 'Result',
  'web.ai.tools.proposalLead': 'About to run (needs your confirmation)',
  'web.ai.tools.confirm': 'Confirm',
  'web.ai.tools.confirmAria': 'Confirm running this tool',
  'web.ai.tools.confirmedOk': 'Done',
  'web.ai.tools.confirmedFail': 'Failed: {message}',
  'web.ai.tools.modelTextLead': 'The model said: ',
  'web.ai.tools.ambiguousLead': 'That could mean several things. Be more specific. Try:',
  'web.ai.tools.empty': 'Could not understand that. Try rephrasing, or do it manually.',
  'web.ai.tools.deniedLead': 'This tool is not authorized yet — enable it in settings first.',
  'web.ai.tools.failedLead': 'Could not finish: ',
  // The **main sentence** for a failed tool call (looked up by `reason`).
  // 🔴 Before this, the screen rendered the raw Chinese sentence built in
  // `packages/app-host` — so the English UI showed Chinese on failure.
  // `ai-unavailable` is absent on purpose: it goes through the shared
  // `web.ai.failure.cause.*` keys, which are more specific.
  'web.ai.tools.failure.emptyText': 'Write what you want the AI to do first.',
  'web.ai.tools.failure.textTooLong': 'That sentence is too long — shorten it and try again.',
  'web.ai.tools.failure.noGrantedTools': 'No tools are granted yet — pick the ones the AI may call in settings.',
  'web.ai.tools.failure.modelReturnedText': 'The model replied with words instead of calling a tool — try wording the request more explicitly.',
  'web.ai.tools.failure.multipleToolCalls': 'The model asked for several tools at once; this step does one thing, so split it into two.',
  'web.ai.tools.failure.toolCallMalformed': 'The model\'s arguments were not valid JSON — say it again, or phrase it more concretely.',
  'web.ai.tools.intentCreate': 'Create task "{title}"',
  'web.ai.tools.intentUpdate': 'Update task {id}',
  'web.ai.tools.intentComplete': 'Mark task {id} as done',

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
  // ✅ The embedded `formatRemainingUntil()` Chinese is gone: the remaining
  // days are now spoken by the shell in the current language (`web.due.*`).
  'web.capture.placeholder': 'Add a task, press Enter to confirm (you can write "tomorrow", "next Wednesday", "!1")',
  // The destination belongs in the placeholder: with a list open, "Add a task"
  // only says half of it — the task lands in Inbox and vanishes from the list.
  'web.capture.placeholderTo': 'Add a task to "{list}", press Enter to confirm (you can write "tomorrow", "next Wednesday", "!1")',
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

  // ── Web · how a due date is *said* (not how it is computed) ───
  //
  // The day arithmetic stays in `@heyta/domain` (`computeCountdown` /
  // `diffDays`, shared with mobile); only the wording lives here, because the
  // domain layer is a pure-function package that cannot depend on the message
  // catalog - its `formatRemaining()` returns a hard-coded Chinese sentence,
  // and rendering that directly is exactly the bug these keys fix.
  //
  // The day buckets are copied from `@heyta/domain`'s `formatRemaining`
  // (today / tomorrow / day after tomorrow / N days left / N days overdue)
  // because the buckets are product semantics, not phrasing. Wording may
  // legitimately differ per app; the buckets must not. `apps/web/tests/
  // due-display.spec.ts` checks every day against the domain layer.
  'web.due.today': 'Today',
  'web.due.tomorrow': 'Tomorrow',
  'web.due.dayAfterTomorrow': 'Day after tomorrow',
  'web.due.remaining': '{days} days left',
  'web.due.overdue': '{days} days overdue',
  // ⚠️ `remaining` never needs a singular sibling: days === 1 and 2 are already
  // taken by `tomorrow` / `dayAfterTomorrow`, so "{days} days left" is only
  // ever reached with days >= 3.
  'web.due.overdueOne': '{days} day overdue',

  // ── Web · Export (design principle #5, "freedom to export") ──
  //
  // 🔴 These entries make good on two promises already made to users: README's
  //    "take all your data with you at any moment", and the subscription notice's
  //    "local data can still be viewed, edited and exported". Until now the repo
  //    had no user-visible export entry at all — those sentences were untrue.
  'web.export.title': 'Export data',
  'web.export.intro': 'Take everything on this device with you in one go. The export runs locally and never touches a server.',
  'web.export.json.label': 'JSON (full fidelity)',
  'web.export.json.note': 'Every entity, the complete operation log, and deleted records included. Machine-readable, good for backup or migration.',
  'web.export.json.button': 'Download JSON',
  'web.export.markdown.label': 'Task list (Markdown)',
  'web.export.markdown.note': 'A task list a person can open and read. It leaves out deleted records and the operation log.',
  'web.export.markdown.button': 'Download task list',
  // 🔴 Honesty clause. The JSON path now has an import; so this no longer says
  //    "you cannot import it back" — it states this round's actual boundary:
  //    empty databases only. The Markdown list genuinely cannot be imported
  //    (it carries no operation log).
  'web.export.notRestorePoint': 'The JSON export can be imported back (empty databases only for now); the task list is for reading, not for restoring.',
  'web.export.counts': 'This export holds {entities} records ({deleted} of them deleted) and {ops} operation-log entries.',
  'web.export.failed': 'Export failed. Please try again.',
  // Structure text inside the Markdown file. The layout lives in
  // `packages/app-host`; the wording lives here — same discipline as the AI
  // failure states (return a reason, the shell picks the entry).
  'web.export.markdown.heading': '# heyta task list',
  'web.export.markdown.generatedAt': 'Exported at: {at}',
  'web.export.markdown.empty': '(no tasks)',
  'web.export.markdown.open': 'Open',
  'web.export.markdown.done': 'Completed',
  'web.export.markdown.colTitle': 'Title',
  'web.export.markdown.colStatus': 'Status',
  'web.export.markdown.colDue': 'Due',
  'web.export.markdown.colPriority': 'Priority',
  'web.export.markdown.colProject': 'List',
  'web.export.markdown.colTags': 'Tags',
  'web.export.markdown.none': '—',
  'web.export.markdown.footer': 'This is an export file — you cannot import it back yet. Do not treat it as a restore point.',

  // ── Web · Import / restore (the other half of "freedom to export") ──
  //
  // 🔴 This round supports **restoring into an empty database only**; merging
  //    into a database that already has data is NOT done — see the header of
  //    `packages/app-host/src/import-dump.ts`. The UI must say so plainly:
  //    a generic "Import" button would make users think it can merge two
  //    datasets, and merging silently loses data on id conflicts and clocks.
  'web.import.title': 'Import / restore',
  'web.import.intro': 'Restore data from a JSON file exported by heyta. Restoring happens locally and never touches a server.',
  'web.import.emptyOnly': 'Restoring works into an empty database only: if this device already has data, it is refused outright and nothing is erased or overwritten.',
  'web.import.fileLabel': 'Choose an exported JSON file',
  'web.import.button': 'Read and restore',
  'web.import.busy': 'Restoring…',
  'web.import.success': 'Restored {entities} records ({deleted} of them deleted) and {ops} operation-log entries.',
  'web.import.skipped': '{skipped} operation-log entries already existed on this device and were skipped.',
  'web.import.localOnly': 'Restoring affects this device only: imported operations carry the original device\u2019s identity, so the server will not receive them from here.',
  'web.import.failed': 'The restore did not finish. Please try again.',
  // Rejection reasons. Structured `reason` → catalogue entry, same discipline as
  // the AI failure states (packages return a reason; the shell picks the entry).
  'web.import.reason.invalidJson': 'This file is not valid JSON.',
  'web.import.reason.invalidDocument': 'This file is not a complete heyta export.',
  'web.import.reason.wrongApplication': 'This file was not exported by heyta.',
  'web.import.reason.unsupportedFormatVersion': 'This export format version is not recognised — the file may come from a newer version.',
  'web.import.reason.unsupportedSchemaVersion': 'This export uses a different operation version than this device; cross-version restore is not supported yet.',
  'web.import.reason.inconsistentDocument': 'The file contradicts itself: replaying its operation log does not reproduce the data it claims. Nothing was written.',
  'web.import.reason.targetNotEmpty': 'This device already has data — restoring works into an empty database only, and not one byte of the existing data was touched.',
  'web.import.reason.verificationFailed': 'The result after writing does not match the export. Please check this device\u2019s data.',

  // ── Import from TickTick (B2-1) ───────────────────────────
  //    🔴 NOT the same thing as "Import / restore" above: that one restores
  //    heyta's own export into an empty store; this one migrates from another
  //    product through ordinary ops and can coexist with existing data.
  'web.ticktick.title': 'Import from TickTick',
  'web.ticktick.intro': 'Pick a CSV backup exported by TickTick. **You see a preview first; nothing is written until you confirm** — the numbers in the preview and what actually gets written come from the same parse.',
  'web.ticktick.fileLabel': 'TickTick CSV backup',
  'web.ticktick.picked': 'Selected: {name}',
  'web.ticktick.ticktickOnly': 'Only CSV files exported by TickTick are recognised. Todoist parsing does not exist yet, so this page does not claim to support it.',
  'web.ticktick.coexist': 'Importing uses ordinary operations and can coexist with existing data; importing the same file twice creates no duplicates (judged by stable ids).',
  'web.ticktick.busy': 'Working…',
  'web.ticktick.readFailed': 'Could not read the file. Please try again.',
  'web.ticktick.importFailed': 'Something failed during the import — some records may already be written; importing the same file again will not duplicate them.',
  'web.ticktick.previewTitle': 'Preview',
  'web.ticktick.previewNoop': 'Everything in this file is **already on this device**; nothing will be written.',
  'web.ticktick.previewCounts': 'Will create {projects} lists, {tags} tags and {tasks} tasks ({ops} operations).',
  'web.ticktick.previewRows': 'The file has {rows} data rows: {checklist} checklist items, {recurring} repeating tasks, {completed} completed tasks.',
  'web.ticktick.skippedTitle': 'These rows were not imported:',
  'web.ticktick.unmappedTitle': 'heyta cannot bring these in yet (original values stay in the import report rather than being silently dropped):',
  'web.ticktick.confirm': 'Confirm import',
  'web.ticktick.doneNoop': 'Import finished: nothing was written — this file has already been imported.',
  'web.ticktick.done': 'Import finished: {projects} lists, {tags} tags and {tasks} tasks added ({ops} operations written).',
  'web.ticktick.failure.noHeader': 'No header row found — this does not look like a CSV exported by TickTick.',
  'web.ticktick.failure.noTasks': 'The header row was found, but there are no importable tasks in it.',
  'web.ticktick.skip.emptyTitle': 'Empty title ({count} rows)',
  'web.ticktick.skip.duplicateSourceId': 'Duplicate taskId within the same file ({count} rows)',
  'web.ticktick.unmapped.reminder': 'Reminders ({count})',
  'web.ticktick.unmapped.startDate': 'Start times ({count})',
  'web.ticktick.unmapped.parentId': 'Parent/child links ({count})',
  'web.ticktick.unmapped.isFloating': 'Floating times ({count})',
  'web.ticktick.unmapped.columnName': 'Board column names ({count})',
  'web.ticktick.unmapped.columnOrder': 'Board column order ({count})',
  'web.ticktick.unmapped.viewMode': 'View modes ({count})',
  'web.ticktick.unmapped.timezone': 'Timezones ({count})',
  'web.ticktick.unmapped.archiveStatus': 'Archive status ({count})',
  'web.ticktick.unmapped.priority': 'Priority values ({count})',
  'web.ticktick.unmapped.status': 'Status values ({count})',
  'web.ticktick.unmapped.kind': 'Item kinds ({count})',
  'web.ticktick.unmapped.repeat': 'Repeat rules ({count})',
  'web.ticktick.unmapped.missingSourceId': 'Missing taskId ({count} rows)',

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
  // Neutral date wording shared by all four ends (see packages/ui/src/calendar/date-text.ts).
  'common.weekday.mon': 'Mon',
  'common.weekday.tue': 'Tue',
  'common.weekday.wed': 'Wed',
  'common.weekday.thu': 'Thu',
  'common.weekday.fri': 'Fri',
  'common.weekday.sat': 'Sat',
  'common.weekday.sun': 'Sun',
  'common.date.monthTitle': '{month}/{year}',
  'common.date.dayTitle': '{weekday}, {month}/{day}',
  // Global search (tasks + notes + quick jumps). Since 2026-10-01 this is the
  // ONLY search entry - the header's in-list filter box was removed.
  // Shape and boundaries: packages/ui/src/search/SearchPanel.tsx.
  // Reminder notifications (#2)
  'web.reminder.notify.title': 'Reminder notifications',
  'web.reminder.notify.intro': 'When on, a reminder shows a system notification when it comes due.',
  'web.reminder.notify.request': 'Turn on notifications',
  'web.reminder.notify.granted': 'On - you will be notified when a reminder comes due.',
  'web.reminder.notify.denied': 'Notifications are blocked by the browser. To re-enable, change it in the site settings.',
  'web.reminder.notify.limit': 'Notifications only fire while heyta is open. They do not fire when the app is closed - background wake-up needs a separate protocol we do not have yet.',
  'web.reminder.notify.body': 'Due: {title}',
  'web.search.title': 'Search',
  'web.search.placeholder': 'Search task titles, notes and note bodies',
  'web.search.tasksSection': 'Tasks',
  'web.search.notesSection': 'Notes',
  'web.search.quickSection': 'Go to',
  'web.search.hint.view': 'View',
  'web.search.hint.project': 'List',
  'web.search.hint.tag': 'Tag',
  'web.search.prompt': 'Type a keyword. Multiple words must all match.',
  'web.search.noResults': 'No matching tasks, notes, or places to go.',
  'web.search.count': '{count}',
  'web.search.keys.navigate': '↑↓ Select',
  'web.search.keys.open': '↵ Open',
  'web.search.keys.close': 'esc Close',
  'web.calendar.title': 'Calendar',
  'web.calendar.prevMonth': 'Previous month',
  'web.calendar.nextMonth': 'Next month',
  'web.calendar.weekShort': 'W{n}',
  'web.calendar.backToToday': 'Back to today',
  'web.calendar.monthTitle': '{month}/{year}',
  'web.calendar.dayTitle': '{weekday}, {month}/{day}',
  'web.calendar.dayEmpty': 'Nothing is due on this day.',
  'web.calendar.footnote': 'Tasks without a due date are not on the calendar; they live in the Inbox on the Tasks tab.',
  'web.calendar.a11y.dayWithTasks': '{date}, {count} tasks',
  'web.calendar.a11y.dayWithTasksOne': '{date}, {count} task',
  'web.calendar.a11y.dayNoTasks': '{date}, no tasks',
  'web.calendar.side.aria': 'Calendar sidebar',
  'web.calendar.mini.aria': 'Mini month grid',
  'web.calendar.scope.all': 'All',
  'web.calendar.scope.allAria': 'Show all tasks',
  'web.calendar.scope.groupProject': 'Select or clear all lists',
  'web.calendar.scope.groupTag': 'Select or clear all tags',
  'web.calendar.scope.project': 'Show tasks from list "{name}" on the calendar',
  'web.calendar.scope.tag': 'Show tasks from tag "{name}" on the calendar',

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
  'mobile.tab.categories': 'Categories',

  // ── Mobile · time by category ──────────────────────────────
  // Verbatim the same as `web.categories.*` (except where the interaction differs).
  'mobile.categories.title': 'Time by category',
  'mobile.categories.note': 'Focus and check-in time per list and habit over the last 12 weeks. You decide what each color means; this page does not judge it.',
  'mobile.categories.empty': 'Nothing to sort into categories yet. Group tasks into lists, or track a habit in minutes, and rows will appear here.',
  'mobile.categories.range': '{start} to {end}',
  'mobile.categories.kind.project': 'List',
  'mobile.categories.kind.habit': 'Habit',
  'mobile.categories.slot.none': 'None',
  'mobile.categories.duration.minutes': '{minutes} min',
  'mobile.categories.duration.hours': '{hours} h',
  'mobile.categories.duration.hoursMinutes': '{hours} h {minutes} min',
  'mobile.categories.lane.a11y': '{name} ({kind}), {duration} total',
  'mobile.categories.unassigned': 'Another {duration} is not attached to any list or habit — give those tasks a list and it will land there.',
  'mobile.categories.hint.unset': 'Tap the swatch at the start of a row to pick a color (any slot from 1 to 8). The color is just a label, so you can recognise it.',
  'mobile.categories.cell.none': 'Nothing recorded this week',
  'mobile.categories.picker.toggle': 'Set a category color for "{name}"',
  'mobile.categories.picker.group': 'Category color for "{name}"',
  'mobile.categories.picker.slot': 'Color slot {slot}',


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

  // ── Mobile · global search (the second host of the shared `SearchPanel`) ──
  //    The panel's own copy still comes from `web.search.*` — same surface,
  //    so there is no second translation of it.
  //    🔴 Only three keys are mobile-only: the entry/exit a11y names, and
  //    `noResults`. The web sentence promises "tasks, notes, **or places to
  //    go**", and mobile has no quick-jump group — reusing it would advertise
  //    a result row that cannot exist here.
  'mobile.search.open': 'Open search',
  'mobile.search.close': 'Close search',
  'mobile.search.noResults': 'No matching tasks or notes.',

  // ── Mobile · one-line capture (the tail of the `capture` cut) ──
  //    🔴 These keys fix an **inconsistency between the two ends**: the web
  //    composer understands "tomorrow" / "!1" and shows recognition chips,
  //    while mobile had only a plain title field — the same sentence produced
  //    different tasks on the two ends. Both now share one `CaptureComposer`
  //    from `@heyta/ui`; only the wording differs.
  'mobile.capture.placeholder': 'Add a task (try "tomorrow", "next Wed", "!1")',
  'mobile.capture.addLabel': 'New task title',
  'mobile.capture.add': 'Add',
  'mobile.capture.matchesAria': 'Recognised fields',
  'mobile.capture.rejected': 'Ignored (kept as title text)',
  'mobile.capture.restoreAria': 'Restore recognition: {raw}',
  'mobile.capture.ignoreAria': 'Ignore recognition: {raw}',
  'mobile.capture.unused': 'Not used, still in the title',
  'mobile.capture.previewLead': 'Actual title:',
  'mobile.capture.previewEmpty': '(empty)',
  'mobile.capture.valueWithRemaining': 'Due {date} ({remaining})',
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
  'mobile.tasks.tagFilter.all': 'All',
  'mobile.tasks.mode.countdown': 'Countdown',
  'mobile.tasks.view.list': 'List',
  'mobile.tasks.view.quadrant': 'Quadrants',
  // The timeline view (step 3 of the `timeline` cut). **Only this one key**:
  // the timeline's own copy (`web.gantt.*` / `web.timeline.*`, 20-odd keys) is
  // **reused** from web — same precedent as `lib/quadrant-display.ts` reusing
  // `web.quadrant.*`.
  'mobile.tasks.view.timeline': 'Timeline',
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
  // Accessibility name for the progress ring. Mobile used a horizontal bar
  // before (so it had no such entry); the shared ring needs it on both ends.
  'mobile.focus.a11y.progress': 'Progress {percent}%',
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
  // 🔴 Before this there was no note input on mobile either: `Task.note` and
  // `setNote` both existed, but the only callers were AI features — a user
  // could not write one themselves.
  'mobile.detail.field.note': 'Note',
  'mobile.detail.note.placeholder': 'Write something (Markdown supported)',
  'mobile.detail.note.hint': 'Saves when you leave the field or close the panel',
  'mobile.detail.field.dueDate': 'Due date',
  'mobile.detail.field.repeat': 'Repeat',
  'mobile.detail.repeat.none': 'Does not repeat',
  'mobile.detail.repeat.current': 'Current: {rule}',
  'mobile.detail.repeat.daily': 'Daily',
  'mobile.detail.repeat.weekly': 'Weekly',
  'mobile.detail.repeat.weekdays': 'Weekdays',
  'mobile.detail.repeat.monthly': 'Monthly',
  // Custom RRULE (the mobile tail of B2-3). Before this, the phone could only
  // pick presets: "every two weeks" meant going to the web app. The error copy
  // is stored as **keys** (see `customError` in `TaskDetailSheet`), so these are
  // three separate entries rather than pre-assembled sentences.
  'mobile.detail.repeat.customLabel': 'Custom rule',
  'mobile.detail.repeat.customPlaceholder': 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
  'mobile.detail.repeat.customHint': 'iCalendar RRULE syntax; use the presets above if unsure.',
  'mobile.detail.repeat.customApply': 'Apply rule',
  'mobile.detail.repeat.error.empty': 'The rule cannot be empty.',
  'mobile.detail.repeat.error.invalid': 'Not a valid recurrence rule (needs FREQ=DAILY / WEEKLY / MONTHLY …).',
  'mobile.detail.field.priority': 'Priority',
  'mobile.detail.field.important': 'Important',
  'mobile.detail.important.hint': 'Urgency is derived from the due date — you do not set it.',
  'mobile.detail.field.project': 'List',
  'mobile.detail.field.parent': 'Parent task',
  'mobile.detail.parent.topLevel': '(Top level)',
  'mobile.detail.project.inbox': 'Inbox',
  'mobile.detail.project.create': 'New list',
  'mobile.detail.project.newPlaceholder': 'List name',
  // 与 zh 同一批：空态是 web 侧栏与移动端共用的一句话，前缀必须是 `common.`。
  'common.organizer.lists.empty': 'No lists yet',
  'common.organizer.lists.empty.hint': 'Tasks that are not filed anywhere live in the Inbox — nothing is lost.',
  'mobile.lists.nameLabel': 'List name',
  'mobile.lists.newPlaceholder': 'Name your new list',
  'mobile.lists.add': 'New list',
  'mobile.lists.removeHint': 'Deleting a list does not delete its tasks — they go back to the Inbox.',
  'mobile.lists.remove': 'Delete list "{name}"',
  'mobile.profile.section.tags': 'Tags',
  'common.organizer.tags.empty': 'No tags yet',
  'common.organizer.tags.empty.hint': 'Tags group tasks across lists — for example "Urgent" or "Waiting".',
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

  // ── Mobile · welcome screen (spec §3.1) ───────────────────
  // "Up front" means visible on the first screen and one tap away - not locking
  // local features behind a sign-in. So the primary button and the way out
  // (use offline) must both exist.
  'mobile.welcome.tagline': 'Local-first task management: offline still works, data is end-to-end encrypted, and the server can be your own.',
  'mobile.welcome.signIn': 'Sign in or register',
  'mobile.welcome.offline': 'Use offline for now',
  'mobile.welcome.offlineHint': 'You can create tasks, check in and focus without signing in; you can sign in later from the Profile tab.',

  // ── Mobile · sign-in panel (spec §3.2) ────────────────────
  'mobile.auth.title': 'Sign in or register',
  'mobile.auth.intro': 'Sign in with an email link or a passkey. Once you are in, the server address, access token and end-to-end passphrase are wired into sync for you.',
  'mobile.auth.email.label': 'Email',
  'mobile.auth.email.placeholder': 'Your email address',
  'mobile.auth.terms.label': 'I accept the terms of service and privacy policy offered by this server',
  'mobile.auth.terms.hint': 'You have to check this yourself - we will not accept on your behalf.',
  'mobile.auth.magicLink.login': 'Sign in with an email link',
  'mobile.auth.magicLink.register': 'Register a new account',
  'mobile.auth.passkey.register': 'Register with a passkey',
  'mobile.auth.passkey.login': 'Sign in with a passkey',
  'mobile.auth.passkey.unavailable': 'This device does not support passkeys yet (React Native has no WebAuthn implementation here); use the email link instead.',
  'mobile.auth.passkey.waiting': 'Complete the passkey prompt in the system dialog...',
  'mobile.auth.paste.label': 'Paste the link or token from the email',
  'mobile.auth.paste.placeholder': 'The full link from the email, or the token itself',
  'mobile.auth.verify': 'Verify and sign in',
  // Neutral wording (spec §2-A2): registration may "succeed" without creating
  // anything, so these must never assert that an account was created.
  'mobile.auth.sent.login': 'If an account exists for this email, a login link has been sent. Open the link in your email, or paste it into the field above.',
  'mobile.auth.sent.register': 'If this email is available, we will send a verification email. Open the verification link, then come back here to sign in.',
  'mobile.auth.emailVerified': 'Your email is verified, but this step does not issue a token. Tap "Sign in with an email link" again and paste the new link into the field above.',
  'mobile.auth.signedIn.title': 'Signed in',
  'mobile.auth.signedIn.body': 'Current account: {email}',
  'mobile.auth.passwordNeeded': 'One thing left: the end-to-end encryption passphrase. It stays in this device\'s memory and the server never sees the plaintext; without it sync fails explicitly at the encryption step rather than falling back to plaintext.',
  'mobile.auth.enableSync': 'Save and enable sync',
  'mobile.auth.saveFailed': 'The passphrase could not be written into this device\'s live sync config. Please try again.',
  'mobile.auth.back': 'Back',
  'common.auth.error.termsRequired': 'Check the agreement before registering - that acceptance has to come from you, not from us.',

  // ── Mobile · profile screen ───────────────────────────────
  'mobile.profile.title': 'Profile',
  // 🔴 Settings is a standalone second-layer surface (RN Modal), not a section of
  //    the Profile scroll — see INTERFACE-NOTES §11.5 (secondary surfaces get their
  //    own face). The entry row lives on Profile; the content lives in the sheet.
  'mobile.settings.title': 'Settings',
  'mobile.settings.close': 'Close',
  'mobile.profile.entry.settings': 'Settings',
  'mobile.profile.entry.settings.hint': 'Sync credentials, widgets and language',
  'mobile.profile.section.sync': 'Sync',
  'mobile.profile.section.status': 'Status',
  'mobile.profile.section.language': 'Language',
  'mobile.profile.section.lists': 'Lists',
  // The auth entry sits in the top card of this screen so it is one tap away;
  // the bottom bar stays at five tabs (spec §2-A8).
  'mobile.profile.section.account': 'Account',
  'mobile.profile.account.signIn': 'Sign in or register',
  'mobile.profile.account.signInHint': 'Sign in with an email link or a passkey; sync is wired up for you so you never copy a token by hand.',
  'mobile.profile.account.signedInLabel': 'Current account',
  'mobile.profile.account.signedInHint': 'An access token is already in place. Sign in again to switch accounts or add another credential.',
  'mobile.profile.account.offline': 'Not signed in',
  // The form moved into the Settings sheet: pointing "below" would send the user
  // hunting through Profile for something that is no longer there.
  'mobile.profile.account.offlineHint': 'You can keep using the app without signing in; the manual credential fallback lives in Settings.',
  'mobile.profile.sync.manualHint': 'The fields below are the manual fallback: you only need them when you already have a token (for example copied from another device).',
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

  // ── Motivation ──
  // The mobile growth screen. Same numbers as the web view (they come from
  // `@heyta/app-host#motivation`), so the two shells cannot drift apart.
  // The three product red lines are stated in the copy and in the UI:
  // no currency, compare only with your past self, never guilt-trip.
  'mobile.growth.title': 'My growth',
  'mobile.growth.back': 'Back',
  'mobile.growth.entry': 'My growth',
  'mobile.growth.entry.hint': 'Today, streaks and milestones',
  // ── M3 knife 7 (habits): the mobile "Profile → Habits" entry ──
  'mobile.habits.entry': 'Habits',
  'mobile.habits.entry.hint': 'Check in, streaks and the heatmap',
  'mobile.growth.compare.note': 'Every number here compares you only with your past self. No leaderboards.',

  // Today (L1)
  'mobile.growth.today.title': 'Today',
  'mobile.growth.today.a11y': '{done} of {total} done today',
  'mobile.growth.today.hint.idle': 'Nothing recorded today yet',
  'mobile.growth.today.hint.unplanned': '{count} extra finished beyond the plan',
  'mobile.growth.today.hint.allDone': 'Everything planned for today is done',
  'mobile.growth.today.hint.remaining': 'Still {count} to go today',
  'mobile.growth.today.closed': 'Today is complete',
  'mobile.growth.today.habits': 'Habits {done}/{planned}',
  'web.growth.today.habits': 'Habits {done}/{planned}',
  'mobile.growth.today.tasks': 'Tasks {done}/{planned}',
  'web.growth.today.tasks': 'Tasks {done}/{planned}',
  'mobile.growth.today.bonus': '{count} beyond the plan',
  'web.growth.today.bonus': '{count} beyond the plan',
  'mobile.growth.today.focus': 'Focus {minutes} min',
  'web.growth.today.focus': 'Focus {minutes} min',

  // Weekly review (L3). Deltas stay neutral: no red for a lower week.
  'mobile.growth.week.title': 'This week',
  'mobile.growth.week.range': '{start} to {end}',
  'mobile.growth.week.empty': 'Nothing recorded this week yet',
  'mobile.growth.week.headline.checkIns': 'Check-ins this week: {count}',
  'mobile.growth.week.headline.tasksCompleted': 'Tasks finished this week: {count}',
  'mobile.growth.week.headline.focusMinutes': 'Focus this week: {count} min',
  'mobile.growth.week.stat.checkIns': 'Check-ins',
  'mobile.growth.week.stat.tasks': 'Tasks',
  'mobile.growth.week.stat.focus': 'Focus',
  'mobile.growth.week.stat.previous': 'Last week: {count}',
  'mobile.growth.week.bestDay': 'Best focus day: {date}, {minutes} min',

  // Continuity (L2). Longest and total never go down, so a break always
  // leaves at least one number on screen that did not shrink.
  'mobile.growth.streak.title': 'Streaks',
  'mobile.growth.streak.note': 'Longest and total never go down — a break is not a loss.',
  'mobile.growth.streak.empty': 'No habits yet. Habits created on the web sync here.',
  'mobile.growth.streak.current': 'Current streak (days)',
  'mobile.growth.streak.longest': 'Longest: {days}',
  'mobile.growth.streak.total': 'Total: {count}',
  'mobile.growth.streak.repair': 'Yesterday is still open — repairing makes it {days}',
  'mobile.growth.streak.freshStart': 'Time since last: {days}. Longest {longest} and total {total} are still yours.',
  'mobile.growth.streak.a11y': '{name}: current {current}, longest {longest}, total {total}',

  // Milestones (L3). Accumulated totals only grow; nothing is subtracted.
  'mobile.growth.milestones.title': 'Milestones',
  'mobile.growth.milestones.note': 'Accumulated totals only ever grow. Nothing is subtracted.',
  'mobile.growth.milestones.maxed': 'Top tier reached',
  'mobile.growth.milestones.next': 'Next at {next}',
  'mobile.growth.milestones.a11y': '{name}: {value} so far, {reached} of {total} tiers earned',
  'mobile.growth.kind.checkIns': 'Check-ins',
  'mobile.growth.kind.focusHours': 'Focus hours',
  'mobile.growth.kind.tasks': 'Tasks done',
  'mobile.growth.kind.activeDays': 'Active days',

  // Identity tags (L3). An identity, not a reward — no coins, nothing to spend.
  'mobile.growth.tags.title': 'Identities',
  'mobile.growth.tags.note': 'An identity is not a reward; it is something you already did.',
  'mobile.growth.tags.empty': 'No identities yet. Take your time.',
  'mobile.growth.tags.near': '{gap} to go for "{name}"',
  'mobile.growth.tags.reachedA11y': 'Earned: {name}',
  'mobile.growth.tag.started': 'One week in',
  'mobile.growth.tag.routine': 'Part of the routine',
  'mobile.growth.tag.steady': 'A steady hundred',
  'mobile.growth.tag.checkin-hundred': 'A hundred check-ins',
  'mobile.growth.tag.deep-fifty': 'Fifty deep hours',
  'mobile.growth.tag.deep-two-hundred': 'Two hundred deep hours',
  'mobile.growth.tag.finisher-five-hundred': 'Five hundred finished',
  'mobile.growth.tag.streak-thirty': 'Thirty days straight',

  // ── Trash (mobile second level, entered from Profile) ──────
  // Kept separate from `web.trash.*` on purpose: the mobile confirmation adds
  // the "this is not a physical erase" clause. Purge only writes the
  // `purgedAt` marker — the op-log payload survives locally and on the server.
  'mobile.trash.title': 'Trash',
  'mobile.trash.entry': 'Trash',
  'mobile.trash.entry.hint': 'Restore tasks you deleted',
  'mobile.trash.intro': 'Deleted tasks land here. Restore one and it goes back where it was.',
  'mobile.trash.empty.title': 'Trash is empty',
  'mobile.trash.empty.hint': 'Tasks you delete show up here first',
  'mobile.trash.deletedAt': 'Deleted {date}',
  'mobile.trash.restore': 'Restore',
  'mobile.trash.restoreA11y': 'Restore: {title}',
  'mobile.trash.purge': 'Delete permanently',
  'mobile.trash.purgeA11y': 'Delete permanently: {title}',
  'mobile.trash.confirm.title': 'Delete “{title}” permanently?',
  'mobile.trash.confirm.body': 'It leaves the trash and cannot be restored.',
  'mobile.trash.confirm.notErasure': 'This is not a physical erase: the operation log still holds this record — the app simply stops offering a restore.',
  'mobile.trash.confirm.submit': 'Delete permanently',
  'mobile.trash.confirm.cancel': 'Cancel',

  // ── Export (mobile second level, entered from Profile) ─────
  // The export document's own wording and the "you cannot import it back"
  // clause reuse the web `web.export.*` entries — that wording belongs to the
  // export, not to the web shell, and both hosts reading the same keys is what
  // keeps them from ever disagreeing. Only mobile-specific bits live here.
  'mobile.export.entry': 'Export data',
  'mobile.export.entry.hint': 'Take your data out (no import back yet)',
  'mobile.export.json.button': 'Share JSON',
  'mobile.export.markdown.button': 'Share task list',
  'mobile.export.shareHint': 'The export is handed to the system share sheet, where you choose where it goes.',
  'mobile.import.pasteLabel': 'Paste the CSV text',
  'mobile.import.pastePlaceholder': 'Long-press here to paste the CSV exported from TickTick',
  'mobile.import.preview': 'Preview',
  'mobile.import.pasteNotFile': 'On mobile this field takes **text**, not a chosen file - picking a file would need a native dependency we have not added.',
  'mobile.export.shareTitle': 'heyta export',
  'mobile.export.shareFailed': 'The system share sheet did not open, so nothing was sent.',

  // ══════════════════════════════════════════════════════════════════
  // Site (multi-page) — see docs/adr/0033-multi-page-site-and-bidirectional-reachability.md
  //
  // 🔴 Every key below is driven by the page registry in
  //    `apps/landing/src/site/pages.ts`: nav, footer, per-page <title>/<meta>
  //    and the sitemap are all derived from it. Adding a page means editing the
  //    registry + this table + one component — never the nav or the sitemap.
  // ══════════════════════════════════════════════════════════════════
  'site.nav.home': 'Home',
  'site.nav.features': 'Features',
  'site.nav.platforms': 'Platforms',
  'site.nav.pricing': 'Pricing',
  'site.nav.integrations': 'Advantages',
  'site.nav.help': 'Help',
  'site.nav.changelog': 'What\'s new',
  'site.nav.signin': 'Sign in',
  'site.nav.aria': 'Site navigation',
  'site.footer.group.product': 'Product',
  'site.footer.group.support': 'Support',
  'site.footer.group.legal': 'Legal',
  // 🔴 R2 (2026-10-05): nine zero-reference entries used to live here and have
  // been deleted: `site.footer.{terms,privacy,license,aria}`, `site.backHome`,
  // `site.appLink.{label,pending,pendingCta}`, `site.signin.cta`.
  //
  // The criterion was measurement, not eyeballing: after excluding `dist/` and
  // the catalogues themselves, repo-wide references (including `.mjs` / `.html`)
  // are 0. A raw grep showed 4 hits each — all build artifacts under
  // `packages/i18n/dist/**`, i.e. **not filtering `dist/` makes dead keys look
  // alive**.
  //
  // ⚠️ When adding one back, do not add the entry alone: `MessageKey` is derived
  // from the Chinese catalogue, so an entry nobody renders compiles fine — which
  // is exactly how those nine came to exist. Adding the entry and wiring the
  // surface must happen together.

  // ── Home SEO (was hard-coded in index.html; now in the table so every page
  //    can be generated from one source) ──
  'site.home.seo.title': 'heyta: local-first task management you can self-host',
  'site.home.seo.description': 'heyta is a local-first task manager for tasks, lists, habits and focus. Your data stays on your device first, syncs end-to-end encrypted, and can run on your own server.',

  // ── Features ──
  'site.features.seo.title': 'Features — heyta',
  'site.features.seo.description': 'What heyta can do: tasks and lists, four quadrants, habits, a focus timer, timeline, growth system, encrypted sync, and AI assistant access. Shipped features only.',
  'site.features.title': 'Features',
  'site.features.lede': 'What heyta can **already do**, module by module. For the latest progress, see the changelog.',
  'site.features.section.tasks': 'Tasks and lists',
  'site.features.section.views': 'Views',
  'site.features.section.habits': 'Habits',
  'site.features.section.focus': 'Focus',
  'site.features.section.growth': 'Motivation and growth',
  'site.features.section.sync': 'Sync and privacy',
  'site.features.section.ai': 'AI (bring your own endpoint)',
  'site.features.section.api': 'AI assistant access',
  'site.features.item.task.fields': 'Title, note (Markdown), priority, due date, list, tags',
  'site.features.item.task.repeat': 'Recurring tasks: daily / weekly / weekdays / monthly — four presets, one tap',
  'site.features.item.task.projects': 'Lists support one level of folders; lists and tags each have their own panel',
  'site.features.item.task.trash': 'Trash: deleted items are kept first — restore them anytime, or clear them for good',
  'site.features.item.task.export': 'One-click export: a complete JSON backup (deleted records included, counts you can verify) plus readable Markdown',
  'site.features.item.view.quadrant': 'Four quadrants: sorted automatically by importance and due date — drag to adjust',
  'site.features.item.view.timeline': 'Timeline: laid out by estimated duration, for personal project planning',
  'site.features.item.view.today': 'Today / Inbox / Completed / Trash: smart lists',
  'site.features.item.habit.model': 'Daily check-in and undo (check-ins sync across devices)',
  'site.features.item.habit.streak': 'Streaks and longest run, with **freeze / reconnect / repair** resilience',
  'site.features.item.habit.heat': 'Heatmap and a year view',
  'site.features.item.focus.timer': 'Focus timer with long breaks; durations are yours to set (1–180 minutes)',
  'site.features.item.focus.link': 'A session can be linked to a specific task and lands in your stats',
  'site.features.item.growth.feedback': 'Today\'s progress card: honest numbers, including work you did not plan',
  'site.features.item.growth.narrative': 'Weekly review letter, milestone map, identity tags',
  'site.features.item.growth.colors': 'Activity colours: **you** assign the meaning; the app never judges whether an activity is "healthy"',
  'site.features.item.sync.e2ee': 'End-to-end encryption: tasks are encrypted **on your device** before upload; the server only relays ciphertext',
  'site.features.item.sync.offline': 'Offline first: keep working with no connection; changes go up when it returns',
  'site.features.item.sync.conflict': 'Visible conflicts: concurrent edits are never silently dropped — you choose which to keep',
  'site.features.item.sync.selfhost': 'Self-hosting: one command on your own machine, and your data never leaves your hands',
  'site.features.item.ai.byok': 'AI runs against **your own** endpoint (local Ollama / LM Studio, or any OpenAI-compatible URL)',
  'site.features.item.ai.gate': 'AI is off by default; turn it on per feature — only what you allow ever leaves',
  'site.features.item.ai.features': 'Four features: one-line capture, task breakdown, quadrant and priority suggestions, duration estimate',
  'site.features.item.api.mcp': 'Connect AI assistants (MCP): let assistants like Claude read, create and complete tasks — six actions in total',
  'site.features.item.api.local': 'Local interface: off by default; even when on, it only accepts connections from this computer, with per-tool consent',
  'site.features.note': 'Everything above is **live in the current version**. For the latest progress, see the changelog.',
  'site.features.pending.title': 'Not built yet',
  'site.features.pending.body': 'Frequency goals for habits (N times per week — the target value and unit can already be set, what is missing is "how many days a week"), system-notification delivery on mobile (both ends can set a reminder, but only the web actually pops a notification, and only while the app is open), custom filters, a board view, and bulk actions are on the way — they will show up in the changelog as soon as they land.',
  'site.features.notdoing.title': 'Decided against',
  'site.features.notdoing.body': 'Leaderboards and social features (there is no trustworthy aggregator under end-to-end encryption), coin or point stores, charging per feature, and WeChat reminders (they need the server to read plaintext).',

  // ── Platforms ──
  'site.platforms.seo.title': 'Platform status — heyta',
  'site.platforms.seo.description': 'Where heyta really stands: web is live, Android works on a real device, iOS is simulator-level, desktop builds but is unsigned, HarmonyOS builds but does not run yet.',
  'site.platforms.title': 'Platform status',
  'site.platforms.lede': 'Where each platform really stands, stated plainly: working is working, not ready is not ready.',
  'site.platforms.status.available': 'Available',
  'site.platforms.status.partial': 'In progress',
  'site.platforms.status.blocked': 'Blocked',
  'site.platforms.legend.available': 'Works, and has an end-to-end check',
  'site.platforms.legend.partial': 'It runs, but something required for release is missing',
  'site.platforms.legend.blocked': 'There is a specific external dependency we have not cleared',
  'site.platforms.web.name': 'Web',
  'site.platforms.web.body': 'The full product, not a demo. Installable, works offline, and your data lives in your own browser.',
  'site.platforms.android.name': 'Android',
  'site.platforms.android.body': 'Works on a real device: creating tasks, rescheduling, priorities, lists, tags, recurrence, focus, conflict resolution and trash all work. Widgets and a release signature are on the way.',
  'site.platforms.ios.name': 'iOS',
  'site.platforms.ios.body': 'Fully working in the simulator: install, create the local database, sync to another device. Real-device testing and a developer signature are still missing.',
  'site.platforms.desktop.name': 'Desktop (Windows / macOS / Linux)',
  'site.platforms.desktop.body': 'Builds on all three desktop platforms. Not yet signed or notarized — on macOS the first open needs a right-click — and the interface is still being polished.',
  'site.platforms.harmony.name': 'HarmonyOS',
  'site.platforms.harmony.body': 'The build chain works and produces an installer package, but the app does not run yet — blocked on an emulator image and signing.',
  'site.platforms.selfhost.name': 'Self-hosting',
  'site.platforms.selfhost.body': 'One docker compose file runs the whole stack on your own machine. You configure your own secrets and database password — not a zero-thought installer, but every step is documented.',
  'site.platforms.note': '⚠️ Why "unsigned" deserves its own line: on macOS an unsigned, unnotarised app **is refused on double-click**, and has to be opened via the context menu. Leave that out and people think the download is broken.',

  // ── Pricing ──
  'site.pricing.seo.title': 'Pricing — heyta',
  'site.pricing.seo.description': 'heyta pricing: self-hosting is free forever, official hosting is ¥5/month, official hosting with cloud AI is ¥12/month. Nothing is charged per feature — the free tier is the whole product.',
  'site.pricing.title': 'Pricing',
  'site.pricing.lede': 'Exactly two things cost money: **us running the sync server for you**, and **our cloud AI**. Features are not for sale — the free column is every feature.',
  'site.pricing.compare.title': 'Self-hosting vs our hosting',
  'site.pricing.compare.diy': 'You run it (free)',
  'site.pricing.compare.hosted': 'We run it (paid)',
  'site.pricing.compare.row.function': 'Features',
  'site.pricing.compare.function.same': 'Identical',
  'site.pricing.compare.row.server': 'Server',
  'site.pricing.compare.server.diy': 'Your machine, your upgrades and backups',
  'site.pricing.compare.server.hosted': 'Our machine, we run it',
  'site.pricing.compare.row.data': 'Where data lives',
  'site.pricing.compare.data.diy': 'Entirely in your hands',
  'site.pricing.compare.data.hosted': 'On your device; our server holds ciphertext only',
  'site.pricing.compare.row.ai': 'AI',
  'site.pricing.compare.ai.diy': 'Your own endpoint — free forever, never metered',
  'site.pricing.compare.ai.hosted': 'Your own endpoint is free; our cloud AI needs the ¥12 tier',
  'site.pricing.compare.row.lockin': 'Lock-in',
  'site.pricing.compare.lockin.same': 'Either way you can export everything at any time (JSON with the full operation log, plus Markdown)',
  'site.pricing.faq.title': 'Questions',
  'site.pricing.faq.expire.q': 'Do I lose my data when a subscription ends?',
  'site.pricing.faq.expire.a': 'No. Your data lives on your own device. Expiry stops the hosting and cloud AI on our side; nothing local is touched, and you can export at any point.',
  'site.pricing.faq.where.q': 'Where is my data kept?',
  'site.pricing.faq.where.a': 'On your device first. The cloud is only a sync channel, and it holds **ciphertext only** — the keys stay with you, so the server cannot read any of it.',
  'site.pricing.faq.export.q': 'If I stop paying, how do I take my data?',
  'site.pricing.faq.export.a': 'Settings has an export: JSON with the full operation log and deleted records (with countable totals) plus Markdown. You need neither our permission nor a connection.',
  'site.pricing.faq.buy.q': 'Can I buy it now?',
  'site.pricing.faq.buy.a': '**Not yet.** The checkout route works, but the payment channel (a WeChat Pay merchant account) is not connected, so this page deliberately has **no buy button** — a button that does nothing is worse than no button.',

  // ── What's different (data sovereignty + contrast with TickTick, A7) ──
  //    Material: dida365-feature-benchmark §5's nine capabilities, regrouped by
  //    A7's three criteria: sovereignty / contrast / the other two. Every claim
  //    carries a reproducible verification.
  'site.integrations.seo.title': 'Your data, in your hands — heyta',
  'site.integrations.seo.description': 'What sets heyta apart: end-to-end encrypted sync, a self-hostable server, AI assistant access, bring-your-own AI endpoints, complete export, and no feature gating.',
  'site.integrations.title': 'Your data, in your hands',
  'site.integrations.lede': 'Most tools keep your data on their servers by default. heyta is the other way round: **your data stays in your hands**, and it is only touched when you allow it. This page is where that difference becomes concrete.',
  'site.integrations.e2ee.title': 'End-to-end encrypted sync',
  'site.integrations.e2ee.body': 'Tasks are encrypted on your device before they ever upload; the server only ever handles ciphertext. There is **no readable copy** of your tasks on the server — anyone who takes it holds nothing but noise.',
  'site.integrations.e2ee.item.ingress': 'The server accepts ciphertext only — plaintext is refused outright. Not a setting, a hard rule',
  'site.integrations.e2ee.item.keys': 'Keys stay with you. Forget the passphrase and even we cannot help — that is what real encryption means',
  'site.integrations.selfhost.title': 'Self-host it, free forever',
  'site.integrations.selfhost.body': 'The sync server runs entirely on your own machine: one docker compose file brings up the whole stack, and data lands on your own disk. No fees, and no permission needed from us.',
  'site.integrations.selfhost.item.compose': 'One command brings up the whole stack; data lands on your own disk',
  'site.integrations.selfhost.item.free': 'No usage-based pricing, and no self-hosted tier that quietly lacks features',
  'site.integrations.localApi.title': 'AI assistant access: off by default, per-tool consent',
  'site.integrations.localApi.body': 'heyta ships a local-only interface that AI assistants like Claude can use to read, create and update tasks. Off by default; even when on, every tool needs your individual consent — whatever you did not allow, the assistant cannot reach.',
  'site.integrations.localApi.item.tools': 'Six actions: list tasks, view a task, list lists, create, update, complete',
  'site.integrations.localApi.item.gate': 'Off by default, local connections only; you authorize each tool individually',
  'site.integrations.byok.title': 'Bring your own AI endpoint',
  'site.integrations.byok.body': 'AI features are not tied to any vendor: you supply the endpoint and model name, and requests go straight there. The built-in presets are **local** Ollama and LM Studio — there is no "our cloud only" path.',
  'site.integrations.byok.item.presets': 'Presets cover local Ollama and LM Studio; cloud endpoints are yours to fill in',
  'site.integrations.byok.item.nosdk': 'No vendor SDKs — requests are plain HTTP you can swap out',
  'site.integrations.export.title': 'Export is a complete backup, not a rough copy',
  'site.integrations.export.body': 'Export writes more than the current list: the full history, deleted records included, with a counts block inside the file — so "did it all come out" is something you can check yourself.',
  'site.integrations.export.item.json': 'JSON: full history, deleted records included, with verifiable counts',
  'site.integrations.export.item.markdown': 'Plus a Markdown copy written for humans',
  'site.integrations.pricing.title': 'No feature-based pricing',
  'site.integrations.pricing.body': 'The free tier is **every feature** — no "9 lists, 99 tasks" ceilings. Only two things cost money: us running the server for you, and our cloud AI.',
  'site.integrations.pricing.item.nogate': 'No feature gates: the only paid items are hosting and cloud AI',
  'site.integrations.pricing.item.onlytwo': 'Pricing claims are enforced by a consistency check, not by good intentions',
  'site.integrations.quadrant.title': 'Four quadrants are a view, not another copy to maintain',
  'site.integrations.quadrant.body': 'The four quadrants are not an extra field on a task — they are **computed on the spot** from the due date and priority. So they can never drift out of sync with your tasks: change one thing, everything follows.',
  'site.integrations.quadrant.item.derived': 'Quadrants derive from the due date and priority; tasks carry no extra field',
  'site.integrations.quadrant.item.nodrift': 'So there is no second copy of state that looks present but never synced',
  'site.integrations.resilience.title': 'Habit resilience: freeze, resume, repair',
  'site.integrations.resilience.body': 'Streaks break, and wiping out weeks of progress over one missed day is the cruellest design. heyta lets you **freeze** a gap, **resume** an interrupted streak, and **repair** damaged data — none of it minted as points, none of it for sale.',
  'site.integrations.resilience.item.states': 'Freezes are capped: insurance, not a free pass to skip days',
  'site.integrations.resilience.item.nocurrency': 'All state derives from your own check-ins — no virtual currency to sell',
  'site.integrations.conflict.title': 'Conflicts made visible, resolved by you',
  'site.integrations.conflict.body': 'When two devices edit the same task, the conflict is **never quietly resolved by dropping one side**: the interface shows both versions and you choose. The rules are identical on every device, and the process is **visible**.',
  'site.integrations.conflict.item.visible': 'Both versions side by side; the choice is yours',
  'site.integrations.conflict.item.lww': 'Both ends share one set of rules and one set of wording',
  'site.integrations.note': 'This page only covers what already works. What does not is listed honestly under "Not yet" on the features page.',

  // ── Help ──
  'site.help.seo.title': 'Help — heyta',
  'site.help.seo.description': 'heyta help: creating tasks, syncing, what to do when the encryption passphrase is lost, how passkeys work, how quadrants are classified, how repeats are set, how focus works, exporting your data, self-hosting, and where your data actually lives.',
  'site.help.title': 'Help',
  'site.help.lede': 'Organised by **what you are trying to do**, not by document type — and every answer says where to click and what you should see afterwards.',
  'site.help.topics.title': 'Start here',
  'site.help.module.start': 'Getting started',
  'site.help.module.sync': 'Sync and accounts',
  'site.help.module.organize': 'Organising and rhythm',
  'site.help.module.data': 'Your data and self-hosting',
  'site.help.module.trust': 'Privacy',
  'site.help.q.create': 'How do I create a task?',
  'site.help.a.create': 'Type one line into the capture box at the top of the app and press Enter. Dates and priorities can be written inside the sentence (for example "submit the report tomorrow at 3pm"); whatever it recognises appears as a chip you can undo. A bare title is fine too — you can add a note later on the task row.',
  'site.help.q.sync': 'I have a new device — how does my data get there?',
  'site.help.a.sync': 'Enter the sync server address and an access token in settings. Data is uploaded encrypted, so **the passphrase must match** — data encrypted under a different passphrase cannot be decrypted. That is the cost of end-to-end encryption, not a bug.',
  'site.help.q.passphrase': 'I forgot my encryption passphrase. What now?',
  'site.help.a.passphrase': '**There is no recovery, and that is by design, not an oversight.** End-to-end encryption means the server holds only ciphertext and has no passphrase that unlocks it — any "recovery" would mean the server could read your data. What you can do: export your data from an old device that can still unlock, then start fresh with a new passphrase on the new one. So keep the passphrase safe.',
  'site.help.q.passkey': 'How do passkeys work?',
  'site.help.a.passkey': 'Choose "passkey" when signing in and confirm with your device\'s face / fingerprint / system PIN. There is no password to remember and none to breach. If you lose it, the sign-in page offers "Lost your passkey?", which emails a recovery link where you register a new one. ⚠️ **The last remaining credential cannot be deleted** — delete it and you are locked out.',
  'site.help.q.quadrant': 'How are the four quadrants classified?',
  'site.help.a.quadrant': 'Quadrants are **computed on the spot**, not labels you attach to a task: "urgent" depends on whether the due date falls inside the near-term window, and "important" comes from the flag you set yourself (falling back to priority when you never set it). Change the due date or priority and the task changes cell — so the quadrants can never disagree with your tasks.',
  'site.help.q.repeat': 'How do I set up a repeating task?',
  'site.help.a.repeat': 'Both **the web and mobile** can set it: open the task details and pick a common preset (daily / weekly / weekdays / monthly) or write a custom rule directly. When you tick off a repeating task, its next due date advances by the rule, measured from the **original due date** rather than from the moment you ticked it. The advancing algorithm and the differences between the ends are in "Repeating tasks: what "next time" really means".',
  'site.help.q.focus': 'How does focus (the pomodoro timer) work?',
  'site.help.a.focus': 'Pick a task on the focus screen and start the timer; when it finishes the session is recorded and feeds your growth stats. You can change the durations yourself (25 minutes focus / 5 minutes break by default) and they are remembered — a page refresh keeps the new values.',
  'site.help.q.export': 'How do I take my data with me?',
  'site.help.a.export': 'All three ends can **export**: on the web under Settings, on mobile under "Mine" via the system share sheet, and `export` on the command line. But **only the web and the CLI can import it back**, and only into an empty library — mobile has no import entry point. See "Taking your data with you".',
  'site.help.q.selfhost': 'How do I run my own server?',
  'site.help.a.selfhost': 'You can, but this is "operate a service yourself", not one command and you are done: **no prebuilt image is published** (you build it), **bringing the service up is not a deployment** (the table-structure changes have to be applied explicitly, once), and **you cannot register at all without an email service**. See "Running your own sync server".',
  'site.help.q.privacy': 'Where does my data actually live?',
  'site.help.a.privacy': 'On your own device first; once sync is on, the cloud holds ciphertext only — the server rejects plaintext outright. **Metadata is not encrypted**, though — sync times, device identifiers, and the fact that a task changed are visible to it. We do not advertise "we can see nothing".',

  // ── Documentation centre (the article layer under /help) ────
  // Group headings deliberately reuse the five `site.help.module.*` keys above:
  // the help centre and the docs centre are **two depths of one IA**, not two
  // centres, so a second set of group titles would only be a second thing to drift.

  'site.docs.nav.title': 'Documentation',
  'site.docs.nav.back': 'Help centre home',
  'site.docs.hub.articles': 'Read in depth',
  'site.docs.hub.faq': 'Quick answers',
  // Sidebar group collapse and the mobile drawer — these are accessible names,
  // they are never rendered as visible text.
  'site.docs.nav.toggle': 'Collapse or expand this group',
  'site.docs.nav.open': 'Open documentation menu',
  'site.docs.nav.close': 'Close documentation menu',
  // Top search in the docs centre. It matches **titles only** (never body text) and
  // jumps to that section's anchor — the placeholder must not promise "search content".
  'site.docs.search.label': 'Search the docs',
  'site.docs.search.placeholder': 'Search titles. Multiple words must all match.',
  'site.docs.search.clear': 'Clear search',
  'site.docs.search.none': 'No title matches. Try a shorter keyword or a different word.',
  // The cap is a constant in code, not in the copy — writing it here lets the two drift.
  'site.docs.search.truncated': 'Showing the first {count} matches — try a more specific keyword.',
  // Heading of the in-page contents list (its items come from the rendered sections).
  'site.docs.toc.title': 'On this page',
  // The prefix inside a figure number. The digits ("20-1") come from registry order
  // at render time — baking the word into the number is how English pages end up
  // showing a Chinese character.
  'site.docs.figure': 'Figure',
  // Category pages (`/help/<module>`). Their headings reuse `site.help.module.*`
  // — naming the same group twice is how two centres appear. Only a module that
  // actually has a registered category page needs this pair of keys.
  'site.docs.cat.start.seo.title': 'Documentation · Getting started — heyta',
  'site.docs.cat.start.sum': 'Two questions this group answers: whether you can use the app without an account at all, and what "task", "list", "tag" and "habit" each mean as data.',
  'site.docs.cat.sync.seo.title': 'Documentation · Sync and accounts — heyta',
  'site.docs.cat.sync.sum': 'Three questions this group answers: how data actually moves between your devices, where login credentials come from, and what happens if you lose your end-to-end encryption passphrase.',
  'site.docs.cat.organize.seo.title': 'Documentation · Organising and rhythm — heyta',
  'site.docs.cat.organize.sum': 'Three questions this group answers: what "next time" means once you tick off a repeating task, what each of the four views is actually for, and under which conditions a reminder really goes off.',
  'site.docs.cat.data.seo.title': 'Documentation · Your data and self-hosting — heyta',
  'site.docs.cat.data.sum': 'Two questions this group answers: what self-hosting actually asks of you, and how your data comes with you and goes back in — the second one is not available on every end yet.',
  'site.docs.cat.trust.seo.title': 'Documentation · Privacy — heyta',
  'site.docs.cat.trust.sum': 'Two questions this group answers: every route by which data can leave this device, and which of three lost things you can get back.',

  // How syncing works
  'site.docs.how.title': 'How syncing works',
  'site.docs.how.seo.title': 'How syncing works — heyta',
  'site.docs.how.sum': 'Your data lands on your own device first and the cloud is only an encrypted transport channel — plus when each end actually touches it.',
  'site.docs.how.s1': 'Local-first: the cloud is not the source of truth',
  'site.docs.how.s1p1': 'Every task you write in heyta goes **into that device\'s own database first**, and only then is uploading considered. With no network, or with the server down, the app reads and writes normally.',
  'site.docs.how.s1p2': 'The sync server is a **channel plus a place to keep ciphertext**: it carries what device A wrote over to device B. It does not decide which data counts.',
  'site.docs.how.s1p3': 'So a failed sync does not lose anything — those writes are still on your machine and go out the next time a sync succeeds.',
  'site.docs.how.s2': 'When it actually syncs (this differs per platform)',
  'site.docs.how.s2p1': 'This is **the most concrete difference between the ends today**, so we state it plainly:',
  'site.docs.how.s2i1': 'Web and desktop: a write **does not go out on its own**. Click "Sync now" in the top bar, or "Save and sync" in the sync settings.',
  'site.docs.how.s2i2': 'Mobile: a write goes out about two seconds later; returning to the foreground adds another pass; failures back off instead of hammering the server.',
  'site.docs.how.s2i3': 'Every end: **what other devices wrote arrives on its own**. The server pushes a signal when there is something new, and the side that receives it pulls.',
  'site.docs.how.s3': 'What the server actually cannot see',
  'site.docs.how.s3p1': 'Uploaded payloads are **encrypted end to end**: encryption and decryption both happen on your devices, and the server receives — and can only ever receive — ciphertext. A client that tries to upload plaintext is rejected outright and nothing is written.',
  'site.docs.how.s3p2': 'But the **surrounding metadata is not encrypted**: sync times, which devices you use, which kinds of things were touched and in what order are all visible to it. What is protected is the content itself — task titles, notes — not "which heyta features you use". We do not advertise "we can see nothing".',

  // Accounts, tokens, and how you sign in
  'site.docs.account.title': 'Accounts, tokens, and how you sign in',
  'site.docs.account.seo.title': 'Accounts, tokens, and how you sign in — heyta',
  'site.docs.account.sum': 'heyta has no password to remember and none to credential-stuff — so where does the access token that syncing needs come from?',
  'site.docs.account.s1': 'Three boxes, that is all',
  'site.docs.account.s1p1': 'The sync settings have exactly three fields: server address, access token, end-to-end encryption passphrase.',
  'site.docs.account.s1i1': 'Server address: the sync server you want to connect to. Leave everything empty and you are using heyta purely locally — the data stays on this device.',
  'site.docs.account.s1i2': 'Access token: issued by the server, it stands for "this account\'s space on that server". If you already have one, paste it straight in.',
  'site.docs.account.s1i3': 'Encryption passphrase: **never stored on disk**, it exists only in this session\'s memory. It gets its own article — see "The encryption passphrase".',
  'site.docs.account.s2': 'There is no email-plus-password path',
  'site.docs.account.s2p1': 'There are exactly two ways to sign in: an emailed link and a passkey. Settings has no "password" field, and that recovery entry is not a password reset. That is deliberate: we do not offer the kind of credential that gets credential-stuffed.',
  'site.docs.account.s2i1': 'Emailed link: enter your address, open the mail, click the link — signed in.',
  'site.docs.account.s2i2': 'Passkey: confirm with the device itself — face, fingerprint, or system PIN. Nothing to remember, so nothing to leak.',
  'site.docs.account.s2i3': 'Lost your passkey: the sign-in page offers "Lost your passkey?", which emails a recovery link. That step has to call the platform authenticator in a real browser, so it opens a standalone page rather than an in-app sheet.',
  'site.docs.account.s3': 'Why the desktop shells hand off to your browser',
  'site.docs.account.s3p1': 'Passkeys do not work inside the macOS and Windows shells (measured: the embedded WebView exposes no platform authenticator). So the shell sends you to your **system browser** to sign in and takes the result back automatically; if the operating system never hands the address back, that page also shows a link you can click yourself.',
  'site.docs.account.s4': 'The terms belong to "that server"',
  'site.docs.account.s4p1': 'The checkbox at registration reads "the terms of service and privacy policy **offered by this server**". Because anyone can deploy heyta — who runs the server you connect to, and which terms apply, is that server\'s decision.',

  // The encryption passphrase
  'site.docs.passphrase.title': 'The encryption passphrase',
  'site.docs.passphrase.seo.title': 'The encryption passphrase — heyta',
  'site.docs.passphrase.sum': 'It is the only key in the whole design, and losing it genuinely cannot be undone — that is the definition of end-to-end encryption, not something we failed to build.',
  'site.docs.passphrase.s1': 'What the passphrase is',
  'site.docs.passphrase.s1p1': 'The passphrase encrypts your data on your device before it is uploaded. It is **never sent to the server**, and the server holds no copy of it.',
  'site.docs.passphrase.s1p2': 'It is never written to disk either: it lives only in the current session\'s memory, so every new session asks for it again. That is not friction — not persisting it is what makes the encryption end-to-end.',
  'site.docs.passphrase.s2': 'Why there is no "forgot password"',
  'site.docs.passphrase.s2p1': 'Any mechanism that could "recover" the passphrase means somewhere there is a credential able to decrypt everything you have, and that credential would live on the server or with a third party — which is the end of end-to-end encryption. So there is no support channel and no back-end switch. **Lose the passphrase and the synced data cannot be decrypted.**',
  'site.docs.passphrase.s2i1': 'On an old device that can still unlock: export your data first.',
  'site.docs.passphrase.s2i2': 'Then set a new passphrase on the new device and start writing again.',
  'site.docs.passphrase.s2i3': 'Keep the passphrase in your own password manager — that is where it belongs.',
  'site.docs.passphrase.s3': 'What happens if it is wrong',
  'site.docs.passphrase.s3p1': 'Records written under a different passphrase cannot be decrypted. heyta neither falls over nor substitutes plaintext: it **skips** what it cannot open, or **pauses syncing** when this is plainly a misconfiguration, and tells you which of the two it is.',
  'site.docs.passphrase.s3w1': 'A "the passphrase may be wrong" message is the second case — it is not a network problem, and reconnecting will not fix it.',

  // Conflicts
  'site.docs.conflict.title': 'When two devices change the same thing',
  'site.docs.conflict.seo.title': 'When two devices change the same thing — heyta',
  'site.docs.conflict.sum': 'Editing separately and meeting later is certain in a local-first app — here is what makes it a conflict, and how you decide.',
  'site.docs.conflict.s1': 'Why conflicts exist at all',
  'site.docs.conflict.s1p1': 'heyta is not "every device sharing one live database". Each device writes its own log first and passes entries along afterwards. So when two devices each change the same task while offline, **both are legitimate** — there is no central machine on the spot to rule one of them invalid.',
  'site.docs.conflict.s2': 'How it decides this is a conflict',
  'site.docs.conflict.s2p1': 'Every record carries the information about which changes it has already seen. Only when neither side is ahead of the other does it count as a real collision; if B wrote after having seen A, that is ordinary ordering and is never flagged. When they truly collide, the winner is settled deterministically by "last write plus device identifier", so both devices pick **the same** answer instead of each arbitrating half and drifting further apart.',
  'site.docs.conflict.s3': 'What you will see',
  'site.docs.conflict.s3p1': 'A conflict opens a dialog showing both the local and the remote version side by side, and you choose which to keep. Afterwards both ends converge on one value — that convergence has been verified end to end against a real server, not reasoned into existence.',

  // Self-hosting
  'site.docs.selfhost.title': 'Running your own sync server',
  'site.docs.selfhost.seo.title': 'Running your own sync server — heyta',
  'site.docs.selfhost.sum': 'You can, and it is one of the reasons heyta exists — but it means operating a service yourself, not one command and you are done.',
  'site.docs.selfhost.s1': 'The difficulty, up front',
  'site.docs.selfhost.s1p1': 'These four are what make people quit halfway, so they go first:',
  'site.docs.selfhost.s1i1': '**No prebuilt image is published** — you build it on your own machine.',
  'site.docs.selfhost.s1i2': 'Bringing the service **up** is not a deployment: schema changes are applied explicitly by the migration step in the deploy flow — the service itself never touches the schema at startup.',
  'site.docs.selfhost.s1i3': 'What it takes is a machine that stays on, a domain of your own, and the basic operational habits — reading service logs, letting certificates renew on time.',
  'site.docs.selfhost.s1i4': 'The key, the database password and the public hostname are yours to set — **there are no defaults**. Missing any one of them, the service **refuses to boot**; that is deliberate, so nobody can ship on a default secret.',
  'site.docs.selfhost.s2': 'What has to be configured',
  'site.docs.selfhost.s2i1': 'SMTP: without it you **cannot register at all**. heyta has no email-plus-password path, so both registration and sign-in require clicking a link in an email.',
  'site.docs.selfhost.s2i2': 'Public address: in production, a non-https public URL makes the service refuse to start. Plaintext HTTP is a legitimate self-hosting choice on a LAN, not on the public internet.',
  'site.docs.selfhost.s2i3': 'Passkeys: need a real hostname. Browsers reject IP literals, so when you reach the server by IP, only the emailed link remains.',
  'site.docs.selfhost.s2i4': 'Who may register: an address allow-list can close registration. Once closed, other people see "this server does not allow registering with that address".',
  'site.docs.selfhost.s3': 'Where the full steps live',
  'site.docs.selfhost.s3p1': 'The repository carries a deployment guide and a local-start guide written for whoever will operate the server — the repository icon in the nav bar is that door — and they agree with every sentence on this page. This page exists so you know what you are taking on **before** deciding whether to self-host.',
  'site.docs.selfhost.s3w1': 'Once you self-host, you are the party that "can see the metadata" — the encryption boundary described above is exactly the same one.',
  'site.docs.selfhost.s4': 'What your days look like afterwards',
  'site.docs.selfhost.s4p1': 'Upgrading. You decide when new code goes out, and you back the database up first — changes to table structure ship "forward only": a migration that has already run is never edited, a fix goes out as another one. So when an upgrade goes wrong, your way out is the backup, not rewriting history.',
  'site.docs.selfhost.s4p2': 'Renewing certificates. Domains and certificates both lapse. An expired certificate breaks the links inside emails and the HTTPS handshake from clients before anything else does, and both of those look exactly like "my account is gone".',
  'site.docs.selfhost.s4p3': 'Reading logs. Every symptom above — refusing to boot, registration mail that never arrives, an interface stuck on "offline" — has its real cause only in the service log. The interface shows you the last sentence of the story, never the first.',
  'site.docs.selfhost.s5': 'Your backup is ciphertext, by design',
  'site.docs.selfhost.s5p1': 'The database behind the server holds the encrypted operation log plus the metadata it needs. Restoring the service from that backup works completely; reading a task title out of it does not. That is not a broken backup — that is what end-to-end encryption means.',
  'site.docs.selfhost.s5p2': 'For a backup a human can read, use the client export (see "Taking your data with you"). It unpacks the materialized state on that one device, so what comes out matches what you could see.',
  'site.docs.selfhost.s5w1': 'Do not mistake "the database yields no plaintext" for "this backup is useless": it is the complete source for putting the service back together. Being readable by a person was never its job.',
  'site.docs.selfhost.s6': 'If the interface says offline, check this first',
  'site.docs.selfhost.s6p1': 'The usual answer is not "the service is down" but "the request never left the browser". The server lets through only the front-end origins listed in its configuration; if the origin of your page is not on that list, the browser blocks the request locally — the interface reads "offline" and the service log contains nothing at all.',
  'site.docs.selfhost.s6p2': 'So debug in reverse: look at the browser console for a cross-origin error before you look at the server. A quiet log does not mean a healthy service — it can mean nobody asked it anything.',
  'site.docs.selfhost.s6i1': 'Which origins get through is the server setting `CORS_ORIGINS`, a comma-separated list; in production a wildcard there makes the service refuse to start.',
  'site.docs.selfhost.s7': 'How to install: no ready-made images, two routes to pick from',
  'site.docs.selfhost.s7p1': 'Upstream publishes no versioned images — only `latest` and `master-<commit>` tags that follow the main branch. To pin a version, point `SUPERSYNC_IMAGE` at a specific `master-<commit>`; without pinning, every pull is an upgrade to the latest main branch.',
  'site.docs.selfhost.s7p2': 'The deploy script is the only supported entry point: it brings up the whole stack (app, PostgreSQL database, Caddy gateway), runs the database migration **before** swapping in the new container, and checks the health endpoint afterwards. Note that `docker compose up` by itself is **not** a deployment: automatic migrations at container startup are off by default (so a restart cannot race the migrator) — a stack started that way runs against an unmigrated schema.',
  'site.docs.selfhost.s7p3': 'With `--build` the image is compiled right on the deploy host — a full build of the whole repository: expect a peak of 1.5 GB of extra RAM (the containers already reserve about 2.5 GB), and a build cache that grows by roughly 1.4 GB per build and is **never pruned for you**. On a small machine, build elsewhere and push the image, or pin a ready-made tag. `--build` also refuses to build from dirty sources — a build artifact must trace back to one exact source tree.',
  'site.docs.selfhost.s7i1': 'The three required settings (signing secret, database password, public domain) leave no room for defaults: with any one missing, the service **refuses to start**. There is deliberately no "launch with a default secret" path.',
  'site.docs.selfhost.s7i2': 'The deploy script cross-checks the image\'s source-revision label so an old image cannot run new migrations. Custom images must pass the same revision; there is an explicit switch to skip the check, and it exists for deliberate overrides — not for oversights.',
  'site.docs.selfhost.s8': 'The environment variables, one by one',
  'site.docs.selfhost.s8p1': 'All configuration lives in one `.env` file in the deploy directory (copy it from the repository\'s env.example and edit). Changes take effect on container restart. Each one below is explained by what goes wrong when it is wrong:',
  'site.docs.selfhost.s8i1': '`DOMAIN` / `PUBLIC_URL`: the public domain and full public address. The links in emails are generated from it — a wrong value shows up as "the link in the email does not open".',
  'site.docs.selfhost.s8i2': '`JWT_SECRET`: the signing secret for login tokens. Empty means the service refuses to start; once set at first deployment, **do not change it** — rotating it signs out every logged-in device immediately and voids any email link already in flight.',
  'site.docs.selfhost.s8i3': '`POSTGRES_PASSWORD`: the database password, also with no default. When you use the bundled database there is no separate connection string to set — the default points at the stack\'s own PostgreSQL 16.',
  'site.docs.selfhost.s8i4': '`WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN`: the domain passkeys are bound to. It holds exactly **one** value, so changing the domain invalidates every passkey registered on this server (accounts survive; sign in with an email link and register a new passkey). It must be a real domain — browsers reject bare IP addresses.',
  'site.docs.selfhost.s8i5': '`CORS_ORIGINS`: which front-end origins may call the API, comma-separated, with `https://*.example.com`-style wildcards supported. The default points at the upstream demo site — **self-hosters must change it**, and not changing it is exactly the "the interface always reads offline" symptom from the previous section.',
  'site.docs.selfhost.s8i6': '`SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM`: outgoing mail. Sign-up and sign-in both run through email links — with this group unset, nobody can register at all.',
  'site.docs.selfhost.s8i7': '`HOST`: the address the service itself listens on, all interfaces by default. Behind a gateway you can tighten it to the local machine.',
  'site.docs.selfhost.s9': 'The database and schema changes',
  'site.docs.selfhost.s9p1': 'The database is PostgreSQL. Schema changes are **forward-only**: an applied migration file is never edited — a fix ships as a new migration. So when an upgrade goes wrong, the way back is your backup, not rewriting history.',
  'site.docs.selfhost.s9p2': 'Migrations run once per deployment, before the container is swapped. Some changes build indexes in the background and may wait on locks on a busy large database — upgrade off-peak and give the migration a generous timeout (15 minutes by default, adjustable). A timeout has its own exit code; clear the blocking transaction and re-run.',
  'site.docs.selfhost.s9p3': 'The minimal backup discipline: back the database up regularly. A backup holds ciphertext payloads plus surrounding metadata — it is everything you need to restore the service, and not a photo album you can flip through (see "your backup is ciphertext" below).',
  'site.docs.selfhost.s10': 'What your server actually stores',
  'site.docs.selfhost.s10p1': 'Every change is one **encrypted operation record**: the client derives a key from the user\'s passphrase (Argon2id) and encrypts the payload with AES-GCM before upload. The server **rejects plaintext outright**, so the database contains no "forgot to encrypt" plaintext payloads.',
  'site.docs.selfhost.s10p2': 'The surrounding metadata is plaintext: action types, entity types and ids, timestamps, the ordering of devices\' versions, ciphertext sizes. A sync protocol cannot work without these — and one of the points of self-hosting is precisely that they end up in **your** hands, not a third party\'s.',
  'site.docs.selfhost.s10p3': 'Corollary: the only things that can decrypt the data are the devices holding each account\'s encryption passphrase. The server cannot help a user who forgot the passphrase — the other side of "your backup is ciphertext".',
  'site.docs.selfhost.s11': 'The command-line host: using heyta without a browser',
  'site.docs.selfhost.s11p1': 'Besides the web and mobile, the repository ships a **command-line host**: it opens a real local database file and creates, lists and syncs tasks from a terminal. It speaks exactly the same sync protocol as every other end — pointed at the same server, it is just one more "device".',
  'site.docs.selfhost.s11i1': 'Configuration comes from flags or environment variables: `--db` the local database file (required), `--server` the sync server, `--token` the access token, `--password` the end-to-end encryption passphrase; uppercase environment variables (`HEYTA_DB` / `HEYTA_SERVER_URL` / `HEYTA_TOKEN` / `HEYTA_PASSWORD`) work too.',
  'site.docs.selfhost.s11i2': 'Common commands: `add` to create a task, `list` / `rename` / `complete` / `reopen` to manage them, `projects` / `tags` for lists and tags, `sync` for one sync round, `pending` for the pending-upload queue length.',
  'site.docs.selfhost.s11i3': '`export --out` exports everything (including deleted records and the full operation log); `import --in` restores — same rule as everywhere else: **into an empty library only**; a non-empty one is refused and nothing existing is touched.',
  'site.docs.selfhost.s11i4': 'One boundary to know: creating a task takes a single date flag (`--due`); repeat rules currently **cannot be set** from the command line (they are readable, not writable) — it is a tool for scripts and heavy terminal users, not an interface for managing repeats.',

  // Export and import
  'site.docs.transfer.title': 'Taking your data with you',
  'site.docs.transfer.seo.title': 'Taking your data with you — heyta',
  'site.docs.transfer.sum': 'All three ends can export; they cannot all import back — the difference worth knowing earliest.',
  'site.docs.transfer.s1': 'Export',
  'site.docs.transfer.s1p1': 'Web: Settings → "Export data". Mobile: Mine → "Export data", through the system share sheet. There is also a command-line entry that can export and import — see the command-line section in "Running your own sync server".',
  'site.docs.transfer.s1i1': 'The JSON is a **complete** backup: deleted records and the full operation log included, so you can check that nothing was left out. A backup that drops deleted records resurrects them on replay.',
  'site.docs.transfer.s1i2': 'There is also a Markdown copy meant for humans to read.',
  'site.docs.transfer.s1i3': 'The file carries counts you can reconcile against, so completeness is not a matter of feel.',
  'site.docs.transfer.s2': 'Import',
  'site.docs.transfer.s2p1': 'Today **only the web and the CLI have an import entry point**, and it **only restores into an empty library** — it is not a merge into data that already exists.',
  'site.docs.transfer.s2w1': '**Mobile has no import entry point.** A backup you took on your phone genuinely cannot be restored on that phone — use the web or the command line.',
  'site.docs.transfer.s3': 'This is not just "backups"',
  'site.docs.transfer.s3p1': 'Export and import are also how you move your data from one server to another, and the only recovery route after losing a passphrase (see the article above). It is part of the self-hosting story, not an optional extra.',
  'site.docs.transfer.s4': 'Two routes: syncing versus moving files',
  'site.docs.transfer.s4p1': 'A new device or a new browser — the cheapest route is **not** an import. Point the client at the same server, get back into the same account, and the history comes down on its own; you do not need a backup file in your hand.',
  'site.docs.transfer.s4p2': 'Export and import are the other route, for when the service is not there for you: moving off a self-hosted server, shutting one down, keeping a copy only you hold. The two routes give different results — syncing brings back the whole history, importing brings back the state at the moment of export.',
  'site.docs.transfer.s5': 'Why it only restores into an empty library',
  'site.docs.transfer.s5p1': 'This is a refusal, not unfinished work. Merging into data that already exists means the same thing may have changed on both sides, and the app has no reliable grounds for deciding which side to trust — all it could do is compare "which change is later", and that is how data gets lost, not how it gets merged.',
  'site.docs.transfer.s5p2': 'So the rule you meet is hard: the target has to be empty. Before writing anything, the import reads the local log to decide whether that counts as empty, and when it says no, your existing data stays exactly as it was.',
  'site.docs.transfer.s5w1': '"Empty" means **this device has no operation log yet**, not "the app is freshly installed". A device that has already synced does have history, and an import there is refused.',
  'site.docs.transfer.s6': 'What to check after a restore',
  'site.docs.transfer.s6p1': 'The file carries its own counts, and the import validates before it writes: not a heyta export, an unrecognised format version, counts that disagree with themselves — any of those rejects the whole document. It never imports "as much as it can".',
  'site.docs.transfer.s6p2': 'Then reconcile against the counts from the export and look through the interface: lists, tags, the trash. Deleted entries should still be visible in the trash — inside a backup they are content, not noise to tidy away.',
  'site.docs.transfer.s6i1': 'This JSON is not a sync channel: it stands for the one device that exported it. To bring the other devices in line, use sync.',

  // First run
  'site.docs.first-run.title': 'Your first steps after installing',
  'site.docs.first-run.seo.title': 'Your first steps after installing — heyta',
  'site.docs.first-run.sum': 'You can use it without an account; syncing is a door you open yourself; and those switches in the sidebar belong to this device only.',
  'site.docs.first-run.s1': 'One: no account needed to use it',
  'site.docs.first-run.s1p1': 'Open heyta and fill in nothing — you can still create tasks. The data is written into **this device\'s own database**: the browser\'s local storage on the web, the app\'s own data directory on mobile.',
  'site.docs.first-run.s1p2': 'The mobile first screen offers **two exits of equal weight** — "Sign up / Sign in" and "Use offline first". It does not insist on an email address.',
  'site.docs.first-run.s1p3': '⚠️ Offline is also not a temporary downgrade: with no account, switching devices or clearing browser data gives you **a different dataset**, and the two will never merge on their own.',
  'site.docs.first-run.s2': 'Two: syncing is a door you open',
  'site.docs.first-run.s2p1': 'A device only starts handing out changes once you connect it to a server address and an account. Before that the sync entry says "not configured yet".',
  'site.docs.first-run.s2p2': 'heyta has no email-plus-password path: you register and sign in either with a **passkey** (face / fingerprint / system PIN) or by clicking a **one-time link in an email**.',
  'site.docs.first-run.s2p3': 'Once connected, changes from your other device appear here by themselves. **When your own writes go up differs per end**, though — the web waits for the next sync, mobile pushes them out with the write. The details are in "How syncing works".',
  'site.docs.first-run.s2p4': 'The sign-up / sign-in panel opens **inside the sync settings**, not as its own button in the navigation — the server address authentication needs is the one you type there. Kept apart, they would allow "signed in against A, token stored for B".',
  'site.docs.first-run.s3': 'Three: those sidebar switches are per device',
  'site.docs.first-run.s3p1': 'Calendar, quadrants, habits, timeline, focus, progress and notes can be turned off at any time. "Off" means it does not enter the page — not that it sits there greyed out.',
  'site.docs.first-run.s3p2': '⚠️ This is a **local preference of this device**: it is not written to the operation log and does not sync. Turning focus off on your phone leaves it on on your computer.',
  'site.docs.first-run.s3i1': 'On by default: calendar, quadrants, habits, timeline.',
  'site.docs.first-run.s3i2': 'Off by default: focus, progress, notes — a first launch does not show you the entire interface.',
  'site.docs.first-run.s3i3': 'Only tasks and search cannot be turned off.',
  'site.docs.first-run.s4': 'Four: what the first screen is for',
  'site.docs.first-run.s4p1': 'On the web you land in the task view with the input box above the list: type a title, press Enter, one task is in the local database.',
  'site.docs.first-run.s4p2': 'To add a due time, priority, list, tags or a repeat rule, expand those entries on the task row; on mobile you do the same in the task detail sheet.',
  'site.docs.first-run.s4p3': 'There is no guided tour and no "welcome" animation — the first screen is the working interface. That is precisely why this page exists: a few differences are invisible in the interface, so someone has to tell you.',
  'site.docs.first-run.fig.tasks': 'The web first screen: the input sits above the list, and the sidebar already holds Inbox, Today and Completed',
  'site.docs.first-run.fig.tasks.alt': 'Web task view with an empty inbox and the add-task input above the list',

  // Core concepts
  'site.docs.concepts.title': 'Task, list, tag, habit: four words, four things',
  'site.docs.concepts.seo.title': 'Task, list, tag and habit — what each means — heyta',
  'site.docs.concepts.sum': 'Behind those four words in the interface are four kinds of data, plus one common misconception: a view is not a fifth kind.',
  'site.docs.concepts.s1': 'Task: what sits on one record',
  'site.docs.concepts.s1p1': 'A task carries a title, a note, a due time, a priority, an "important" flag, its list, its tags, and a repeat rule.',
  'site.docs.concepts.s1p2': 'Priority has four levels: none / low / medium / high. It and "important" are **two separate fields** — the quadrants use "important × urgent", and only borrow a high priority when you never marked importance yourself.',
  'site.docs.concepts.s1p3': 'The inbox is not a list — it is the name shown for **tasks that have no list yet**. So "move a task into the inbox" does not exist in the data; only "move it out of a list" does.',
  'site.docs.concepts.s2': 'List: exactly one level deep',
  'site.docs.concepts.s2p1': 'A list may have a parent list acting as a folder. ⚠️ **Only that one level** — it is not an infinitely nested tree, and that is a deliberate limit, not unfinished work.',
  'site.docs.concepts.s2p2': 'A task belongs to **one** list (or none). So "this task appears in two lists at once" is not a thing; the dimension allowed to overlap is tags.',
  'site.docs.concepts.s3': 'Tag: several cross-cuttings on one task',
  'site.docs.concepts.s3p1': 'Tags and tasks are **many-to-many**: a task can carry several tags, and one tag can appear on any number of tasks.',
  'site.docs.concepts.s3p2': 'Editing tags is a whole-set overwrite: the write carries the **complete set** of tags this task should end up with, not an incremental "add one" or "remove one" — dangling tag ids are rejected at write time.',
  'site.docs.concepts.s3p3': 'Tags decide neither ordering nor colour hierarchy. They are a cross-cutting axis for filtering; the list is the belonging.',
  'site.docs.concepts.s4': 'Habit: the definition and the check-in are separate',
  'site.docs.concepts.s4p1': 'A habit is the set of **goal, unit, frequency and streak rules**; each day\'s entry is a separate piece of data (which day, what value, an optional note).',
  'site.docs.concepts.s4p2': 'The streak **does not live** in the habit record — it is **computed** from the check-ins. So adding or removing a day moves the streak, instead of "a number once recorded and never touched again".',
  'site.docs.concepts.s4p3': 'That is also the basis of the progress statistics that only compare you with your own past: the statistics are a derived result, not a second stored truth.',
  'site.docs.concepts.fig.habits': 'The habits board: the add field sits at the top and takes one name at a time',
  'site.docs.concepts.fig.habits.alt': 'Web habits panel with the new-habit input at the top and an empty state below',
  'site.docs.concepts.s5': 'A view is not a fifth kind of data',
  'site.docs.concepts.s5p1': 'Quadrants, calendar, timeline and today are all **ways of displaying** task fields, computed from them. There is no "one record in the quadrants" anywhere in the data.',
  'site.docs.concepts.s5p2': 'This decision blocks a classic bug: the view and the task each storing a copy, then disagreeing. Here they cannot disagree, because there is one copy.',
  'site.docs.concepts.s5p3': 'One practical consequence: dragging a task from one quadrant to another changes its **importance and due-time fields**, it does not move it into a container called a quadrant.',

  // Repeating tasks
  'site.docs.repeat.title': 'Repeating tasks: what "next time" really means',
  'site.docs.repeat.seo.title': 'Repeating tasks: how the next due date is computed — heyta',
  'site.docs.repeat.sum': 'The advance is measured from the original due date, not from when you ticked it, and the rule uses the standard format calendar products share — those two facts explain almost everything that looks like a bug.',
  'site.docs.repeat.s1': 'The rule is a shared standard format',
  'site.docs.repeat.s1p1': 'A repeat rule uses the **RRULE** text format common in calendar software — the same thing you can type straight into the "custom rule" field in the interface — plus a record of which day the rule counts from. It is not a private "every N days" dialect of ours.',
  'site.docs.repeat.s1p2': 'The interface gives you common presets (none / daily / weekly / weekdays / monthly) and lets you **write a custom rule directly**. It is validated before being written: an illegal rule errors on the spot rather than saving silently.',
  'site.docs.repeat.s1p3': 'Why standard is worth it: the same rule stays readable to other calendar products and exportable to other formats. A private dialect cannot do that.',
  'site.docs.repeat.s2': 'The advance is measured from the original due date',
  'site.docs.repeat.s2p1': 'Ticking off a repeating task moves **the same task\'s** due time forward by one period, starting from **its current due date** — not from the moment you ticked it.',
  'site.docs.repeat.s2p2': 'Two non-obvious consequences: if the task is already several days overdue, one tick only moves it to "the next overdue slot" and you may need several ticks to get back into the future; and the **time of day is not preserved** across the move.',
  'site.docs.repeat.s2p3': '⚠️ It is also not a "generate a new task each day" model: after the due date it is still the same record being updated, so its history, note and list stay continuous.',
  'site.docs.repeat.s2p4': 'The reason is that a repeat rule is evaluated over **calendar dates**, not instants, and is bound to no time zone at all. Binding a time zone would shift everything by a day across daylight-saving or midnight boundaries — "every Monday" would become a Tuesday in some weeks. The cost is that "at what time it is due" does not enter that algorithm, so only the date is carried forward.',
  'site.docs.repeat.s3': 'When the rule runs out',
  'site.docs.repeat.s3p1': 'If the rule carries `UNTIL` or `COUNT` and it is exhausted, that tick is an **ordinary completion** — nothing moves forward any more.',
  'site.docs.repeat.s3p2': 'The next occurrence is always **strictly later** than the current due time (the "same slot today" is excluded): a daily task due today lands on tomorrow once you tick it.',
  'site.docs.repeat.s4': 'Which ends can set it',
  'site.docs.repeat.s4p1': 'Both the web and mobile can: the two ends show the same presets plus a custom RRULE field and write the same field, so a rule set on one end is readable and editable on the other.',
  'site.docs.repeat.s4w1': '⚠️ Setting a repeat rule on a task with no due time makes the app supply one — without an anchor for "due at what moment", a rule like "every two weeks" has nothing to compute from.',

  // Views
  'site.docs.views.title': 'Quadrants, calendar, timeline, search: four questions',
  'site.docs.views.seo.title': 'Quadrants, calendar, timeline and search — heyta',
  'site.docs.views.sum': 'Four views look like four features but answer four different questions — and their platform differences are stated plainly here.',
  'site.docs.views.s1': 'Quadrants answer "which one now"',
  'site.docs.views.s1p1': 'Two axes: **importance** (its own field on the task) and **urgency** (has a due time, falls within two days, or is already overdue). Completed and deleted tasks do not enter the grid.',
  'site.docs.views.s1p2': 'Dragging a task from one cell to another changes its importance and due time — afterwards it is still the same task with the same history, not a copy.',
  'site.docs.views.s1p3': '⚠️ The urgency window is **two days**. That is a product decision, not an industry standard: tomorrow\'s task is in the grid, next week\'s is not.',
  'site.docs.views.fig.quadrant': 'The four quadrants: each cell is labelled with its importance and urgency combination, and an empty one tells you to drag a task in',
  'site.docs.views.fig.quadrant.alt': 'Web quadrant view showing the four quadrant cards and the drag-a-task-here hint',
  'site.docs.views.s2': 'Calendar answers "which days have anything"',
  'site.docs.views.s2p1': 'The calendar lays out tasks with due times, day by day. The web and mobile use **the same board** (the same component) rather than two drawings that drift apart.',
  'site.docs.views.s2p2': 'A repeating task appears as **its own next occurrence** — the calendar does not spread a year of copies in front of you, and no such copies exist in the data either.',
  'site.docs.views.s3': 'Timeline answers "will it fit in the next few days"',
  'site.docs.views.s3p1': 'The timeline is a **scheduling view**: tasks are laid along one axis by their estimated duration, so you can see whether the next few days actually open up. It reads tasks and estimates, not "what you already did" — looking back over completed work is what Progress is for.',
  'site.docs.views.s3p2': 'If the task note contains a checklist, each item is scheduled on its own; if it does not, the whole task counts as one item — otherwise that task would not appear on the timeline at all, and it is exactly the kind that most needs a duration in front of you.',
  'site.docs.views.s3p3': '⚠️ When the estimate belongs to the whole task but the checklist has several items, **it does not split the time proportionally**: the interface says plainly that the estimate cannot be attributed, and the child items are scheduled at a default length. Each bar states where its duration came from — "≈ 1 h" is one you typed, "≈ 1 h · AI estimate" is not, and "not estimated" means nobody ever estimated it.',
  'site.docs.views.fig.timeline': 'With nothing to schedule, the timeline puts the next step — create a task, then write its checklist — right on the screen',
  'site.docs.views.fig.timeline.alt': 'Web timeline empty state, with a centered hint about creating a task and its checklist first',
  'site.docs.views.s4': 'Search answers "what was that thing called"',
  'site.docs.views.s4p1': 'The web has a cross-content search panel covering tasks and notes. ⚠️ On mobile it is currently a **filter box inside the task list** — both ends call it search, but the reachable scope differs.',
  'site.docs.views.s4p2': 'End-to-end encryption does not block search: what is searched is **the content decrypted locally on this device**. The server never had the plaintext and never gets to answer the query.',
  'site.docs.views.s4p3': 'Deleted content is not searchable, but it is still there in your export — see "Trash and why permanent delete does not delete".',
  'site.docs.views.s5': 'A module you switched off is genuinely off the page',
  'site.docs.views.s5p1': 'Calendar, quadrants and timeline can be switched off in Settings; once off they **do not enter the DOM** rather than sitting there disabled.',
  'site.docs.views.s5p2': 'That switch belongs to this device and does not sync — so "why has my quadrants view disappeared" is a device-local question, not a sync question.',

  // Reminders
  'site.docs.reminders.title': 'Reminders and notifications: when they fire, and when they do not',
  'site.docs.reminders.seo.title': 'Reminders and notifications: when they actually fire — heyta',
  'site.docs.reminders.sum': 'A reminder is its own record, but delivery is limited by the platform — this page states the conditions fully rather than leaving you a silent expectation.',
  'site.docs.reminders.s1': 'A reminder is not a flag on the task',
  'site.docs.reminders.s1p1': 'Each reminder is **its own record**: which task it belongs to, when it fires, an optional offset, plus states for fired, snoozed-until, and dismissed.',
  'site.docs.reminders.s1p2': 'A task may have at most **5** live reminders. Beyond that the write is blocked and explicitly rejected, not silently swallowed.',
  'site.docs.reminders.s1p3': 'It is a separate record rather than a pile of fields because it gets changed on its own: snoozing, dismissing, and re-queueing with a repeat rule should none of them rewrite the task itself.',
  'site.docs.reminders.s2': 'When it fires — and why sometimes it will not',
  'site.docs.reminders.s2p1': 'Web: **only while the app is open**. The browser raises the notification when the time arrives, provided you granted the permission in the interface first — that grant has to come from a click of yours, which is the browser\'s rule, not ours.',
  'site.docs.reminders.s2p2': '⚠️ Close the page and nothing fires: the trigger times were computed locally in advance, but **nobody is reading them**. That limit is written into the code comments as a known boundary, not a temporary state.',
  'site.docs.reminders.s2p3': 'Mobile: there is **no system local notification wired up**, so nothing pops outside the app. On a phone, due times and reminders are currently "visible in the interface", not "will sound".',
  'site.docs.reminders.s2p4': 'Time has bounds: a trigger may sit at most **one year** out; snoozing defaults to **10 minutes** and caps at **7 days**, and past the cap it is **clamped to the cap with the real value shown** instead of letting your click fail. Landing slightly before now is allowed — a one-minute window, because milliseconds pass between computing the moment and writing it down.',
  'site.docs.reminders.s2i1': 'Three conditions to hear anything: the time arrived, the app is open, you already granted permission — miss one and it stays quiet.',
  'site.docs.reminders.s2i2': 'Muting and snoozing are different roads: the first stops that one reminder from popping, the second moves its trigger time wholesale.',
  'site.docs.reminders.s2i3': 'The only way to get background delivery today is to build a server-side push channel of your own — this version has none, and does not pretend to.',
  'site.docs.reminders.s3': 'Reminders on repeating tasks move with it',
  'site.docs.reminders.s3p1': 'Ticking a repeating task re-queues the reminders **computed from an offset** onto the next occurrence; a reminder pinned to an absolute moment stays where it was.',
  'site.docs.reminders.s3p2': 'So "daily 9am, 10 minutes before" advances by itself, while "March 5 at 14:00" does not — it has no idea which task occurrence it hangs off.',
  'site.docs.reminders.s3p3': 'Advancing **re-queues the same reminder** rather than creating a new one. Creating one per cycle would leave a never-expiring reminder behind each time, and a few cycles would run into the "5 per task" cap.',
  'site.docs.reminders.s4': 'The bell in the interface is not a reminder',
  'site.docs.reminders.s4p1': 'The bell is your **account inbox**: server-side account-level notices (subscriptions, quota) and referral progress land in it.',
  'site.docs.reminders.s4p2': 'It carries "what happened to this account", not "your task is due" — task content never appears on that channel, and the server could not decode it anyway.',

  // Trash
  'site.docs.trash.title': 'Trash, and why "permanent delete" deletes nothing',
  'site.docs.trash.seo.title': 'Trash and permanent delete — why history survives — heyta',
  'site.docs.trash.sum': 'Both actions are in the interface, but the second one removes visibility, not the record — and that is a deliberate sync-protocol decision.',
  'site.docs.trash.s1': 'The trash holds tasks only',
  'site.docs.trash.s1p1': 'Lists, tags and notes do not go to the trash today — once deleted they have no restore entry. That is not an oversight: their delete semantics differ from a task\'s.',
  'site.docs.trash.s1p2': 'The trash is not a separate bin and there is no second table: it is exactly the tasks that are "deleted and not yet permanently deleted", **most recently deleted first**.',
  'site.docs.trash.s1i1': 'Web: "Trash" in the left sidebar, always visible.',
  'site.docs.trash.s1i2': 'Mobile: a trash entry inside the Mine screen.',
  'site.docs.trash.s1i3': 'Both actions are on the same board: restore, and delete permanently — the latter asks you to confirm twice.',
  'site.docs.trash.fig.trash': 'The trash states plainly that it holds tasks only — and, when empty, where the entries will come from',
  'site.docs.trash.fig.trash.alt': 'Web trash panel with its explanatory line and empty state',
  'site.docs.trash.s2': 'What restore changes',
  'site.docs.trash.s2p1': 'Restore = clearing the task\'s deletion flag back to empty, written as an ordinary update. It is not "copying something back from a backup": the same task with the same history keeps growing.',
  'site.docs.trash.s2p2': 'An entry you have already permanently deleted stops appearing in the trash and so cannot be restored — the interface treats the two separately, by design rather than as a missing step.',
  'site.docs.trash.s2p3': 'Even if you bypass the interface and call it directly, restoring a permanently deleted task is **rejected on the spot**. That is a deliberate point of no return, not a step that has not been built yet.',
  'site.docs.trash.s3': 'Why "permanent delete" does not really delete',
  'site.docs.trash.s3p1': 'It does one thing: stamp the record with a "purged" marker. The deletion flag itself is **kept on purpose**.',
  'site.docs.trash.s3p2': 'The reason is that syncing replays an **operation log**, not a snapshot diff. If another device is still offline and you clear the flag, its copy **resurrects** the task on the next sync. Keeping the deletion flag is what makes "I decided I do not want this" consistent across every device.',
  'site.docs.trash.s3p3': 'So the accurate meaning of "permanent delete" is: **removed from every place I can see, and that decision now holds across future syncs**. It is not cryptographic erasure and it does not reclaim disk space.',
  'site.docs.trash.s3w1': '⚠️ In that JSON backup the permanently deleted task **is still there**: exports include tombstones, because an export has to be replayable in full.',
  'site.docs.trash.s4': 'What that means for your backups',
  'site.docs.trash.s4p1': 'The exported JSON is the complete log, including deleted and purge-marked records, so you can verify that nothing was left out; the Markdown copy meant for human reading filters those out.',
  'site.docs.trash.s4p2': 'Conversely: treating a backup as proof that "I deleted it clean" is wrong. It is a **ledger**, and a ledger keeps the reversal entries too.',
  'site.docs.trash.s4p3': 'The marker is **harmless by construction**: even if another device still runs an older build that does not know it, the marker just passes through as a piece of information it does not recognise — a "permanent delete" on one device cannot break another.',

  // Privacy
  'site.docs.privacy.title': 'Every route by which data leaves this device',
  'site.docs.privacy.seo.title': 'Every route by which data leaves this device — heyta',
  'site.docs.privacy.sum': 'There are four, each of which you open yourself, and no fifth. We checked that sentence against the code before publishing it.',
  'site.docs.privacy.s1': 'First, what "local-first" actually guarantees',
  'site.docs.privacy.s1p1': 'Writes land locally first. That is an **order**, not a guarantee that data never leaves. What decides where it goes is whether you opened the routes below.',
  'site.docs.privacy.s1p2': 'The four are: sync upload, the local API / MCP, outbound AI, and email. Beyond those the product has **no analytics, no crash reporting, no third-party scripts** — one click of yours does not get sent to anyone else "because statistics are handy".',
  'site.docs.privacy.s2': 'One: sync upload',
  'site.docs.privacy.s2p1': 'With sync on, changes are uploaded **encrypted** to the server you configured. The ciphertext is only the payload part.',
  'site.docs.privacy.s2p2': 'What the server can see is the surrounding information: each operation\'s action type, which kind of entry was touched, when it happened, how the devices\' versions order against each other, and how large the ciphertext is. It knows "this device touched this kind of thing at this time, at this size" — not the content.',
  'site.docs.privacy.s2p3': 'We do not advertise "the server sees nothing": **it cannot see the content, it can see the shape.** This holds equally when you self-host — except then the party seeing the shape is you.',
  'site.docs.privacy.s3': 'Two: the local API / MCP',
  'site.docs.privacy.s3p1': 'This is a door opened for **other programs on the same machine** (including MCP clients): off by default, **each tool individually off by default**, listening only on the loopback address.',
  'site.docs.privacy.s3p2': 'Protected entries are **listable but not readable** here — the tool answers with an explicit "cannot read" rather than a blank value that looks normal.',
  'site.docs.privacy.s3p3': 'Writes can only go through the app\'s own write entry and cannot skip user confirmation; this route is structurally incapable of producing an operation record.',
  'site.docs.privacy.s4': 'Three: outbound AI',
  'site.docs.privacy.s4p1': 'AI is an **input method**, not a business rule: it only produces suggestions, and you confirm before anything lands. That is not a verbal promise — that path cannot construct a write at the type level.',
  'site.docs.privacy.s4p2': '🔴 If you use hosted / cloud AI, the content on that route is **not end-to-end encrypted**: your sync server still cannot decode it, but the copy you authorised does go to the model provider in plaintext. All three gates (master switch, whether leaving the device is allowed at all, per-feature consent) are in Settings.',
  'site.docs.privacy.s4p3': 'If your local endpoint fails, nothing is silently sent to the cloud instead: that requires fresh consent, and without it not one request is made.',
  'site.docs.privacy.s5': 'Four: email',
  'site.docs.privacy.s5p1': 'The product sends three kinds of mail only: address verification, passkey recovery, sign-in link. No marketing mail, no "we recommend some articles for you".',
  'site.docs.privacy.s5p2': 'Mail is sent by the server you configure (ours when hosted) and it is a **required** part of self-hosting — without mail you cannot register at all, because heyta has no email-plus-password path.',
  'site.docs.privacy.s6': 'Open source is not permission to stop checking',
  'site.docs.privacy.s6p1': 'heyta is MIT licensed with its code public. Each of the four routes above has **its own switch, off by default**: syncing only opens once you configure a server yourself, outbound AI has a master switch plus per-feature grants, and the local interface is switched off entirely by default. This page\'s job is to tell you **who flips which switch**, not to vouch for them.',

  // Loss
  'site.docs.loss.title': 'Three things you can lose: which one comes back',
  'site.docs.loss.seo.title': 'Losing a device, a passkey, or the passphrase — heyta',
  'site.docs.loss.sum': 'A device, a passkey, the end-to-end encryption passphrase — the three have completely different consequences, and knowing in advance is cheaper than finding out after.',
  'site.docs.loss.s1': 'One: a device',
  'site.docs.loss.s1p1': 'Sign in on a new device and the data is **replayed** back from the server — that is exactly what syncing is for. "Local-first" never meant "only on this one machine".',
  'site.docs.loss.s1p2': 'But a device that never had sync on holds its data only in that machine\'s local database. If it is gone, it is gone — there is no server-side backup anywhere on that route.',
  'site.docs.loss.s2': 'Two: a passkey (recoverable)',
  'site.docs.loss.s2p1': 'Tapping "Lost your passkey?" inside the app sends a recovery email; the page it links to is rendered by the server, and from there you can register a new passkey.',
  'site.docs.loss.s2p2': 'The condition is **that you can still receive mail at the address**. Proving the mailbox is yours is enough — the old credential does not have to still be present.',
  'site.docs.loss.s2p3': 'One more thing you can do: in Settings, list **your own** passkeys and rename or delete them. That is the only credential management entry there is.',
  'site.docs.loss.s2w1': '⚠️ There is **no** "sign out of every device" button in the interface and no "revoke all sessions" action. To pull access back from an old device, delete each key you do not recognise one at a time — while you can still sign in.',
  'site.docs.loss.s3': 'Three: the end-to-end passphrase (not recoverable)',
  'site.docs.loss.s3p1': 'That passphrase is the key used to encrypt and decrypt outside the server. It is **not stored on the server**, so the server has no ability to "reset it for you" — not unwillingness: building that would mean the encryption does not exist.',
  'site.docs.loss.s3p2': 'Forgetting it is not losing sign-in: you may still get in, still see the plaintext fields, but the encrypted content stays undecryptable and the interface will tell you honestly that it cannot open it.',
  'site.docs.loss.s3p3': 'The only self-rescue is **export**: take a complete JSON while you can still decrypt. Restore only works into an empty library, so this is a server-migration and disaster tool, not an everyday "backup" button.',
  'site.docs.loss.s4': 'So the sensible order is this',
  'site.docs.loss.s4p1': 'Write the passphrase somewhere you will **not lose along with it**. Keeping it in a note on the same device is hanging the key on the doorknob.',
  'site.docs.loss.s4p2': 'Before turning sync on, confirm you can sign in and the mailbox still receives. After it is on, export now and then — and actually verify once that it restores. An unverified backup is not a backup.',
  'site.docs.loss.s4p3': 'None of this is scare copy: the benefit of end-to-end encryption (the server cannot see your content) and its cost (nobody can recover your password for you) are two sides of one decision. Want one side, manage the other.',

  // ── Changelog ──
  'site.changelog.seo.title': 'What\'s new — heyta',
  'site.changelog.seo.description': 'What changed in heyta, dated, with the evidence and with the things we explicitly decided not to do.',
  'site.changelog.title': 'What\'s new',
  'site.changelog.lede': 'Newest first, and only things that **actually happened**. Items we decided against are in here too — a roadmap that only grows is not worth trusting.',
  'site.changelog.20261005.title': 'Notes and reminders work on both hosts',
  'site.changelog.20261005.body': 'Notes and reminders — two entities that had a data model but no entry point — gained their domain rules, an action layer, and real entry points in **both hosts**. The same pass took the "modeled but never called" reachability gate from a long-standing red to fully green; that gate exists precisely to catch "all the parts are there, the last metre is not wired".',
  'site.changelog.20261002.title': 'Task reminders, from data model to action layer',
  'site.changelog.20261002.body': 'Reminders landed as an **entity of their own** rather than an array field on a task: scheduling rules, lead times, repeat roll-forward and snooze live in the domain layer, with create/update/delete in the action layer. Before this, reminders were a single line on the roadmap.',
  'site.changelog.20260928.title': 'The site and the app became one product',
  'site.changelog.20260928.body': 'Six new pages (features, platforms, pricing, help, changelog, sign-in), and the navigation, footer and sitemap are now derived from a single page registry — so a new page can no longer be added without appearing in the navigation. The app gained a help/about entry, making the site and the app reachable from each other for the first time.',
  'site.changelog.20260928b.title': 'You can write task notes yourself',
  'site.changelog.20260928b.body': 'Until now only the AI wrote notes (the checklists it breaks a task into, the durations it estimates) — you could not write one. Both the web task row and the mobile detail panel can now write them, and they land in the operation log and sync across devices.',
  'site.changelog.20260928c.title': '"Completed" finally has a way in',
  'site.changelog.20260928c.body': 'The filter branch, the list logic, the page title and the empty state all existed — but nothing could switch the filter, so completed tasks were invisible on the web. A same-shaped bug went with it: clicking a sidebar filter from another view did nothing at all.',
  'site.changelog.20260927.title': 'The first stretch of the user journey closed',
  'site.changelog.20260927.body': 'The landing page got a way into the app, the web client got sign-up and sign-in, the app was deployed for the first time, and data export shipped. The same batch closed the trash view, the mobile growth screen, and a server-side brand drift.',
  'site.changelog.20260926.title': 'The four quadrants stopped being a promise',
  'site.changelog.20260926.body': 'The landing page advertised the four quadrants as a pillar while the app did not have them — the worst kind of mismatch, because the promise is on the page and the feature is not in the product.',
  'site.changelog.note': 'Older updates are archived.',

  // ── Sign in ──
  'site.signin.seo.title': 'Sign in — heyta',
  'site.signin.seo.description': 'Sign in to heyta with a passkey or an emailed sign-in link.',
  'site.signin.title': 'Sign in',
  'site.signin.lede': 'There are exactly two ways in, and there is no password.',
  'site.signin.method.passkey.title': 'Passkey (recommended)',
  'site.signin.method.passkey.body': 'Sign in with the device itself — face, fingerprint or system PIN. The key never leaves your device, and there is no password to be reused or leaked.',
  'site.signin.method.magic.title': 'Emailed sign-in link',
  'site.signin.method.magic.body': 'Enter an address, get a one-time link, click it and you are in. Handy on a device whose passkey is not set up yet.',
  'site.signin.noPassword': '⚠️ Why there is no "email + password": a credential that can be stuffed, phished, and needs a hash stored server-side is the one weak link in a product whose server cannot read your content.',
  // R2: `site.signin.cta` was here with zero source references; the page's CTAs
  // come from `site.signin.recover.link` and the nav's sign-in entry.
  'site.signin.recover.title': 'Lost your passkey?',
  'site.signin.recover.body': 'Inside the app, "Lost your passkey?" emails a recovery link where you can register a new one.',
  'site.signin.why.title': 'Why signing in happens in the app, not on this page',
  'site.signin.why.body': 'A passkey must be bound to **one specific domain**, and the server address used for signing in is the very one in the app’s sync settings. Copying the auth UI onto this page would recreate "sign in against server A while the token is stored for B" — so this page is a doorway, not a second login box.',

  'web.about.title': 'Help & about',
  'web.about.lead': 'The help centre, the changelog and pricing all live on the website — they need to be indexable and shareable on their own, so there is only one copy of each.',
  'web.about.help.label': 'Help centre',
  'web.about.help.hint': 'Creating a task, syncing, forgetting your passphrase, taking your data with you',
  'web.about.changelog.label': 'Changelog',
  'web.about.changelog.hint': 'What changed recently, including the things we decided not to build',
  'web.about.pricing.label': 'Pricing & subscription',
  'web.about.pricing.hint': 'Self-hosting for free vs. our hosted service, and the only two things that cost money',
  'web.about.updateNote': 'There is no "check for updates" button here: heyta is a PWA and updates are decided by the browser in the background — a button that does nothing is worse than no button.',
  'web.sync.help.link': 'View help',
  'site.signin.recover.link': 'Recover your passkey in the app',

  'site.og.imageAlt': 'heyta share card: local-first task management where your data lands on your own device first; end-to-end encrypted sync, self-hostable, no feature gating.',
  // 🔴 R16：the card is **generated per language** (og-card.png / og-card-en.png),
  //    so these are the words actually printed on it — not a description for alt.
  'site.og.card.title1': 'Local-first task management',
  'site.og.card.title2': 'Your data lands on your own device first',
  'site.og.card.lede': 'End-to-end encrypted sync · Self-hostable · No feature gating',

  // ═══════════════════════════════════════════════════════════════════════
  // M3 第四刀（sync）收尾 —— entity names / conflict reasons shared by both
  // shells (append-only block; zh-CN.ts is the source of the keys).
  // Replaces both `ConflictDialog.tsx`'s and `conflict-view.ts`'s local tables.
  // ═══════════════════════════════════════════════════════════════════════

  'common.entity.TASK': 'Task',
  'common.entity.PROJECT': 'List',
  'common.entity.TAG': 'Tag',
  'common.entity.NOTE': 'Note',
  'common.entity.TASK_REPEAT_CFG': 'Repeat rule',
  'common.entity.REMINDER': 'Reminder',
  'common.entity.HABIT': 'Habit',
  'common.entity.HABIT_LOG': 'Check-in record',
  'common.entity.FOCUS_SESSION': 'Focus session',
  'common.entity.AI_FEEDBACK': 'AI usage record',
  'common.entity.PREFERENCE_CORRECTION': 'Preference correction',
  'common.entity.GLOBAL_CONFIG': 'Global settings',
  'common.entity.MIGRATION': 'Data migration',
  'common.entity.RECOVERY': 'Disaster recovery',
  'common.entity.ALL': 'All data',

  'common.conflict.reason.concurrent': 'Two devices changed it without knowing about each other',
  'common.conflict.reason.superseded': 'This change was based on a version that is no longer the latest',
  'common.conflict.reason.timestampOrTie': 'The two changes are too close in time to order',
  'common.conflict.reason.localTimestamp': 'This device change is newer',
  'common.conflict.reason.remoteDeleteWins': 'The other device deleted it',
  'common.conflict.reason.localDeleteWins': 'This device deleted it',
  'common.conflict.reason.remoteArchive': 'The other device archived it',
  'common.conflict.reason.localArchive': 'This device archived it',
  'common.conflict.reason.fallback': 'Both sides made different changes to the same thing',

  // Reminders (B1-1 UI layer; shared by web and mobile).
  // 🔴 `reminder.offset.*` must stay 1:1 and in order with
  //    `REMINDER_OFFSET_PRESETS_MS` — the shared component reads
  //    `labels.offsets[i]` for `presets[i]`.
  'reminder.title': 'Reminders',
  'reminder.empty': 'No reminders yet',
  'reminder.add': 'Add reminder',
  'reminder.offset.0': 'At due time',
  'reminder.offset.5m': '5 minutes before',
  'reminder.offset.15m': '15 minutes before',
  'reminder.offset.30m': '30 minutes before',
  'reminder.offset.1h': '1 hour before',
  'reminder.offset.1d': '1 day before',
  // The absolute-time entry shown when a task has no due date. The `1h` in the
  // key is part of the contract: the host must create the reminder at now + 1h.
  'reminder.absolute.1h': 'Remind me in 1 hour',
  'reminder.snooze': 'Snooze',
  'reminder.dismiss': 'Dismiss',
  'reminder.remove': 'Delete reminder',
  'reminder.phase.scheduled': 'Scheduled',
  'reminder.phase.snoozed': 'Snoozed',
  'reminder.phase.due': 'Due now',
  'reminder.phase.fired': 'Sent',
  'reminder.phase.dismissed': 'Dismissed',
  'reminder.hint.noDueDate': 'This task has no due date, so only an absolute time can be set',
  'reminder.a11y.list': 'Reminders for "{title}"',
  'reminder.a11y.remove': 'Delete the reminder at {when}',
  'reminder.a11y.snooze': 'Snooze the reminder at {when} by 10 minutes',
  'reminder.a11y.dismiss': 'Dismiss the reminder at {when}',

  // Notes (the UI layer of hallucination #12). Distinct from a task's own
  // note field, so the copy deliberately avoids the word "note" alone.
  'notes.title': 'Sticky notes',
  'notes.empty': 'No sticky notes yet',
  'notes.empty.hint': 'Jot down what should not become a task',
  'notes.composer.placeholder': 'Write something…',
  'notes.add': 'Add note',
  'notes.pin': 'Pin to today',
  'notes.unpin': 'Unpin',
  'notes.remove': 'Delete note',
  'notes.badge.today': 'Today',
  'notes.a11y.edit': 'Edit the note "{excerpt}"',
  'notes.a11y.remove': 'Delete the note "{excerpt}"',
  'notes.a11y.pin': 'Pin the note "{excerpt}" to today',
  'notes.a11y.unpin': 'Unpin the note "{excerpt}"',
  'notes.error.empty': 'A note cannot be empty',

  // ── Admin console (ADR-0038) ─────────────────────────────────────────
  'web.admin.title': 'Admin',
  'web.admin.lead': 'Read-mostly: users, subscriptions, orders, coupons, invites.',
  'web.admin.tab.overview': 'Overview',
  'web.admin.tab.users': 'Users',
  'web.admin.tab.subscriptions': 'Subscriptions',
  'web.admin.tab.orders': 'Orders',
  'web.admin.tab.coupons': 'Coupons',
  'web.admin.tab.invites': 'Invites',
  'web.admin.loading': 'Loading…',
  'web.admin.retry': 'Retry',
  'web.admin.error.unconfigured': 'No server address is configured, so the admin console is unavailable.',
  'web.admin.error.no-token': 'You are not signed in, so the admin console is unavailable.',
  'web.admin.error.network': 'Cannot reach the server. Check your connection and retry.',
  'web.admin.error.unauthorized': 'Your session expired. Please sign in again.',
  'web.admin.error.forbidden': 'This account does not have admin access.',
  'web.admin.error.not-found': 'That item no longer exists.',
  'web.admin.error.invalid': 'The request was rejected as invalid.',
  'web.admin.error.server': 'The server failed. See the server logs for details.',
  'web.admin.overview.users.total': 'Users',
  'web.admin.overview.users.verified': 'Verified',
  'web.admin.overview.users.admins': 'Admins',
  'web.admin.overview.users.locked': 'Locked now',
  'web.admin.overview.subs.total': 'Subscriptions',
  'web.admin.overview.subs.active': 'Active',
  'web.admin.overview.orders.total': 'Orders',
  'web.admin.overview.orders.revenue': 'Paid amount',
  'web.admin.overview.coupons.total': 'Coupons',
  'web.admin.overview.coupons.enabled': 'Enabled',
  'web.admin.overview.coupons.used': 'Redeemed',
  'web.admin.overview.invites.codes': 'Invite codes',
  'web.admin.overview.invites.referrals': 'Referrals',
  'web.admin.overview.invites.activated': 'Activated',
  'web.admin.overview.byStatus': 'By status',
  'web.admin.overview.paidByCurrency': 'Paid amount (by currency)',
  'web.admin.users.search': 'Search by email',
  'web.admin.users.total': '{total} users',
  'web.admin.users.noneFound': 'No users match.',
  'web.admin.badge.admin': 'Admin',
  'web.admin.badge.locked': 'Locked',
  'web.admin.badge.unverified': 'Unverified',
  'web.admin.user.created': 'Joined',
  'web.admin.user.storage': 'Storage used',
  'web.admin.user.devices': 'Devices',
  'web.admin.user.passkeys': 'Passkeys',
  'web.admin.user.operations': 'Operations',
  'web.admin.user.failedLogins': 'Failed logins',
  'web.admin.user.subscriptions': 'Subscriptions',
  'web.admin.user.orders': 'Orders',
  'web.admin.user.none': 'None',
  'web.admin.close': 'Close',
  'web.admin.action.unlock': 'Unlock',
  'web.admin.action.quota': 'Set quota',
  'web.admin.action.logout': 'Force sign-out',
  'web.admin.action.done': 'Done.',
  'web.admin.action.failed': 'The action failed.',
  'web.admin.quota.label': 'New quota (MiB)',
  'web.admin.quota.submit': 'Save',
  'web.admin.table.item': 'Item',
  'web.admin.table.status': 'Status',
  'web.admin.table.amount': 'Amount',
  'web.admin.table.created': 'Created',
  'web.admin.table.expires': 'Expires',
  'web.admin.table.inviter': 'Inviter',
  'web.admin.table.invitee': 'Invitee',
  'web.admin.table.reward': 'Reward',
  'web.admin.invites.codes': 'Invite codes',
  'web.admin.invites.referrals': 'Referrals',
  'web.admin.table.owner': 'Owner',
  'web.admin.list.none': 'Nothing here yet.',
  'web.admin.prev': 'Previous',
  'web.admin.next': 'Next',

  // ── Server-side copy (emails / credential pages) ──
  'server.email.common.autoNote': 'This email was sent automatically. Please do not reply.',
  'server.email.common.fallbackIntro': 'If the button does not work, copy this link into your browser:',
  'server.email.common.tagline': 'Local-first tasks and habits',
  'server.email.verify.subject': 'Verify your heyta account',
  'server.email.verify.title': 'Welcome to heyta',
  'server.email.verify.body': 'Click the button below to verify your email and finish creating your account.',
  'server.email.verify.button': 'Verify email',
  'server.email.verify.expiry': 'This link is valid for 24 hours.',
  'server.email.recover.subject': 'Recover your heyta passkey',
  'server.email.recover.title': 'Passkey recovery',
  'server.email.recover.body': 'You asked to recover your passkey. Click the button below to register a new passkey for your account — it replaces the previous one.',
  'server.email.recover.button': 'Register a new passkey',
  'server.email.recover.ignore': 'If you did not request this, just ignore this email — nothing about your account will change.',
  'server.email.recover.expiry': 'This link is valid for 1 hour.',
  'server.email.login.subject': 'Your heyta login link',
  'server.email.login.title': 'Sign in to heyta',
  'server.email.login.body': 'Click the button below to finish signing in.',
  'server.email.login.button': 'Sign in',
  'server.email.login.ignore': 'If you did not request this, just ignore this email.',
  'server.email.login.expiry': 'This link is valid for 15 minutes.',
  'server.page.tokenRequired': 'This link is incomplete: the required token is missing.',
  'server.page.error.unknown': 'Something went wrong. Please try again.',
  'server.page.verify.title': 'Email verified',
  'server.page.verify.heading': 'Your email is verified',
  'server.page.verify.body': 'Your account is ready to use.',
  'server.page.verify.action': 'Go back and sign in',
  // 🔴 The email-link **confirm** page (the one you see *before* clicking) must be
  //    separate from the "already verified" page — claiming success before the click
  //    is simply untrue (measured 2026-09-30).
  'server.page.confirm.title': 'Confirm your email',
  'server.page.confirm.heading': 'Confirm your email',
  'server.page.confirm.body': 'Click the button below to confirm.',
  'server.page.confirm.button': 'Confirm',
  // Passkey-registration links verify the email but do **not** issue a session.
  'server.page.confirm.verifiedOnly': 'Email confirmed. Please sign in with your passkey.',
  'server.page.verify.failedTitle': 'Verification failed',
  'server.page.verify.failedBody': 'This verification link is invalid or has expired. Please register again, or request a new verification email.',
  'server.page.recover.title': 'Recover passkey',
  'server.page.recover.heading': 'Recover your passkey',
  'server.page.recover.body': 'Click the button below to register a new passkey for your account. It replaces the previous one.',
  'server.page.recover.button': 'Register a new passkey',
  'server.page.recover.busy': 'Preparing…',
  'server.page.recover.waiting': 'Complete the prompt from your system…',
  'server.page.recover.verifying': 'Verifying…',
  'server.page.recover.success': 'Your passkey has been registered again. You can go back to the app and sign in.',
  'server.page.recover.error': 'That did not work. Please try again.',
  'server.page.login.title': 'Finish signing in',
  'server.page.login.heading': 'Finish signing in',
  'server.page.login.body': 'Click the button below to finish this sign-in.',
  'server.page.login.button': 'Sign in',
  'server.page.login.busy': 'Signing in…',
  'server.page.login.success': 'Signed in. Redirecting…',
  'server.page.login.error': 'Sign-in failed. Please request a new login link.',
  'server.page.login.again': 'Request a new login link',
} satisfies Record<MessageKey, string>;