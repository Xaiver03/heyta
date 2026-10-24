#!/usr/bin/env node
/**
 * 法务条款里"heyta **不申请** ……权限"那一句 ⇄ 真实 manifest 的对账门禁
 * =====================================================================
 *
 * ## 为什么要有这一条（倒数纪念日批次二 L'，2026-10-03）
 *
 * `packages/legal/src/documents/permissions.ts` 写着
 * 「heyta 不申请位置、通讯录、通话记录、短信、照片、麦克风、相机、健康、日历读写权限」，
 * 同文件还写着「清单文件里**没有任何 `NS…UsageDescription`**」，
 * `third-parties.ts` 写着「移动端不申请通知权限，提醒只在应用内」。
 * 这些都是**封闭句式** —— 它们的真假不由措辞决定，由 `AndroidManifest.xml` / `Info.plist` /
 * `.entitlements` 里**实际有哪几行**决定。
 *
 * 🔴 这类句子原来**没有任何一层在比**。计划 §4 判据③ 当年写了「⚠️ 未证实是否已有这样的门禁」，
 * 本会话现量确认：`check:legal-host` 做的是域名三方对账（`Info.plist|AndroidManifest|Permission`
 * 命中 0），`check:legal-copy` 只比生成物与真源。也就是说**往 manifest 加一行 `CAMERA`，
 * 全仓不会有东西失败**，而对外那份隐私条款当场变成假话。
 *
 * ## 第一版把判据方向写反了，这条记录留着
 *
 * 我最初写的是"声明了某个隐私权限 ⇒ 句子必须说出来"。那正是要防的那句话的**反面**：
 * 条款说的是"**不申请**"，所以声明了 `CAMERA` 时应该红的是"句子还写着不申请相机"，
 * 而不是"句子没提到相机"。变异臂 A1 第一次跑就 rc=0 把这件事照出来了 ——
 * **一条永不失败的门禁比没有门禁更糟**（AGENTS §7 元规则 2）。
 *
 * ## 判据（四条各自能红）
 *
 * 1. **申请了却仍写在"不申请"清单里 ⇒ 红**（这是对外说谎）。
 * 2. **申请了但没在 `REVIEWED_REQUESTED` 里逐条登记 ⇒ 红**。这一张表今天**是空的**，
 *    加一条的成本是刻意的 —— 与 §3.2 许可证白名单同一个设计：它逼人为这个权限做一次真判断
 *    （它属于哪一项、条款那九项怎么改），而不是让句子悄悄长出门禁看不懂的新词。
 *    ⇒ 本门禁**不是**"永远不许申请隐私权限"的墙：真要走这条路就登记，同时必须把句子改掉，
 *    两句不一致它继续红（臂 1）。
 * 3. **封闭清单本身会漂**：句子说出的每一项都必须是登记表里的项（新词必须登记），
 *    登记表里每一项都必须在句子里出现（除非它已被 `REVIEWED_REQUESTED` 摘掉），
 *    中英两句项数必须相等（只改一边 = 另一边变假话）。
 * 5. **合并产物 ⇄ 源清单**：装到用户机器上的那份清单由装配工合出来，第三方库的
 *    manifest 会混进来。产物在就判（多出一条源清单没有的权限 ⇒ 红），不在就在读数里
 *    写"未判"—— 不许把"本机没构建过"读成绿。
 *
 * 4. **通知那一族单独一臂，而且是两侧对称的**。它撞的不是那九项，而是**六个字面位置**
 *    （`permissions.ts` 的 Android 行 / iOS 行 + `third-parties.ts` 的推送否表行，各中英双份）。
 *    iOS 侧的申请面**有两处**：plist 的目的串与 `HeytaReminderModule.swift` 里那一次
 *    `requestAuthorization(options:)` 调用。只判 plist 的那一臂会空转（Apple 并不要求
 *    本地通知带目的串，代码可以一句键都不写就申请），所以两处都读；反向也判 ——
 *    调用撤了而键还留着 = 清单里挂着一句永远不会被系统读到的承诺。
 *    对称的原因是这一族**正处于翻面过程中**：2026-10-02 的依赖裁决让 W9 移动半停批 ⇒ 那六句为真；
 *    2026-10-03 20:1x 现量：另一条会话（主检出、未提交）用零第三方依赖把它做了，
 *    manifest 里出现 `POST_NOTIFICATIONS` ⇒ 那六句当场变假话。只判"句子必须在"会在合法翻面时假红，
 *    只判"句子必须不在"会放过他们**只改一处**的部分翻转 —— 所以逐位置判：
 *    **申请面已声明而该位置仍声称不申请 ⇒ 红；申请面没声明而该位置不见了 ⇒ 也红**（悄悄删承诺）。
 *
 * ## 已知边界（别读多）
 *
 * - 只覆盖 **Android manifest + iOS plist / entitlements** 三类声明面。鸿蒙壳未建（AGENTS §2）；
 *   Web 的权限是运行时申请的浏览器能力，不在清单文件里 ⇒ 不归本门禁。
 * - 不判"这句中文翻译得对不对"、不判条款其余部分 —— 那是 `check:legal-copy` 与 `packages/legal/tests/` 的事。
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot =
  process.env.HEYTA_CHECK_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');

const ANDROID_MANIFEST = 'apps/mobile/android/app/src/main/AndroidManifest.xml';
const IOS_PLISTS = ['apps/mobile/ios/Heyta/Info.plist', 'apps/mobile/ios/HeytaWidgetExtension/Info.plist'];
const IOS_ENTITLEMENTS = [
  'apps/mobile/ios/Heyta/Heyta.entitlements',
  'apps/mobile/ios/HeytaWidgetExtension/HeytaWidgetExtension.entitlements',
];
const PERMISSIONS_DOC = 'packages/legal/src/documents/permissions.ts';
const THIRD_PARTIES_DOC = 'packages/legal/src/documents/third-parties.ts';

/**
 * 唯一一份"哪九项算隐私权限"的登记表：`zh`/`en` 是条款里必须出现的字面，
 * `android` 是这一项在 Android 上的权限名，`ios` 是对应的 `NS…UsageDescription` 键。
 */
