#!/usr/bin/env node
/**
 * Android 小组件文案的中英表对账
 * =================================
 *
 * ## 防的是哪一条，为什么它值得单独一枚门
 *
 * 小组件的文字**不走 `packages/i18n`** —— 它由 `WidgetRefresh.kt:83` 的
 * `WidgetLocalePreference.localizedContext(context)` 用原生 `Context` 渲染，
 * 取值来自 `apps/mobile/android/app/src/main/res/values{,-en}/strings.xml` 里的
 * `widget_*`。也就是说 `pnpm check:ui-language`、i18n 词条对账、TS 类型、构建
 * **四条链都摸不到它**。
 *
 * 失效形状是静默的：英文设备上小组件读 `widget_today_description`，若 `values-en/`
 * 少这一枚，Android 回落 `values/`，用户看到中文 —— 不崩、不红、构建照样过。
 *
 * ## 🔴 每条规则都写了"怎么让它红"，且都实测过（AGENTS §5：不能失败的判据没有价值）
 *
 * 注入用 `--res-root` 指到一份临时副本，**不动工作树**：
 *
 * ```sh
 * FIX=$(mktemp -d)/res && cp -r apps/mobile/android/app/src/main/res "$FIX"
 * # 臂 A：从 values-en 摘掉一枚 widget 键 ⇒ R2 红
 * perl -0pi -e 's{<string name="widget_today_description".*?</string>\s*}{}s' "$FIX/values-en/strings.xml"
 * node scripts/check-android-widget-copy-parity.mjs --res-root "$FIX"; echo "A_RC=$?"   # 期望 1
 * # 臂 B：把 values-en 那枚的值抄成中文 ⇒ R3 红（键在、集合相等，R2 抓不到它）
 * perl -0pi -e 's{<string name="widget_today_description">[^<]*</string>}{<string name="widget_today_description">今天的任务</string>}s' "$FIX/values-en/strings.xml"
 * node scripts/check-android-widget-copy-parity.mjs --res-root "$FIX"; echo "B_RC=$?"   # 期望 1
 * ```
 *
 * 实测（10-13 03:5x，本机）：`A_RC=1`、`B_RC=1`，真树 `RC=0`。
 *
 * 臂 C（R1 分母）：把**两张表**的 `widget_*` 全摘掉 ⇒ 集合"相等"会恒真，R1 必须拦住它。
 * ```sh
 * perl -0pi -e 's{<string name="widget_[^"]*"[^>]*>.*?</string>\s*}{}gs' "$FIX/res/values/strings.xml" "$FIX/res/values-en/strings.xml"
 * node scripts/check-android-widget-copy-parity.mjs --res-root "$FIX/res"; echo "C_RC=$?"   # 期望 1
 * ```
 * 实测 `C_RC=1`，报的是两条 R1（两表各一），不是"0 枚相等 ⇒ 通过"。
 *
 * ## 为什么 R3 不能省（臂 B 就是它存在的理由）
 *
 * R2 只比**键名集合**。有人把 `values-en` 整份复制成中文（键一枚不少）时，R2 全绿而
 * 英文用户仍然看到中文 —— 那正是本格最初登记的那句"静默回落成中文"的第二条通路。
 * R3 的口径是**按字符判**，不是"两边不许相同"：`widget_header`（`%1$s · %2$d/%3$d`）
 * 这类纯格式串在两表里逐字相同是**对的**，用"不许相等"会假红。
 *
 * ## 当前读数（写死在这里只作对照，判据以上面两条臂为准）
 *
 * 两表各 20 枚 `widget_*`，键集合逐枚相等；16 枚"中文表含 CJK、英文表不含"；
 * 4 枚两边都不含 CJK（`widget_header`、`widget_row_done`、`widget_row_todo`、`widget_empty`
 * 这类格式/符号串）；0 枚"英文表含 CJK"。⇒ 上线即绿，且两臂都能红。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};
const unknown = args.filter((a) => a.startsWith('--') && !['--res-root'].includes(a));
if (unknown.length) {
  console.error(`未知参数：${unknown.join(' ')}`);
  process.exit(2);
}

const resRoot = resolve(flag('res-root') ?? 'apps/mobile/android/app/src/main/res');
const TABLES = { 'values（设备默认 / 中文）': 'values', 'values-en（英文）': 'values-en' };
const WIDGET_KEY = /<string name="(widget_[^"]+)"[^>]*>([\s\S]*?)<\/string>/g;
const CJK = /[\u3400-\u9FFF\u3040-\u30FF\uF900-\uFAFF]/;

const tables = {};
for (const [label, dir] of Object.entries(TABLES)) {
  const file = join(resRoot, dir, 'strings.xml');
  if (!existsSync(file)) {
    console.error(`✗ 读不到文案表：${file}\n  这一枚门的分母就是这两份文件，缺任何一份它都无法对账。`);
    process.exit(2);
  }
  const source = readFileSync(file, 'utf8');
  const entries = new Map();
  let match;
  WIDGET_KEY.lastIndex = 0;
  while ((match = WIDGET_KEY.exec(source))) entries.set(match[1], match[2].trim());
  tables[dir] = entries;
  console.log(`· ${label}：${entries.size} 枚 widget_* 键`);
}

const [defaultDir, enDir] = Object.values(TABLES);
const failures = [];

// R1 分母：两表都必须真的解析出键。空集会让 R2 的"集合相等"以恒真的方式通过。
for (const dir of [defaultDir, enDir]) {
  if (tables[dir].size === 0) failures.push(`R1 分母：${dir}/strings.xml 里一枚 widget_* 都没解析到 —— 后面的对账没有对象。`);
}

// R2 键集合双向对账。
const missingInEn = [...tables[defaultDir].keys()].filter((k) => !tables[enDir].has(k));
const extraInEn = [...tables[enDir].keys()].filter((k) => !tables[defaultDir].has(k));
if (missingInEn.length) {
  failures.push(`R2 键集合：values-en 缺 ${missingInEn.length} 枚 ⇒ 英文设备上这些串静默回落成中文：\n    ${missingInEn.join('\n    ')}`);
}
if (extraInEn.length) {
  failures.push(`R2 键集合：values-en 多出 ${extraInEn.length} 枚（默认表没有 ⇒ 非英文设备读不到，且多半是改名没改对）：\n    ${extraInEn.join('\n    ')}`);
}

// R3 英文表不许留着中文：默认表含 CJK 的那些键，英文表必须不含 CJK。
const untranslated = [];
for (const [key, value] of tables[defaultDir]) {
  if (!CJK.test(value)) continue;
  const en = tables[enDir].get(key);
  if (en !== undefined && CJK.test(en)) untranslated.push(`${key} → ${JSON.stringify(en)}`);
}
if (untranslated.length) {
  failures.push(`R3 未翻译：values-en 里 ${untranslated.length} 枚仍是中文（键在、集合相等，所以 R2 抓不到它）：\n    ${untranslated.join('\n    ')}`);
}

if (failures.length) {
  console.error(`\n✗ Android 小组件文案中英对账失败（${failures.length} 条）：\n\n${failures.join('\n\n')}`);
  console.error(`\n  判据来源：scripts/check-android-widget-copy-parity.mjs（本文件头部有每条臂的注入命令）`);
  process.exit(1);
}
console.log(`✅ widget_* 中英对账：${tables[defaultDir].size} 枚键集合相等，英文表零条残留中文。`);
process.exit(0);
