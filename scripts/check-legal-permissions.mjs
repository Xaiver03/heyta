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
 * 4. **通知那一族单独一臂**：它撞的不是 `permissions.ts` 而是 `third-parties.ts` 那句
 *    「移动端不申请通知权限」，而那句的依据是 2026-10-02 的**依赖裁决**（批次二 W9 已复量确认停批）。
 *
 * ## 已知边界（别读多）
 *
 * - 只覆盖 **Android manifest + iOS plist / entitlements** 三类声明面。鸿蒙壳未建（AGENTS §2）；
 *   Web 的权限是运行时申请的浏览器能力，不在清单文件里 ⇒ 不归本门禁。
 * - 不判"这句中文翻译得对不对"、不判条款其余部分 —— 那是 `check:legal-copy` 与 `packages/legal/tests/` 的事。
 */

import { readFileSync, existsSync } from 'node:fs';
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
  { key: 'calendar', zh: '日历读写权限', en: 'calendar write access', android: ['READ_CALENDAR', 'WRITE_CALENDAR'], ios: ['NSCalendarFullAccessUsageDescription'] },
];

/** 声明了也不构成说谎的权限（`INTERNET` 不是隐私权限，句子本来就不该提它）。 */
const NON_PRIVACY_ANDROID_PERMISSIONS = new Set(['INTERNET']);

/**
 * 🔴 **今天这张表是空的**，意思是 heyta 一个隐私权限都不申请。
 * 每一项的形状：`{ item: <PRIVACY_ITEMS 的 key>, note: '<为什么申请，产品负责人什么时候拍的>' }`。
 * 往这里加一条 = 必须同时把 `permissions.ts` 那两句里的对应项删掉，否则臂 1 继续红。
 */
const REVIEWED_REQUESTED = [];

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

// ── 臂 1 + 臂 2：申请面 ──────────────────────────────────────────────────────
for (const perm of declaredAndroidPermissions) {
  // 通知先判：它撞的不是 permissions.ts 那九项，而是 third-parties.ts 那句（臂 4）。
  // 不先判的话它会掉进下面的"未登记"分支，红是红了，但**指向的是另一份条款**。
  if (perm === 'POST_NOTIFICATIONS') {
    fail(`${ANDROID_MANIFEST} 声明了 POST_NOTIFICATIONS，而 ${THIRD_PARTIES_DOC} 写的是「移动端不申请通知权限，提醒只在应用内」⇒ 那条依据来自 2026-10-02 的依赖裁决（W9 移动半停批），要动它先动裁决。`);
    continue;
  }
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

// ── 臂 4：通知那一族撞的是 third-parties.ts ─────────────────────────────────
const thirdParties = read(THIRD_PARTIES_DOC);
if (!/移动端不申请通知权限/.test(thirdParties)) {
  fail(`${THIRD_PARTIES_DOC} 里那句「移动端不申请通知权限」不见了 —— 它是 2026-10-02 依赖裁决（W9 移动半停批）的对外表述，删它要么连带改裁决依据，要么变成假话。`);
}
if (entitlementKeys.some((e) => e.key === 'aps-environment')) {
  fail(`entitlements 里有 aps-environment（推送），而否表写「否」⇒ 依据变了，条款得跟着改。`);
}

const reading = `Android 声明 ${declaredAndroidPermissions.length} 条 [${declaredAndroidPermissions.join(', ') || '—'}]、` +
  `NS…UsageDescription ${usageDescriptions.length} 条、句子项数 zh=${zhItems.length} en=${enItems.length}、` +
  `登记表 ${PRIVACY_ITEMS.length} 项、REVIEWED_REQUESTED ${REVIEWED_REQUESTED.length} 项`;

if (process.exitCode) {
  console.error(`\n读数：${reading}`);
  process.exit(1);
}
console.log(`✅ 权限承诺对账通过：${reading}（声明面与"不申请"那九项逐一对得上，中英同数量）`);