const PRIVACY_ITEMS = [
  { key: 'location', zh: '位置', en: 'location', android: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'], ios: ['NSLocationWhenInUseUsageDescription', 'NSLocationAlwaysAndWhenInUseUsageDescription'] },
  { key: 'contacts', zh: '通讯录', en: 'contacts', android: ['READ_CONTACTS', 'WRITE_CONTACTS'], ios: ['NSContactsUsageDescription'] },
  { key: 'call-log', zh: '通话记录', en: 'call log', android: ['READ_CALL_LOG', 'WRITE_CALL_LOG'], ios: [] },
  { key: 'sms', zh: '短信', en: 'SMS', android: ['READ_SMS', 'RECEIVE_SMS', 'SEND_SMS'], ios: [] },
  { key: 'photos', zh: '照片', en: 'photos', android: ['READ_EXTERNAL_STORAGE', 'READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO'], ios: ['NSPhotoLibraryUsageDescription', 'NSPhotoLibraryAddUsageDescription'] },
  { key: 'microphone', zh: '麦克风', en: 'microphone', android: ['RECORD_AUDIO'], ios: ['NSMicrophoneUsageDescription'] },
  { key: 'camera', zh: '相机', en: 'camera', android: ['CAMERA'], ios: ['NSCameraUsageDescription'] },
  { key: 'health', zh: '健康', en: 'health', android: ['ACTIVITY_RECOGNITION'], ios: ['NSHealthShareUsageDescription', 'NSHealthUpdateUsageDescription'] },
  // iOS 18 起日历/提醒各有两枚键（限范围 + 全访问）；只登记其中一枚的那一臂会空转 ——
  // 有人往 plist 加了另一枚，门禁就把它当成"登记表面生词"红在错的地方。
  { key: 'calendar', zh: '日历读写权限', en: 'calendar write access', android: ['READ_CALENDAR', 'WRITE_CALENDAR'], ios: ['NSCalendarsUsageDescription', 'NSCalendarsFullAccessUsageDescription'] },
  // Android 侧系统提醒数据库由同一对 READ/WRITE_CALENDAR 把守，所以这一项没有独立的
  // Android 权限名 —— 空数组是有意的，不是漏登记。
  { key: 'reminders', zh: '提醒事项', en: 'reminders', android: [], ios: ['NSRemindersUsageDescription', 'NSRemindersFullAccessUsageDescription'] },
];

/** 声明了也不构成说谎的权限（`INTERNET` 不是隐私权限，句子本来就不该提它）。 */
const NON_PRIVACY_ANDROID_PERMISSIONS = new Set([
  'INTERNET',
  // ADR-0051: timing capability only, no personal-data read access. Its purpose
  // and inexact fallback are disclosed in permissions.ts in both languages.
  'SCHEDULE_EXACT_ALARM',
  // W9 提醒族补的两条 normal 级项：都是"能不能被系统叫醒 / 会不会被冻结"，
  // 不读任何个人信息。两条都已经进 permissions.ts 的逐项表（中英各一行），
  // 所以这里放行不会让那句"不申请…"变成假话。
  'RECEIVE_BOOT_COMPLETED',
  'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
]);

/**
 * 🔴 **今天这张表是空的**，意思是 heyta 一个隐私权限都不申请。
 * 每一项的形状：`{ item: <PRIVACY_ITEMS 的 key>, note: '<为什么申请，产品负责人什么时候拍的>' }`。
 * 往这里加一条 = 必须同时把 `permissions.ts` 那两句里的对应项删掉，否则臂 1 继续红。
 */
const REVIEWED_REQUESTED = [];

/**
 * 通知那一族的**六个字面位置**（三处 × 中英）。它们说的是同一件事："移动端不申请通知授权"，
 * 而它们的真假由同一个布尔决定（见下面的 `notificationDeclared`）。
 *
 * ⚠️ 逐位置判而不是整族判：翻面时最容易出的事故是**只改了一份**（改了 `third-parties.ts`
 * 忘了 `permissions.ts` 的 iOS 行），那正好留下两句互相矛盾的对外的话。
 */
const NOTIFICATION_CLAIM_SLOTS = [
  { doc: PERMISSIONS_DOC, where: 'Android 行的依据（zh）', needle: '移动端代码目前不产生任何系统通知' },
  { doc: PERMISSIONS_DOC, where: 'Android 行的依据（en）', needle: 'the mobile code currently raises no system notification at all' },
  { doc: PERMISSIONS_DOC, where: 'iOS 行的依据（zh）', needle: '也不申请通知授权' },
  { doc: PERMISSIONS_DOC, where: 'iOS 行的依据（en）', needle: 'notification authorisation is not requested either' },
  { doc: THIRD_PARTIES_DOC, where: '推送 SDK 否表行（zh）', needle: '移动端不申请通知权限' },
  { doc: THIRD_PARTIES_DOC, where: '推送 SDK 否表行（en）', needle: 'The mobile app requests no notification permission' },
];

const IOS_REMINDER_MODULE = 'apps/mobile/ios/Heyta/HeytaReminderModule.swift';

/**
 * 通知那一族在 iOS 侧的键 —— 它**不进**九项登记表，因为条款里那九项说的都是
 * "读取用户数据的能力"，而通知授权是另一族（它撞的是上面那六个位置）。
 * ⚠️ 本门禁不判断 Apple 是否真的会读这个键（未取证）；它只判断：
 * **申请面一旦出现它，条款就必须承认移动端申请通知授权**，反过来说也一样。
 */
const NOTIFICATION_PLIST_KEYS = new Set(['NSUserNotificationsUsageDescription']);

const fail = (msg) => {
  console.error(`❌ ${msg}`);
  process.exitCode = 1;
};

for (const rel of [ANDROID_MANIFEST, ...IOS_PLISTS, ...IOS_ENTITLEMENTS, PERMISSIONS_DOC, THIRD_PARTIES_DOC]) {
  if (!existsSync(join(repoRoot, rel))) {
    console.error(`❌ 解析前提不成立：${rel} 读不到 —— 本门禁的声明面缺一块，`);
    console.error('   "读不到"不等于"没有申请"，必须响亮失败。');
    process.exit(1);
  }
}

// ── 真实声明面 ───────────────────────────────────────────────────────────────
const declaredAndroidPermissions = [
  ...read(ANDROID_MANIFEST).matchAll(/<uses-permission(?:-sdk-23)?\s+android:name="android\.permission\.([A-Z0-9_]+)"/g),
].map((m) => m[1]);

const usageDescriptions = IOS_PLISTS.flatMap((rel) => [
  ...read(rel).matchAll(/<key>(NS[A-Za-z]+UsageDescription)<\/key>/g),
].map((m) => ({ rel, key: m[1] })));

const entitlementKeys = IOS_ENTITLEMENTS.flatMap((rel) => [
  ...read(rel).matchAll(/<key>([^<]+)<\/key>/g),
].map((m) => ({ rel, key: m[1] })));

// ── 条款那两句 ───────────────────────────────────────────────────────────────
const legal = read(PERMISSIONS_DOC);
const zhLine = legal.match(/text:\s*'(heyta 不申请[^']+)'/);
const enLine = legal.match(/text:\s*'(heyta does not request[^']+)'/);
if (!zhLine || !enLine) {
  console.error('❌ 解析前提不成立：permissions.ts 里那两句「不申请 …/does not request …」找不到。');
  console.error('   本门禁判的是"封闭句式与真实清单对不对得上"，句子措辞被改掉时它必须红，');
  console.error('   不许把"读不到"当成"没有需要申请的权限"而静默放行。');
  process.exit(1);
}
const zhItems = zhLine[1].match(/不申请([^，。]+)/)[1].split('、').map((s) => s.trim());
const enItems = enLine[1]
  .match(/does not request (.+?), and does not read/)[1]
  .split(',')
  .map((s) => s.replace(/^\s*or\s+/, '').trim());

const reviewedKeys = new Set(REVIEWED_REQUESTED.map((r) => r.item));
const claimsNotRequested = (item) => zhItems.includes(item.zh) || enItems.includes(item.en);

// iOS 的申请面**不只在 plist**：`UNUserNotificationCenter.requestAuthorization` 是
// 运行时调用，plist 里一个键都不必出现。所以只判 plist 的那一臂是**空转的**（它能红的
// 唯一方式是有人手动加一枚 Apple 未必读的键）。这一枚读的是真调用点。
const iosRequestsNotificationAuth = read(IOS_REMINDER_MODULE).includes('requestAuthorization(options:');

// ── 臂 1 + 臂 2：申请面 ──────────────────────────────────────────────────────
for (const perm of declaredAndroidPermissions) {
  // 通知族不在这里判：它撞的是那六个字面位置（臂 4），不是那九项。
  // 不在这里 continue 的话它会掉进"未登记的权限"分支，红得指向另一份条款。
  if (perm === 'POST_NOTIFICATIONS') continue;
  const item = PRIVACY_ITEMS.find((i) => i.android.includes(perm));
  if (!item) {
    if (!NON_PRIVACY_ANDROID_PERMISSIONS.has(perm)) {
      fail(
        `${ANDROID_MANIFEST} 声明了 android.permission.${perm}，而它不属于登记表 PRIVACY_ITEMS 的任何一项，也不在 NON_PRIVACY_ANDROID_PERMISSIONS 里。` +
          `\n   先判断它是不是隐私权限：是就登记进对应项，不是就显式加进非隐私集合并写清理由。`,
      );
    }
    continue;
  }
  if (!reviewedKeys.has(item.key)) {
    fail(`已申请 android.permission.${perm}（属于「${item.zh}」），但 REVIEWED_REQUESTED 里没有这一项 —— 它今天必须是空的或有拍板记录。`);
  }
  if (claimsNotRequested(item)) {
    fail(
      `已申请 android.permission.${perm}（「${item.zh}」），而 ${PERMISSIONS_DOC} 仍写着「不申请……${item.zh}……」⇒ 对外条款当场是假话。` +
        `\n   要保留这个权限就把中英两句里那一项删掉；要收回这个权限就删 manifest。`,
    );
  }
}
for (const { rel, key } of usageDescriptions) {
  if (NOTIFICATION_PLIST_KEYS.has(key)) continue; // 通知族，臂 4 判
  const item = PRIVACY_ITEMS.find((i) => i.ios.includes(key));
  if (!item) {
    fail(`${rel} 出现 ${key}，登记表 PRIVACY_ITEMS 里没有它对应的 iOS 键 ⇒ 门禁无法判断它属于条款里的哪一句，先登记。`);
    continue;
  }
  if (!reviewedKeys.has(item.key)) {
    fail(`${rel} 申请了 ${key}（「${item.zh}」），但 REVIEWED_REQUESTED 里没有这一项。`);
  }
  if (claimsNotRequested(item)) {
    fail(`${rel} 申请了 ${key}（「${item.zh}」），而 permissions.ts 那句"没有任何 NS…UsageDescription / 不申请……"仍然这么写 ⇒ 两句各说一套。`);
  }
}

// ── 臂 3：封闭清单自己的对账 ─────────────────────────────────────────────────
for (const item of PRIVACY_ITEMS) {
  if (reviewedKeys.has(item.key)) continue;
  if (!zhItems.includes(item.zh)) fail(`登记表有「${item.zh}」，中文那句"不申请"清单里却没有 —— 漏写，还是登记表写错？`);
  if (!enItems.includes(item.en)) fail(`登记表有 "${item.en}"，英文那句 "does not request" 清单里却没有。`);
}
for (const zh of zhItems) {
  if (!PRIVACY_ITEMS.some((i) => i.zh === zh)) {
    fail(`中文句子说出一项「${zh}」而登记表没有它 ⇒ 门禁无法判断这一项对应哪些 Android/iOS 权限名，也就无法证明"真的没申请"。先登记。`);
  }
}
for (const en of enItems) {
  if (!PRIVACY_ITEMS.some((i) => i.en === en)) {
    fail(`英文句子说出一项 "${en}" 而登记表没有它 ⇒ 同上。`);
  }
}
if (zhItems.length !== enItems.length) {
  fail(`中英两句的项数不等：zh=${zhItems.length} en=${enItems.length}（只改一边 = 另一边当场变假话）`);
}

// ── 臂 4：通知那一族，逐位置两侧对称 ────────────────────────────────────────
const notificationDeclaredBy = [
  ...(declaredAndroidPermissions.includes('POST_NOTIFICATIONS') ? [`${ANDROID_MANIFEST}:POST_NOTIFICATIONS`] : []),
  ...usageDescriptions
    .filter((u) => NOTIFICATION_PLIST_KEYS.has(u.key))
    .map((u) => `${u.rel}:${u.key}`),
  ...(iosRequestsNotificationAuth ? [`${IOS_REMINDER_MODULE}:requestAuthorization`] : []),
];

// 🔴 反方向的空转：申请面撤掉了（Swift 里那一次调用没了）而 plist 还留着目的串，
// 那是一句**永远不会被系统读到**的承诺挂在清单里。要么两处一起撤，要么把调用做回来。
if (!iosRequestsNotificationAuth && usageDescriptions.some((u) => NOTIFICATION_PLIST_KEYS.has(u.key))) {
  fail(`${IOS_REMINDER_MODULE} 里已经没有 requestAuthorization 调用，而 plist 仍声明通知目的串` +
    `（${usageDescriptions.filter((u) => NOTIFICATION_PLIST_KEYS.has(u.key)).map((u) => u.key).join(', ')}）` +
    `\n   ⇒ 目的串是给一次真实申请用的；申请撤了就一起撤，留着它等于对外写着"我们要通知权限"而代码不要。`);
}
const notificationDeclared = notificationDeclaredBy.length > 0;

const slotHits = [];
for (const slot of NOTIFICATION_CLAIM_SLOTS) {
  const present = read(slot.doc).includes(slot.needle);
  slotHits.push(present);
  if (notificationDeclared && present) {
    fail(
      `${slot.doc} 的 ${slot.where}仍写着「${slot.needle}」，而申请面已经声明通知授权（${notificationDeclaredBy.join(' + ')}）` +
        `\n   ⇒ 这句对外条款当场是假话。六个位置要**一起翻**（含中英双份），翻完重跑 \`pnpm check:legal-copy\` 重生成落地页文案。`,
    );
  }
  if (!notificationDeclared && !present) {
    fail(
      `${slot.doc} 的 ${slot.where}（「${slot.needle}」）不见了，而申请面此刻**没有**声明任何通知授权。` +
        `\n   ⇒ 那是把一句对外承诺悄悄删掉：要么把它写回来，要么连申请面一起做。`,
    );
  }
}

// ── 臂 5：合并产物 ⇄ 源清单 ──────────────────────────────────────────────────
//
// 条款说的是**装到用户机器上的那份清单**，而装配工拿的是合并后的产物：第三方库的
// manifest 会被合进来（RN 的 debug manifest 就往里塞 `SYSTEM_ALERT_WINDOW`）。
// 只判源文件的那一臂看不见这一层 ⇒ 某次依赖升级悄悄带进一枚 `READ_CONTACTS`，
// 门禁绿而对外条款当场变假话。产物在就判，不在就如实说"没判到"（不许把缺产物读成绿）。
const MERGED_EXTRA_ALLOWLIST = new Map([
  ['SYSTEM_ALERT_WINDOW', 'react-native 的 debug manifest 注入（仅 debug 构建，release 合并不含它）；不是隐私读取'],
]);

function mergedManifestReadout() {
  const roots = [
    'apps/mobile/android/app/build/intermediates/merged_manifest',
    'apps/mobile/android/app/build/intermediates/merged_manifests',
  ];
  const found = [];
  for (const rel of roots) {
    const abs = join(repoRoot, rel);
    if (!existsSync(abs)) continue;
    for (const dir of readdirSync(abs)) {
      for (const task of existsSync(join(abs, dir)) && statSync(join(abs, dir)).isDirectory() ? readdirSync(join(abs, dir)) : []) {
        const candidate = join(abs, dir, task, 'AndroidManifest.xml');
        if (statSync(candidate).isFile()) found.push(candidate);
      }
    }
  }
  return found;
}

let mergedJudged = 0;
const mergedSets = new Set();
for (const abs of mergedManifestReadout()) {
  const rel = abs.slice(repoRoot.length + 1);
  const perms = [...readFileSync(abs, 'utf8').matchAll(/<uses-permission\s+android:name="android\.permission\.([A-Z0-9_]+)"/g)].map((m) => m[1]);
  const signature = [...perms].sort().join(',');
  if (mergedSets.has(signature)) continue;
  mergedSets.add(signature);
  mergedJudged += 1;
  for (const perm of perms) {
    if (declaredAndroidPermissions.includes(perm)) continue;
    if (!MERGED_EXTRA_ALLOWLIST.has(perm)) {
      fail(`${rel} 合进来一条源清单没有的 android.permission.${perm}。` +
        `\n   源清单 ⇄ 条款对得上不代表装上机的对得上：这是某个依赖的 manifest 带进来的。` +
        `\n   要么在本仓 exclude 掉它，要么把它连同理由一起登记进 MERGED_EXTRA_ALLOWLIST。`);
    }
    const item = PRIVACY_ITEMS.find((i) => i.android.includes(perm));
    if (item && claimsNotRequested(item)) {
      fail(`${rel} 合并出了「${item.zh}」这一族的权限（${perm}），而条款写着"不申请${item.zh}" ⇒ 对外说谎。`);
    }
  }
}
const mergedReading = mergedJudged === 0
  ? '合并产物不在（本机没构建过 Android）⇒ 未判'
  : `合并产物判了 ${mergedJudged} 份`;

if (entitlementKeys.some((e) => e.key === 'aps-environment')) {
  fail(`entitlements 里有 aps-environment（远程推送），而 ${THIRD_PARTIES_DOC} 的推送 SDK 行结论是「否」⇒ 依据变了，条款得跟着改。`);
}

const reading = `Android 声明 ${declaredAndroidPermissions.length} 条 [${declaredAndroidPermissions.join(', ') || '—'}]、` +
  `NS…UsageDescription ${usageDescriptions.length} 条、句子项数 zh=${zhItems.length} en=${enItems.length}、` +
  `${mergedReading}、登记表 ${PRIVACY_ITEMS.length} 项、REVIEWED_REQUESTED ${REVIEWED_REQUESTED.length} 项、` +
  `通知授权 ${notificationDeclared ? '已声明' : '未声明'}（六个承诺位置命中 ${slotHits.filter(Boolean).length}/${NOTIFICATION_CLAIM_SLOTS.length}）`;

if (process.exitCode) {
  console.error(`\n读数：${reading}`);
  process.exit(1);
}
console.log(`✅ 权限承诺对账通过：${reading}（声明面与"不申请"那张登记表逐一对得上，中英同数量，通知族六个位置与申请面同真假）`);
