#!/usr/bin/env node
/**
 * 故障注入验证器：证明界面语言的几条检查**能失败**
 * ==================================================
 *
 * `AGENTS.md` §8.3：「测试要能失败……不能失败的检查没有价值」。这条纪律落到操作层面
 * 就是**故障注入**：把被测的东西故意改坏一处，确认对应检查真的变红，再改回去。
 *
 * 🔴 这个脚本存在的直接原因：迁移期间那批注入探针写在 `/tmp/*.mjs`，
 * 而 `/tmp` 在会话中途被系统清空了 —— 于是"我验过了"只剩下结论、无法复现。
 * **保护检查的脚本和检查本身一样，不能住在临时目录里。**
 *
 * 每个用例都是：
 *   ① 断言锚点存在（否则报「注入失败」而不是默默通过 —— 空转的注入比没有更坏）；
 *   ② 改坏 → 跑命令 → 断言**非零退出**（基线必须先绿，否则红得没有意义）；
 *   ③ 还原，并且在还原前确认文件没被别的进程改过（见 `withMutation`）。
 *
 * 用法：
 *   node scripts/verify-i18n-failures.mjs            # 全部
 *   node scripts/verify-i18n-failures.mjs gate       # 只跑一组
 *
 * ⚠️ 这个脚本不碰 git、不 commit。
 *
 * 🔴 **隔离**：`pricing` / `coupon` 两组改的是 `/tmp` 里的**副本**（见 `prepareProbe`），
 * 真实工作区**一个字都不改**。`recurrence` 的源码副本也是隔离的，但它还会注入
 * `packages/i18n/dist/` 里**真正含那条词条的产物文件**（由 `i18nDistFileWith` 现查，
 * 不写死文件名）—— 那是**未跟踪的构建产物**，不是源码。
 *
 * 隔离是被实测教出来的：注入会在几十秒内把源码故意改坏，而在共享工作区里，这期间
 * 任何别的进程（`pnpm build` / 另一个 agent）读到的都是**改坏的代码**；一次运行
 * 还把一批文件的 mtime 全刷新了，差点被当成"别人的未提交改动被抹掉"。
 *
 * ⚠️ **其余 12 组仍然就地改真实文件**（gate / catalog / disclosure / conflict /
 * landing / scene / storage / sync / preference / preset / aifailure / e2eecopy），其中 `gate`
 * 改的还是 `zh-CN.ts` 这种常有别人在改的文件，而 `e2eecopy` 改的是
 * `packages/i18n/dist/` 的**未跟踪产物**（8c 读的就是它，见那组注释）。它们有
 * journal + 信号处理器 + "拒绝覆盖别人的改动"三道防线，但**注入期间工作区里确实是坏的**：
 * 别在别的进程正改同一批文件时跑它们，也别和 `pnpm build` 并行跑 —— 与 `e2eecopy`
 * 并行尤其危险：那一次构建会把探针故意改坏的那条词条**编译回产物**里。
 * 要搬进副本就照 `prepareProbe` 的用法改。
 */

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const NODE_BIN = path.join(path.dirname(process.execPath), 'node');
/** 隔离副本的根。`/tmp` 被系统清掉会重建，不影响结论。 */
const PROBE_ROOT = '/tmp/heyta-i18n-probe';

const GATE = path.join(ROOT, 'scripts/check-ui-language.mjs');
const ZH = path.join(ROOT, 'packages/i18n/src/locales/zh-CN.ts');
const EN = path.join(ROOT, 'packages/i18n/src/locales/en.ts');
/**
 * 🔴 i18n 的**构建产物目录**，不是某个写死的产物文件。
 *
 * 这里曾经写死 `dist/index.js`，而 `packages/i18n/tsup.config.ts` 是多入口
 * （R7：根入口 + 单语言子路径）⇒ 词条表被 code-split 进 `chunk-*.js`，
 * `index.js` 只剩一个 re-export 桩 —— 于是那两条注入**永远找不到锚点**，
 * 探针抛「锚点不存在」，用例红，而产品一个字都没坏。
 *
 * 这正是 §7 那条一般规律的第三种面目：**写死产物文件名会被每一次构建改掉。**
 * 所以锚点住哪儿由"它真的在里面"决定，见 `i18nDistFileWith`。
 */
const I18N_DIST_DIR = path.join(ROOT, 'packages/i18n/dist');
const MOBILE = path.join(ROOT, 'apps/mobile');
const MOBILE_PROBE = path.join(PROBE_ROOT, 'recurrence/apps/mobile');
const UI = path.join(ROOT, 'packages/ui');
const AI = path.join(ROOT, 'packages/ai');
const AI_SUPPLY = path.join(AI, 'src/supply.ts');
const AI_HEALTH = path.join(AI, 'src/health-store.ts');
/** AI 端到端可达性门禁（8c 查出境披露那句否定在不在词条表里）。 */
const AI_COVERAGE = path.join(ROOT, 'scripts/check-ai-coverage.mjs');
const SYNC_CLIENT = path.join(ROOT, 'packages/sync-client');
const SC_CLIENT = path.join(SYNC_CLIENT, 'src/client.ts');
/**
 * 🔴 「同步失败原因 → 词条 key」这一张表现在**只有共享层一份**。
 *
 * 以前这里是 `apps/web/src/features/sync/sync-failure-copy.ts`，M3 第四刀把
 * 两端那两份（web 的 `sync-failure-copy.ts` 与移动端的 `status-text.ts`）
 * 收进了 `packages/ui/src/sync/model.ts`，旧文件被删 —— 探针的常量没跟着改，
 * 于是那条注入改的是一个**已经不存在的文件**（`readFileSync` 抛 ENOENT）。
 */
const UI_SYNC_MODEL = path.join(UI, 'src/sync/model.ts');
const MOBILE_STATUS_TEXT = path.join(ROOT, 'apps/mobile/src/sync/status-text.ts');
const DOMAIN = path.join(ROOT, 'packages/domain');
const PREF_EVIDENCE = path.join(DOMAIN, 'src/preference-evidence.ts');
const WEB_PREF_COPY = path.join(ROOT, 'apps/web/src/features/settings/preference-copy.ts');
const AI_SETTINGS = path.join(ROOT, 'apps/web/src/features/settings/AiSettings.tsx');
const AI_FAILURE_COPY = path.join(ROOT, 'apps/web/src/features/ai/ai-failure-copy.ts');
const LANDING = path.join(ROOT, 'apps/landing');
const LANDING_ZH = path.join(LANDING, 'index.html');
const LANDING_EN = path.join(LANDING, 'en/index.html');
const SCENE_BOUNDARY = path.join(LANDING, 'src/components/SceneBoundary.tsx');
const SCENE = path.join(LANDING, 'src/components/SyncScene.tsx');

/**
 * 当前站点 origin —— **从产物里读，不写死**。
 *
 * 🔴 2026-09-30：下面三条注入原先硬编码 `https://heyta.finlaw.cloud`。
 * 域名一换（→ `heyta.waytofuture.cn`），`withMutation` 就抛"锚点不存在"，
 * 而本脚本**不在 `pnpm check` 里** —— 也就是说它坏掉时**没有任何门禁会说话**，
 * 下一次真跑它的人才会撞上一个与本次改动无关的报错。
 *
 * 这与仓库那条"换域名 = 一次构建参数、不要写死"的纪律是同一件事：
 * 凡是跟着部署地址走的东西，都从产物里取。
 */
const SITE_ORIGIN = /https:\/\/[a-z0-9.-]+/u.exec(readFileSync(LANDING_EN, 'utf8'))?.[0];
if (SITE_ORIGIN === undefined) {
  throw new Error(`从 ${LANDING_EN} 里读不到站点 origin —— 模板结构变了？`);
}
const STORAGE = path.join(ROOT, 'packages/storage');
const IDB_ADAPTER = path.join(STORAGE, 'src/indexeddb/indexeddb-adapter.ts');
const ERROR_HINT = path.join(ROOT, 'apps/web/src/features/shell/error-hint.ts');
const ERROR_SCREEN = path.join(ROOT, 'apps/web/src/features/shell/ErrorScreen.tsx');
const HEALTH_COPY = path.join(ROOT, 'apps/web/src/features/settings/health-copy.ts');
// 诊断字段（规则 5）：`reason` / `detail` / `cause` 装整句中文会原样渗进已翻译的句子。
// 两个锚点都取**码的生产者**，这样红的是"形状"而不是某个文件里的某一行。
const PUSH_SUBSCRIBE = path.join(ROOT, 'apps/web/src/pwa/push-subscribe.ts');
const MOBILE_PASTE = path.join(ROOT, 'apps/mobile/src/auth/paste.ts');
// 价格一致性（ADR-0020）：实际收多少 / 对外怎么说 / 对外怎么承诺 —— 四处必须同一个数。
const PRICING_CHECK = path.join(ROOT, 'scripts/check-pricing-consistency.mjs');
const PRICING_DOC = path.join(ROOT, 'docs/reference/pricing-and-entitlements.md');
const PRICING_ADAPTER = path.join(ROOT, 'server/src/billing/wechat.adapter.ts');
const PRICING_PRICE_BOOK = path.join(ROOT, 'server/src/billing/price-book.ts');
const COUPON_MONEY = path.join(ROOT, 'server/src/billing/money.ts');
const COUPON_RULES = path.join(ROOT, 'server/src/billing/coupon.ts');
const COUPON_STORE = path.join(ROOT, 'server/src/billing/pricing-store.ts');
const PRICING_LEGAL = path.join(ROOT, 'server/legal/terms-of-service.heyta.md');
// 🔴 ADR-0020 新增的第二份法务文本（云端 AI 订阅）。门禁同时扫两份 ——
// 少了它，AI 档的价格改错了没人拦。
const PRICING_LEGAL_AI = path.join(ROOT, 'server/legal/terms-of-service.ai.heyta.md');
/**
 * `check-pricing-consistency.mjs` 读的**全部** 6 个文件（仓库相对路径）。
 *
 * 🔴 这份清单必须与那道门禁保持一致：探针靠它造副本，漏一个文件，
 * 门禁在副本上就会"读不到 → 报错"，而那会被误读成"注入生效了"。
 * 故意从上面的绝对常量派生，而不是再手写一遍路径。
 */
const PRICING_FILES = [
  PRICING_DOC,
  PRICING_PRICE_BOOK,
  PRICING_ADAPTER,
  ZH,
  EN,
  PRICING_LEGAL,
  PRICING_LEGAL_AI,
].map((abs) => path.relative(ROOT, abs));

/**
 * 造一份**隔离副本**，让故障注入只改副本、真实工作区一个字都不动。
 *
 * ## 为什么必须有这个（不是洁癖）
 *
 * 注入会在几十秒内把源码**故意改坏**。就地改真实文件时，这期间任何别的进程
 * —— `pnpm build` / `pnpm typecheck` / 同一个工作区里的另一个 agent —— 读到的都是
 * 改坏的代码，会去追一个根本不存在的失败。实测代价：一次 `pricing` + `coupon`
 * 运行把 `money.ts` / `coupon.ts` / `price-book.ts` / `pricing-store.ts` /
 * `zh-CN.ts` / `terms-of-service` / `pricing-and-entitlements.md` 的 mtime 全刷新了，
 * 差点被当成"别人的未提交改动被抹掉"（复核后确认无残留 —— 但那是运气，不是设计）。
 *
 * ## 形状
 *
 * `items` 是**仓库相对路径**（文件或目录），按同样的相对位置复制到
 * `<PROBE_ROOT>/<group>/` 下。`links` 是需要在副本里重建的 `node_modules` 软链：
 * pnpm 的 workspace 链接指向真实仓库，不重建的话副本里的包解析不到依赖。
 *
 * ⚠️ 调用方必须用 `assertCopied` 断言副本与真实源码一致 ——
 * 否则"注入成功"可能只是在改一份过期副本，那比不注入更坏。
 */
function prepareProbe(group, items, options = {}) {
  const root = path.join(PROBE_ROOT, group);
  rmSync(root, { recursive: true, force: true });
  for (const rel of items) {
    const dst = path.join(root, rel);
    mkdirSync(path.dirname(dst), { recursive: true });
    cpSync(path.join(ROOT, rel), dst, { recursive: true });
  }
  for (const [rel, target] of options.links ?? []) {
    const dst = path.join(root, rel);
    mkdirSync(path.dirname(dst), { recursive: true });
    symlinkSync(path.join(ROOT, target), dst, 'dir');
  }
  return root;
}

/** 副本里的这些**文件**必须与真实源码逐字相同 —— 否则注入证明的是副本，不是产品。 */
function assertCopied(probeRoot, relPaths) {
  for (const rel of relPaths) {
    const real = readFileSync(path.join(ROOT, rel), 'utf8');
    const copy = readFileSync(path.join(probeRoot, rel), 'utf8');
    if (real !== copy) throw new Error(`隔离副本与真实源码不一致：${rel}`);
  }
}

/** 副本用完就删。 */
function dropProbe(group) {
  rmSync(path.join(PROBE_ROOT, group), { recursive: true, force: true });
}

/** 递归收集目录下的 `.js`（只看产物，`.d.ts` / `.map` 里不会有词条）。 */
function jsFilesUnder(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...jsFilesUnder(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) found.push(full);
  }
  return found.sort();
}

/**
 * 🔴 找出 `packages/i18n/dist` 里**真的含这条锚点**的那个产物文件。
 *
 * 移动端那条测试解析的是 `@heyta/i18n` 的 **dist**（不是源码），所以这两条注入
 * 必须改编译产物 —— 这没有别的选择。要修的只是**"产物里哪个文件"**这件事：
 * 写死 `dist/index.js` 在 `tsup.config.ts` 变成多入口之后就永远不可能命中，
 * 因为 code-split 把词条表搬进了 `chunk-*.js`，`index.js` 只剩 re-export 桩。
 *
 * 三种"找不到"一律**抛错**，绝不静默跳过：
 *   · 目录不存在 ⇒ 没构建过，提示先 build（这是环境问题，说清才能自愈）；
 *   · 零命中 ⇒ 词条被改名/重构，注入点没了 —— 静默跳过就等于这条检查"永远通过"，
 *     而那正是这道探针存在的理由要防的事；
 *   · 多命中 ⇒ 构建形状变了，必须由人决定"移动端真正加载的是哪一份"，
 *     随便挑一个可能会改到一份根本不参与运行的副本，于是"注入成功"是假的。
 */
function i18nDistFileWith(anchor) {
  if (!existsSync(I18N_DIST_DIR)) {
    throw new Error(
      `没有 ${path.relative(ROOT, I18N_DIST_DIR)} —— 这两条注入改的是构建产物。` +
        `先跑 pnpm --filter @heyta/i18n build 再跑本脚本。`,
    );
  }
  const matches = jsFilesUnder(I18N_DIST_DIR).filter((file) => readFileSync(file, 'utf8').includes(anchor));
  const rel = matches.map((file) => path.relative(ROOT, file));
  if (matches.length === 0) {
    throw new Error(
      `注入失败（锚点在 ${path.relative(ROOT, I18N_DIST_DIR)} 的任何产物里都不存在）：\n  锚点：${anchor}\n` +
        '  词条表被改名或结构变了 —— 去核对 packages/i18n 的源码与本组锚点，别把它当成"产品坏了"。',
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `注入失败（锚点同时出现在 ${String(matches.length)} 个产物里，不知道移动端加载的是哪一份）：\n  ` +
        rel.join('\n  ') +
        `\n  锚点：${anchor}\n  构建形状变了（entry / splitting），请先确认哪一份真正参与运行，再把它钉成显式清单。`,
    );
  }
  return matches[0];
}

/** 跑一条命令，返回退出码与合并输出。**不抛错** —— 非零退出就是被测的结果。 */
function run(bin, args, cwd = ROOT, env = undefined) {
  try {
    const out = execFileSync(bin, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
      // 只在需要时注入 env：默认完全继承，免得改变了别的组的运行环境。
      ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
    });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

/** 报错里怎么称呼一个文件：仓库内的用相对路径，隔离副本里的用"逻辑路径（隔离副本 X）"。 */
function label(file) {
  const rel = path.relative(ROOT, file);
  if (!rel.startsWith('..')) return rel;
  const probeRel = path.relative(PROBE_ROOT, file);
  if (probeRel.startsWith('..')) return file;
  const [group, ...rest] = probeRel.split(path.sep);
  return `${rest.join(path.sep)}（隔离副本 ${group}）`;
}

/**
 * 🔴 注入期间被信号杀掉，`finally` **不会执行** —— 工作区会留着改坏的文件。
 *
 * 这不是假想：这条纪律刚立起来就被实测到了。一次**前台**运行被默认 60s 超时
 * SIGTERM 掉，死在 `withMutation` 里面，`apps/landing/src/components/SceneBoundary.tsx:61`
 * 被留在了注入后的 `return this.state.failed ? null : …`；下一次运行于是报"锚点不存在"。
 *
 * 两道防线（`kill -9` 只能靠第二道）：
 *   ① 信号处理器：SIGINT/SIGTERM 时还原，然后按惯例退出。
 *      ⚠️ 它是**尽力而为**，不是保证：实测发现信号在 `execFileSync` 阻塞期间会被
 *      **推迟到那个同步调用返回之后**才执行 —— 也就是说进程可能在那之后**又做了一次注入**。
 *      所以下面第 ② 条才是真正兜住的那个；`kill -9` 连 ① 都跑不到。
 *   ② 落地日志（journal）：注入前把**原文与注入后的内容**写进 `scripts/.verify-i18n-inflight.json`，
 *      还原后删掉。启动时若发现日志还在，说明上次是被强杀的 —— 自动还原并**大声报出来**。
 *
 * ⚠️ 还原的判据和 `withMutation` 的 `finally` 完全一致：只有当前内容仍是**注入后的那份**
 * 才还原。否则说明这期间有别的进程改过它，那就**不动**并提示人工处理 ——
 * 宁可让人看到一份脏文件，也不能覆盖别人的改动。
 */
const JOURNAL = path.join(ROOT, 'scripts/.verify-i18n-inflight.json');

/** 当前在途的注入。`null` 表示没有。 */
let inflight = null;

function restoreInflight(why) {
  if (inflight === null) return false;
  const { file, original, mutated } = inflight;
  // 隔离副本可能已经整个被删掉了（探针在 /tmp 里工作）—— 那不是故障。
  // 不判这一条的话，下次启动会报一个看不懂的 ENOENT，把真正的问题埋掉。
  if (!existsSync(file)) {
    inflight = null;
    try {
      unlinkSync(JOURNAL);
    } catch {
      // 日志本来就不在
    }
    console.error(`\n⚠️ ${why}：${label(file)} 已经不在了（隔离副本已清理），无需还原。`);
    return false;
  }
  const now = readFileSync(file, 'utf8');
  if (now !== mutated) {
    console.error(
      `\n🔴 ${why}：${label(file)} 在注入期间被**别的进程**改过，拒绝还原。\n` +
        `   你的改动已随对方的写入一起消失，请自己确认这个文件是否需要恢复。`,
    );
    return false;
  }
  writeFileSync(file, original);
  inflight = null;
  try {
    unlinkSync(JOURNAL);
  } catch {
    // 日志本来就不在
  }
  console.error(`\n⚠️ ${why}：已还原 ${label(file)}。`);
  return true;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    restoreInflight(`收到 ${signal}`);
    // 128 + 信号编号（SIGINT=2 / SIGTERM=15），与 shell 惯例一致。
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

/** 上次是不是被强杀的？ */
function recoverFromJournal() {
  if (!existsSync(JOURNAL)) return;
  let journal;
  try {
    journal = JSON.parse(readFileSync(JOURNAL, 'utf8'));
  } catch {
    console.error(`🔴 ${path.relative(ROOT, JOURNAL)} 读不出来 —— 请人工检查工作区。`);
    return;
  }
  inflight = journal;
  console.error(
    `\n🔴 上一次运行没有正常收尾（被强杀，连信号处理器都没跑到）。\n` +
      `   注入点：${path.relative(ROOT, journal.file)}`,
  );
  restoreInflight('自动恢复');
}

/**
 * 改坏一个文件、跑一段、再还原。
 *
 * 🔴 还原前必须确认"当前内容仍是我写进去的那份"：如果期间有别的进程改过这个文件，
 * **拒绝还原**并抛错。宁可用例失败，也不能把别人的改动覆盖掉 ——
 * 这个仓库里同时有多条工作流在改同一个文件。
 */
function withMutation(file, from, to, body) {
  const before = readFileSync(file, 'utf8');
  if (!before.includes(from)) {
    throw new Error(`注入失败（锚点不存在）：${label(file)}\n  锚点：${from}`);
  }
  const mutated = before.replace(from, to);
  if (mutated === before) throw new Error(`注入失败（内容没变）：${from}`);
  // 先落日志再改文件：顺序反过来的话，"改完还没记"的那一瞬间被强杀就丢线索了。
  inflight = { file, original: before, mutated };
  writeFileSync(JOURNAL, JSON.stringify(inflight, null, 2));
  writeFileSync(file, mutated);
  try {
    return body();
  } finally {
    const now = readFileSync(file, 'utf8');
    if (now !== mutated) {
      inflight = null;
      throw new Error(
        `拒绝还原：${label(file)} 在探针运行期间被别的进程改过。` +
          `你的注入已随对方的写入一起消失，探针没有覆盖任何东西 —— 请重跑。`,
      );
    }
    writeFileSync(file, before);
    inflight = null;
    try {
      unlinkSync(JOURNAL);
    } catch {
      // 日志本来就不在
    }
  }
}

recoverFromJournal();

const results = [];
/**
 * 跑一个用例。`body()` 返回退出码，期望它非零（`expectRed`）或为零（`expectGreen`）。
 *
 * 🔴 `body()` 抛异常也算**用例失败**，不是让整轮崩掉：
 * 最典型的抛法是 `withMutation` 的"锚点不存在" —— 别人把那段代码改写了，
 * 锚点就失效了。那时候**剩下几组还没跑**，直接崩掉等于"没跑的部分悄悄消失"。
 * 记一条 ❌ 继续跑，才是诚实的形状。（锚点失效时它**在写入之前**就抛，
 * 所以不会留下改坏的文件。）
 */
function runCase(group, name, body, wantZero) {
  let code = -1;
  let out = '';
  try {
    ({ code, out } = body());
  } catch (error) {
    results.push({
      group,
      name,
      ok: false,
      code,
      out: `探针自己抛了异常（多半是锚点失效）：${error instanceof Error ? error.message : String(error)}`,
    });
    return;
  }
  results.push({ group, name, ok: wantZero ? code === 0 : code !== 0, code, out });
}

/** 一个用例：`body()` 返回退出码，期望它非零。 */
function expectRed(group, name, body) {
  runCase(group, name, body, false);
}
/** 基线：期望退出码 0。基线的红说明环境本身坏了，后面所有红都没有意义。 */
function expectGreen(group, name, body) {
  runCase(group, name, body, true);
}

const gateRun = () => run(NODE_BIN, [GATE]);

// ── 组 1：门禁本身（`scripts/check-ui-language.mjs`）──────────────────
function groupGate() {
  expectGreen('gate', '基线：门禁原样必须绿', gateRun);

  // 无效路径：`ROOTS.migratedFiles` 里写一个不存在的文件。
  // 这一条保护的是"逐文件迁移"这个机制本身 —— 路径写错时门禁必须**拒绝运行**，
  // 而不是"找不到就当它合规"。
  // 🔴 第 16 轮起三个壳都是整根 `migrated: true`，所以**清单本身是空的** ——
  // 不能再拿清单里的某一行当锚点（那会让探针自己抛异常，而不是让门禁变红）。
  // 改成：把 web 这一根**临时降回**逐文件模式，并放一条坏路径进去。
  // 这样测的仍然是"清单里的路径逐条校验存在性"这件事本身。
  const STAGE_WEB = `    dir: 'apps/web/src',
    migrated: true,`;
  const stageWebWith = (path) => `    dir: 'apps/web/src',
    migrated: false,
    migratedFiles: [
      '${path}',
    ],`;

  // 不存在的路径：写错一个路径不能静默退回旧契约（那等于"以为管住了，其实没管"）。
  expectRed('gate', 'migratedFiles 里放一个不存在的路径', () =>
    withMutation(GATE, STAGE_WEB, stageWebWith('apps/web/src/__不存在__.tsx'), gateRun),
  );

  // 越界路径：属于别的 root 的文件混进 web 的迁移清单。
  // （它确实存在 —— 所以这条测的不是"文件在不在"，而是"归属对不对"。）
  expectRed('gate', 'migratedFiles 里放一个不属于本 root 的路径', () =>
    withMutation(GATE, STAGE_WEB, stageWebWith('apps/mobile/src/App.tsx'), gateRun),
  );
}

// ── 组 2：词条表的四条规则（改的是词条来源，跑的是门禁）────────────
function groupCatalog() {
  // 规则 2：zh 词条必须含汉字 —— 用英文占位中文是这条规则要抓的典型。
  expectRed('catalog', 'zh 词条写成纯英文（规则 2）', () =>
    withMutation(ZH, "'mobile.recurrence.daily': '每天'", "'mobile.recurrence.daily': 'daily'", gateRun),
  );

  // 规则 3：en 词条不许含中文 —— 把中文复制过去当英文交差。
  expectRed('catalog', 'en 词条写成中文（规则 3）', () =>
    withMutation(EN, "'mobile.recurrence.daily': 'every day'", "'mobile.recurrence.daily': '每天'", gateRun),
  );

  // 规则 4：两份 key 集合必须一致 —— 删掉 en 的一条（漏翻译在编译期也会红，
  // 门禁这条是第二道，保证不依赖 tsc 也能发现）。
  expectRed('catalog', 'en 漏掉一条 key（规则 4）', () =>
    withMutation(EN, "  'mobile.recurrence.dailyEvery': 'every {n} days',\n", '', gateRun),
  );
}

// ── 组 3：重复规则的中英映射 + 中文 parity ───────────────────────────
/** 造一份移动端的临时副本，避免改真实源码。`/tmp` 丢了会重建，不影响结论。 */
function prepareMobileProbe() {
  const root = prepareProbe(
    'recurrence',
    [
      'apps/mobile/src',
      'apps/mobile/tests',
      'apps/mobile/package.json',
      'apps/mobile/tsconfig.json',
      'tsconfig.base.json',
    ],
    { links: [['apps/mobile/node_modules', 'apps/mobile/node_modules']] },
  );
  assertCopied(root, ['apps/mobile/src/lib/recurrence-display.ts']);
  return path.join(root, 'apps/mobile/src/lib/recurrence-display.ts');
}

function groupRecurrence() {
  const display = prepareMobileProbe();
  const mobileRun = () =>
    run(path.join(MOBILE, 'node_modules/.bin/vitest'), ['run', 'tests/recurrence-display.spec.ts'], MOBILE_PROBE);

  expectGreen('recurrence', '基线：映射原样 + 词条表原样', mobileRun);

  const mapping = [
    ['把 `interval === 1` 判反', 'parts.interval === 1', 'parts.interval === 0'],
    ["删掉「最后一天」分支", "if (day === -1) return t('mobile.recurrence.day.last');", ''],
    ['序数恒用 ordinal.n（second → 2th）', 'ORDINAL_KEYS[n] === undefined', 'true'],
    ['描述不了时返回空串而不是原始规则串', 'if (parts === null) return rule;', "if (parts === null) return '';"],
    ['剥掉 BYDAY 的序数（第 2 个周三 → 周三）', 'const nth = match?.[1];', 'const nth = undefined;'],
    ['中文列举分隔符换成英文逗号', "'zh-CN': '、',", "'zh-CN': ', ',"],
  ];
  for (const [name, from, to] of mapping) {
    expectRed('recurrence', name, () => withMutation(display, from, to, mobileRun));
  }

  /**
   * 最关键的一条：改**词条表**里的一个汉字，parity 组必须红。
   *
   * 移动端测试解析的是 `@heyta/i18n` 的 **dist**，所以改的是编译产物。
   * esbuild 会把中文转义成 `\uXXXX`，锚点必须写转义形式（我第一次用字面「每天」，
   * 一个都没匹配上 —— 于是"注入成功"是假的）。
   *
   * 🔴 产物**文件名不写死**：`i18nDistFileWith` 在 `dist/` 里找"真的含这条锚点"的那个
   * 文件。写死 `dist/index.js` 在多入口 + code-split 之后必然落空（原因见那条常量
   * 上面的注释），而落空的表现是探针抛异常 ⇒ 用例红 ⇒ 看起来像产品坏了。
   */
  const ZH_DAILY = String.raw`"mobile.recurrence.daily": "\u6BCF\u5929"`;
  const EN_DAILY = '"mobile.recurrence.daily": "every day"';
  expectRed('recurrence', 'zh 词条「每天」→「每日」（一个字之差）', () =>
    withMutation(
      i18nDistFileWith(ZH_DAILY),
      ZH_DAILY,
      String.raw`"mobile.recurrence.daily": "\u6BCF\u65E5"`,
      mobileRun,
    ),
  );
  expectRed('recurrence', 'en 词条漏出中文（every day → 每天）', () =>
    withMutation(i18nDistFileWith(EN_DAILY), EN_DAILY, ZH_DAILY, mobileRun),
  );

  expectGreen('recurrence', '全部还原后重跑，必须回到绿', mobileRun);
  dropProbe('recurrence');
}

// ── 组 4：AI 披露的**结构化形态**（ADR-0006 的结构层面守卫）──────────
/**
 * 这一组守的不是"字符串长什么样"，而是"结论有没有被悄悄改轻"。
 *
 * 背景：披露以前只有中文句子，界面要双语就必须先有结构化结论
 * （`destinationDisclosure` / `retentionDisclosure`），中文句子退化成兼容投影。
 * 一旦有了"分类"这种东西，就出现了新的作弊路径：**改分类**比改措辞更隐蔽 ——
 * 把托管归成 `third-party-endpoint`，界面上就再也不会出现"明文到了我们手里"。
 * 所以这里注入的正是这种改动。
 *
 * ⚠️ 断言的是**测试真的红**，不是"代码看起来对"。测试跑的是源码
 * （`../src/index.js`），所以不需要先 build。
 */
function groupDisclosure() {
  const aiRun = () => run(path.join(AI, 'node_modules/.bin/vitest'), ['run'], AI);
  const webAiSettingsRun = () =>
    run(
      path.join(ROOT, 'apps/web/node_modules/.bin/vitest'),
      ['run', 'tests/ai-settings.spec.tsx'],
      path.join(ROOT, 'apps/web'),
    );

  expectGreen('disclosure', '基线：AI 包全部测试原样必须绿', aiRun);

  // ① 最隐蔽的那条：把托管"洗"成第三方端点。措辞一个字没改，但结论变轻了。
  expectRed('disclosure', '把托管归类成第三方端点（改分类而非改措辞）', () =>
    withMutation(
      AI_SUPPLY,
      "      return { kind: 'heyta-cloud-managed' };",
      "      return { kind: 'third-party-endpoint' };",
      aiRun,
    ),
  );

  // ② 把"未定案"说成"不适用" —— 于是界面可以理直气壮地编一个保留期。
  expectRed('disclosure', '把"保留策略未定案"归类成"不适用"', () =>
    withMutation(
      AI_SUPPLY,
      "      return { kind: 'undecided' };\n  }\n}",
      "      return { kind: 'not-applicable' };\n  }\n}",
      aiRun,
    ),
  );

  // ③ 兼容文本与结构结论脱钩（两条路径各说一套）。
  expectRed('disclosure', '让兼容文本不再由结构化结论投影', () =>
    withMutation(
      AI_SUPPLY,
      "  switch (destinationDisclosure(destination).kind) {\n    case 'local':\n      return '数据不离开这台设备",
      "  switch (destination) {\n    case 'none':\n      return '数据不离开这台设备",
      aiRun,
    ),
  );

  // ④ ADR-0006 的基石本身：托管那句"不受端到端加密"被删掉。
  expectRed('disclosure', '托管披露里删掉「不受端到端加密」', () =>
    withMutation(AI_SUPPLY, '该功能不受端到端加密保护。', '该功能是安全的。', aiRun),
  );

  // ⑤ 熔断状态的判定优先级被破坏：把"跳闸"整支掐掉。
  //    这不会让任何中文句子变难看，只会让**已经跳闸的端点显示成正常** ——
  //    正是"结构层面"最典型的错法。
  expectRed('disclosure', '熔断状态不再识别"跳闸"（优先级被破坏）', () =>
    withMutation(
      AI_HEALTH,
      'if (entry.circuitOpenUntil !== undefined && entry.circuitOpenUntil > now) {',
      'if (entry.circuitOpenUntil !== undefined && false) {',
      aiRun,
    ),
  );

  // ⑥ 剩余秒数从"向上取整"变成"向下取整" —— 29.5 秒会说成"29 秒后重试"。
  expectRed('disclosure', '剩余秒数改成向下取整（会说"0 秒后重试"）', () =>
    withMutation(
      AI_HEALTH,
      'retryInSeconds: Math.ceil((entry.circuitOpenUntil - now) / 1000),',
      'retryInSeconds: Math.floor((entry.circuitOpenUntil - now) / 1000),',
      aiRun,
    ),
  );

  // ⑦ 中文句子改成不再由结构化结论投影（两条路径各说一套）。
  expectRed('disclosure', '熔断中文句子不再由结构化结论投影', () =>
    withMutation(AI_HEALTH, "    case 'ok':\n      return '正常';", "    case 'ok':\n      return '一切正常';", aiRun),
  );

  // ⑩ 壳侧：端点健康的映射指错 key —— 跳闸被说成"最近失败过"，
  //    用户就不会知道"多久之后会再试"。
  expectRed('disclosure', '端点健康状态映射错位（跳闸说成"失败过"）', () =>
    withMutation(
      HEALTH_COPY,
      "        key: 'web.ai.health.circuitOpen',",
      "        key: 'web.ai.health.failing',",
      webAiSettingsRun,
    ),
  );

  expectGreen('disclosure', '全部还原后重跑，必须回到绿', aiRun);
}

// ── 组 5：冲突载荷的**结构化形态** ──────────────────────────────────
/**
 * 冲突面板的标题以前是**跨包拼出来的一句中文**。改造后 `summarizeConflictPayload()`
 * 只给结构（`empty` / `text` / `fields`），措辞归各壳。
 *
 * 🔴 这一组故意**不跑壳的测试**：壳的测试要读词条表，而词条表可能正在被别的
 * 批次写（那样基线自己就会红，后面的红就没有意义了）。结构不变量在
 * `packages/sync-client` 内部就能完整验证 —— 基线必须是**确定性**的。
 *
 * 注入的都是当年真实出现过的错法，不是编出来的：
 * 把对象直接扔给用户（界面上出现 `completedAt`）、空载荷说成有内容、
 * 标题字段优先级漂移。
 */
function groupConflict() {
  const scRun = () => run(path.join(SYNC_CLIENT, 'node_modules/.bin/vitest'), ['run'], SYNC_CLIENT);

  expectGreen('conflict', '基线：sync-client 全部测试原样必须绿', scRun);

  // ① 空载荷不再被识别成 empty —— 空字符串会渲染成一片空白。
  expectRed('conflict', '空载荷不再识别成 empty', () =>
    withMutation(
      SC_CLIENT,
      "  if (payload === null || payload === undefined) return { kind: 'empty' };",
      "  if (payload === null || payload === undefined) return { kind: 'text', text: String(payload) };",
      scRun,
    ),
  );

  // ② 🔴 当年那个真实 bug 的形状：结构化载荷没有可读标题时，
  //    把**整个对象**丢给界面 —— 用户看到的是 `{"completedAt":123}`。
  expectRed('conflict', '结构化载荷退化成整份 JSON 丢给界面', () =>
    withMutation(
      SC_CLIENT,
      "  if (fields.length === 0) return { kind: 'empty' };\n  return { kind: 'fields', fields };",
      "  if (fields.length === 0) return { kind: 'empty' };\n  return { kind: 'text', text: JSON.stringify(record) };",
      scRun,
    ),
  );

  // ③ 标题字段的**优先级**就是结论本身：`title` 必须先于 `name`。
  //    顺序漂移不会报错，只会让用户在冲突面板里看到"项目 A"而不是"写周报"。
  expectRed('conflict', '标题字段优先级被颠倒（title 不再优先）', () =>
    withMutation(
      SC_CLIENT,
      'for (const key of CONFLICT_TITLE_KEYS) {',
      'for (const key of [...CONFLICT_TITLE_KEYS].reverse()) {',
      scRun,
    ),
  );

  // ④ 中文句子与结构结论脱钩（两条路径各说一套）。
  expectRed('conflict', '冲突中文摘要不再由结构化结论投影', () =>
    withMutation(SC_CLIENT, "      return '（空）';", "      return '没有内容';", scRun),
  );

  expectGreen('conflict', '全部还原后重跑，必须回到绿', scRun);
}

// ── 组 6：落地页的 head（`/en/` + hreflang）──────────────────────────
/**
 * 落地页的双语是**两条真实存在的静态 HTML**，不是运行时切换：
 * `/` 与 `/en/` 各自写死 `lang` / `canonical` / hreflang 三件套。
 * 这意味着**没有编译错误能挡住手滑** —— 改了中文页的标题忘了改英文页，
 * 一切都是绿的，只是搜索引擎会把英文页当成中文页的重复内容。
 *
 * 所以这里注入的每一条，都是"手写两份 HTML"这种形态**必然会犯**的错。
 */
function groupLanding() {
  const seoRun = () =>
    run(path.join(LANDING, 'node_modules/.bin/vitest'), ['run', 'tests/seo-head.spec.ts'], LANDING);

  expectGreen('landing', '基线：落地页 head 测试原样必须绿', seoRun);

  // ① 英文入口的 `lang` 写回中文 —— 屏幕阅读器会用中文念英文页。
  expectRed('landing', '英文入口的 <html lang> 写成中文', () =>
    withMutation(LANDING_EN, '<html lang="en">', '<html lang="zh-CN">', seoRun),
  );

  // ② 英文入口的 canonical 指到中文入口 —— 等于自己声明"我不是正版"。
  expectRed('landing', '英文入口的 canonical 指回中文入口', () =>
    withMutation(
      LANDING_EN,
      `<link rel="canonical" href="${SITE_ORIGIN}/en/" />`,
      `<link rel="canonical" href="${SITE_ORIGIN}/" />`,
      seoRun,
    ),
  );

  // ③ hreflang 标签写错（`en-US` 不是我们声明的 `en`）—— 三件套少一件。
  expectRed('landing', 'hreflang 标签写成 en-US（三件套缺一件）', () =>
    withMutation(
      LANDING_ZH,
      `<link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/en/" />`,
      `<link rel="alternate" hreflang="en-US" href="${SITE_ORIGIN}/en/" />`,
      seoRun,
    ),
  );

  // ④ 🔴 这条正是那个测试存在的理由：复制中文页的 `<title>` 过去忘了改。
  //    两个入口顶着同一个标题，不报错、不影响渲染，只影响搜索结果。
  expectRed('landing', '英文入口顶着中文标题（复制过去忘了改）', () =>
    withMutation(
      LANDING_EN,
      '<title>heyta: local-first task management you can self-host</title>',
      '<title>heyta：本地优先的任务管理，可自建自托管</title>',
      seoRun,
    ),
  );

  expectGreen('landing', '全部还原后重跑，必须回到绿', seoRun);
}

// ── 组 7：WebGL 兜底的两道防线 ──────────────────────────────────────
/**
 * 背景是**一个真实上线过的事故**：没有 WebGL 的访客打开落地页看到的是
 * **整片白**。原因是 `new THREE.WebGLRenderer(...)` 在 effect 里抛错，
 * 而错误没被接住 —— React 于是卸载了整棵树。
 *
 * 修法是**两道刻意不冗余的防线**（各盖一条不同的路径）：
 *   1. `SyncScene` 的 `try/catch` —— 盖**渲染器构造**抛错；
 *   2. `SceneBoundary` —— 盖**渲染期**抛错与 lazy 分片加载失败。
 *
 * 这两条路径用"看代码"是分不清的：删掉任何一条，另一条都**看起来**还在。
 * 所以必须让它们各自可失败。
 */
function groupScene() {
  const scRun = () =>
    run(path.join(LANDING, 'node_modules/.bin/vitest'), ['run', 'tests/scene-fallback.spec.tsx'], LANDING);

  expectGreen('scene', '基线：WebGL 兜底测试原样必须绿', scRun);

  // ① 边界不再进入失败态 —— 于是异常继续往上冒，整棵树被卸载（白屏复发）。
  expectRed('scene', '错误边界不再进入失败态（白屏复发）', () =>
    withMutation(SCENE_BOUNDARY, '    return { failed: true };', '    return { failed: false };', scRun),
  );

  // ② 边界降级时把**整节**都换成 null —— 降级丢的不该是那段内容本身。
  expectRed('scene', '降级时把整节都丢掉（只剩空白）', () =>
    withMutation(
      SCENE_BOUNDARY,
      '    return this.state.failed ? this.props.fallback : this.props.children;',
      '    return this.state.failed ? null : this.props.children;',
      scRun,
    ),
  );

  // ③ 渲染器构造失败时不再置位 —— 于是没有静态图，只剩一块空 canvas。
  expectRed('scene', '渲染器构造失败后不再降级（留着空 canvas）', () =>
    withMutation(SCENE, '      setWebglFailed(true);\n      return;', '      return;', scRun),
  );

  expectGreen('scene', '全部还原后重跑，必须回到绿', scRun);
}

// ── 组 8：存储失败的结构化原因（错误屏那条通道）────────────────────
/**
 * `ErrorScreen` 渲染的是 `error.message` 原文（`apps/web/src/main.tsx:52`），
 * 所以 `packages/storage` 抛中文 = 英文界面在**应用启动失败**时露中文。
 * 门禁永远扫不到它（渲染的是变量）。修法是让来源给结构化原因。
 *
 * 这一组钉的正是"原因不能被弄丢"，而且三条里有一条是**实测发生过的回归**：
 * 包一层之后 `error.name` 从 `ConstraintError` 变成 `StorageError`，
 * 唯一索引冲突的幂等路径当场坏掉（4 个既有用例变红）。
 */
/**
 * 同步失败原因的结构化
 * ======================
 *
 * 这一组钉的是最后一条"门禁扫不到的通道"：
 * `SyncStatus.message` 是 `packages/sync-client` 里的中文，壳把它整句插进
 * 英文句子里，于是英文界面出现 `Sync error: 未设置端到端加密口令…`。
 *
 * 修法分三层，每一层都要能失败：
 *   1. **包里**给出结构化 `reason`（并且它自己有测试钉住 —— 在这之前，
 *      `reason` 改错了是**没有任何测试会红**的）；
 *   2. **共享层**给出「原因 → 词条 key」那张表（M3 第四刀起 web 与移动端
 *      共用 `packages/ui` 的 `syncFailureMessageKey` 一份，见
 *      `packages/ui/src/sync/model.ts` 文件头记的那次真实漂移）；
 *   3. **移动端壳**真的去用它（那层原来更糟：整句丢掉，只剩"同步失败"）。
 *
 * 🔴 注入点跟着搬家是**必须的**，不是整理：第 2 层的旧锚点
 * `apps/web/src/features/sync/sync-failure-copy.ts` 已经被删掉了，
 * `withMutation` 的 `readFileSync` 直接抛 ENOENT ⇒ 用例红在探针自己身上，
 * 而产品完好。这一组的第 2 层因此改成跑 `@heyta/ui` **自己**的
 * `tests/sync-model.spec.ts` —— 它读的是源码，不受 `dist/` 是否新鲜影响
 * （web 壳确实消费这张表，那条仍由本组末尾的 `webSyncRun` 基线绿钉住）。
 */
function groupSync() {
  const syncRun = () => run(path.join(SYNC_CLIENT, 'node_modules/.bin/vitest'), ['run'], SYNC_CLIENT);
  const uiModelRun = () =>
    run(
      path.join(UI, 'node_modules/.bin/vitest'),
      ['run', 'tests/sync-model.spec.ts'],
      path.join(ROOT, 'packages/ui'),
    );
  const webSyncRun = () =>
    run(
      path.join(ROOT, 'apps/web/node_modules/.bin/vitest'),
      ['run', 'tests/store-copy.spec.tsx'],
      path.join(ROOT, 'apps/web'),
    );
  const mobileSyncRun = () =>
    run(
      path.join(ROOT, 'apps/mobile/node_modules/.bin/vitest'),
      ['run', 'tests/sync-status-text.spec.ts'],
      path.join(ROOT, 'apps/mobile'),
    );
  /** 四条一起跑：注入点在四个不同的包里，还原后四个都得回绿。 */
  const allRun = () => {
    for (const r of [syncRun, uiModelRun, webSyncRun, mobileSyncRun]) {
      const res = r();
      if (res.code !== 0) return res;
    }
    return { code: 0, out: '' };
  };

  expectGreen('sync', '基线：sync-client 全部测试原样必须绿', syncRun);

  // ① 包里把"没口令"错报成"没登录" —— 两件事用户要做的完全不同
  //   （去填口令 vs 去登录），混起来等于没说。
  expectRed('sync', '把"没有加密口令"错报成"没登录"', () =>
    withMutation(
      SC_CLIENT,
      "        reason: 'no-encryption-password',\n        retryable: false,",
      "        reason: 'not-signed-in',\n        retryable: false,",
      syncRun,
    ),
  );

  // ② 共享那张表：两条不同的失败指到同一条词条 —— 两端会同时给出**错的**下一步
  //   （口令错的人被支去"填服务地址"）。这张表只有一份，所以注入也必须只打一处。
  expectRed('sync', '共享表把两种失败指到同一条词条', () =>
    withMutation(
      UI_SYNC_MODEL,
      "  'no-encryption-password': 'common.sync.error.noPassword',",
      "  'no-encryption-password': 'common.sync.error.notConfigured',",
      uiModelRun,
    ),
  );

  // ③ 移动端壳：不再走共享路由，全都退回"同步失败"（迁移前的行为）。
  //   注入打在**调用点**上 —— 共享表本身坏掉是第 ② 条的事，这条钉的是
  //   "壳有没有真的去区分"。
  expectRed('sync', '移动端不再区分原因（全退回"同步失败"）', () =>
    withMutation(
      MOBILE_STATUS_TEXT,
      '      const key = syncFailureMessageKey(status.reason);',
      '      const key = undefined;',
      mobileSyncRun,
    ),
  );

  expectGreen('sync', '全部还原后四条一起重跑，必须回到绿', allRun);
}

/**
 * 偏好的「事实 → 句子」
 * ======================
 *
 * 这一组钉的是**跨包文案**这条通道：`packages/domain` 拼好的中文
 *（`preference.evidence`、`preferenceLabel(id)`）被两个壳整句渲染，
 * 于是英文界面永远露中文 —— 壳里渲染的是**变量**，门禁扫不到。
 *
 * 修法是"领域给事实、外壳给句子"。这一组里最容易犯的三种错：
 *   ① 领域的中文投影和词条表**漂移**（两份中文，改了一边忘了另一边）；
 *   ② 壳把某个偏好**指错词条**（界面上张冠李戴）；
 *   ③ 壳把某一档**说反**（"提前"说成"逾期"）。
 */
function groupPreference() {
  const domainRun = () => run(path.join(DOMAIN, 'node_modules/.bin/vitest'), ['run'], DOMAIN);
  const webPrefRun = () =>
    run(
      path.join(ROOT, 'apps/web/node_modules/.bin/vitest'),
      ['run', 'tests/preference-copy.spec.tsx'],
      path.join(ROOT, 'apps/web'),
    );
  const allRun = () => {
    for (const r of [domainRun, webPrefRun]) {
      const res = r();
      if (res.code !== 0) return res;
    }
    return { code: 0, out: '' };
  };

  expectGreen('preference', '基线：领域测试 + web 偏好文案测试原样必须绿', allRun);

  // ① 领域投影改一个字的措辞 → 两份中文漂移。
  //   领域自己的测试和 web 的逐字比对**各红一次**（这正是 deliberate duplication
  //   被测试锁住的样子）。
  expectRed('preference', '领域投影的措辞和词条表漂移（`以中文为主` → `中文`）', () =>
    withMutation(
      PREF_EVIDENCE,
      "facts.cjkShare >= 0.8 ? '以中文为主' : facts.cjkShare <= 0.2 ? '以英文为主' : '中英混用'",
      "facts.cjkShare >= 0.8 ? '中文' : facts.cjkShare <= 0.2 ? '以英文为主' : '中英混用'",
      domainRun,
    ),
  );

  // ② 壳把「任务拆解粒度」指到「估时偏差」的词条 —— 界面上张冠李戴。
  expectRed('preference', '偏好名指错词条（拆解粒度 → 估时偏差）', () =>
    withMutation(
      WEB_PREF_COPY,
      "  granularity: 'web.memory.pref.granularity',",
      "  granularity: 'web.memory.pref.estimateBias',",
      webPrefRun,
    ),
  );

  // ③ 壳把「逾期」那一档说成「提前」—— 判据写反，用户会读到相反的话。
  expectRed('preference', '把「逾期」说成「提前」（判据写反）', () =>
    withMutation(
      WEB_PREF_COPY,
      "            ? 'web.memory.evidence.leadTimeLate'",
      "            ? 'web.memory.evidence.leadTimeAhead'",
      webPrefRun,
    ),
  );

  // ④ 「还不了解」的原因表指错 —— 界面上会说错"还缺什么"。
  //    由"中文措辞与搬走之前逐字一致"那条钉住（它枚举了具体句子）。
  expectRed('preference', '「还不了解」的原因指错偏好（提前量 → 粒度）', () =>
    withMutation(
      WEB_PREF_COPY,
      "  'lead-time': 'web.memory.withheld.noData.leadTime',",
      "  'lead-time': 'web.memory.withheld.noData.granularity',",
      webPrefRun,
    ),
  );

  // ⑤ 忘了把 `remaining` 送进句子 —— 界面上会原样显示 `{remaining}` 模板。
  //    判别联合保证了"取不到数字"编译不过，但**取到了却忘了传**只能靠测试。
  expectRed('preference', '「还差几次」的数字忘了传进句子（模板原样上屏）', () =>
    withMutation(
      WEB_PREF_COPY,
      "      return { key: WITHHELD_SAMPLES_KEY[w.id], params: { remaining: w.remaining } };",
      "      return { key: WITHHELD_SAMPLES_KEY[w.id], params: {} };",
      webPrefRun,
    ),
  );

  expectGreen('preference', '全部还原后两条一起重跑，必须回到绿', allRun);
}

/**
 * 出场预设的名字与前置条件
 * ==========================
 *
 * `packages/ai` 的 `AI_ENDPOINT_PRESETS` 带着**中文** label / prerequisite，
 * 而壳是按 `id` 取词条、未知 id 回退。这条路径门禁看不见
 *（渲染的是变量 `preset.label`，不是字面量）—— 和 §7.10 那八条通道同一类。
 *
 * 唯一的兜底是 `ai-settings.spec.tsx` 里那条"枚举全部出厂预设"的测试。
 * 这一组证明**那条测试真的会红**：把某个预设的 `case` 改成一个不存在的 id，
 * 它就会落进回退分支，测试必须当场失败。
 */
function groupPreset() {
  const webAiRun = () =>
    run(
      path.join(ROOT, 'apps/web/node_modules/.bin/vitest'),
      ['run', 'tests/ai-settings.spec.tsx'],
      path.join(ROOT, 'apps/web'),
    );

  expectGreen('preset', '基线：AI 设置面板测试原样必须绿', webAiRun);

  // 让 `ollama` 落进 `default` 回退分支 —— 界面开始渲染裸 id / 跨包中文。
  expectRed('preset', '预设的 id 写错 → 落进回退分支（缺词条不再静默）', () =>
    withMutation(AI_SETTINGS, "    case 'ollama':", "    case 'ollama-typo':", webAiRun),
  );
}

/**
 * AI 面板失败态的文案（§7.10 通道 #5）
 * =====================================
 *
 * 四个面板原来整句渲染 `outcome.message`（跨包中文）。现在主文案按**原因码**
 * 取词条、`message` 降级成技术详情。这一组证明**"原因码取错词条"能被抓到**：
 * 把 `egress-not-authorized` 指到别的词条上，那四条"提示去逐功能授权"的
 * 面板测试必须变红 —— 用户要做的动作（去授权）从界面里消失了。
 */
function groupAiFailure() {
  const panelsRun = () =>
    run(
      path.join(ROOT, 'apps/web/node_modules/.bin/vitest'),
      [
        'run',
        'tests/ai-breakdown.spec.tsx',
        'tests/ai-capture.spec.tsx',
        'tests/ai-duration.spec.tsx',
        'tests/ai-prioritize.spec.tsx',
      ],
      path.join(ROOT, 'apps/web'),
    );

  expectGreen('aifailure', '基线：四个 AI 面板测试原样必须绿', panelsRun);

  expectRed('aifailure', '原因码指错词条 → "去逐功能授权"这句话从界面消失', () =>
    withMutation(
      AI_FAILURE_COPY,
      "  'egress-not-authorized': 'web.ai.failure.cause.egressNotAuthorized',",
      "  'egress-not-authorized': 'web.ai.failure.cause.network',",
      panelsRun,
    ),
  );
}

/**
 * 价格一致性（`scripts/check-pricing-consistency.mjs`）
 * ===================================================
 *
 * 价格是**唯一一个除了词条表之外还有可执行事实源**的文案：
 * `server/src/billing/wechat.adapter.ts` 的价目表才是真正收的钱，
 * 词条表里的价格只是「对外怎么说」。两者不一致就是虚假宣传。
 *
 * 这一组证明那道门禁**真的会红**，而且证明的是它最难的那种情形 ——
 * 「文档里已经有一个正确的价格，另一处被改成了别的数字」：
 * 只检查"某条词条含不含 ¥5"是拦不住的（实测：把法务文本 §4 改成 ¥9 时
 * 那种写法照绿，因为 §2 那张表里还留着一个 ¥5），所以门禁扫的是**全量金额**。
 *
 * 🔴 最后一条钉的是门禁自己的**锚点失效**：词条被改名之后，
 * 「找不到就跳过」的实现会让这道门禁**永远通过**，而那正是最需要它红的时候。
 */
function groupPricing() {
  // 🔴 整组跑在**副本**上：注入改的是 `/tmp` 里的文件，真实工作区一个字都不动。
  // 副本里必须齐 7 个文件，否则门禁会"读不到 → 报错"，那会被误读成注入生效。
  const probe = prepareProbe('pricing', PRICING_FILES);
  assertCopied(probe, PRICING_FILES);
  const inProbe = (abs) => path.join(probe, path.relative(ROOT, abs));
  const BOOK = inProbe(PRICING_PRICE_BOOK);
  const ADAPTER = inProbe(PRICING_ADAPTER);
  const DOC = inProbe(PRICING_DOC);
  const LEGAL = inProbe(PRICING_LEGAL);
  const LEGAL_AI = inProbe(PRICING_LEGAL_AI);
  const ZH_PROBE = inProbe(ZH);
  const EN_PROBE = inProbe(EN);

  // `HEYTA_CHECK_ROOT` 让门禁把这 7 个相对路径全部解析到副本根。
  const pricingRun = () => run(NODE_BIN, [PRICING_CHECK], ROOT, { HEYTA_CHECK_ROOT: probe });

  expectGreen('pricing', '基线：四处价格一致时必须绿', pricingRun);

  // ① 实际收多少被改（代码基线价目表）—— 页面写的价格不再是要付的价格。
  expectRed('pricing', '代码基线价目表改了而页面没改（用户看到的价格≠实收）', () =>
    withMutation(
      BOOK,
      "    priceId: 'hosted-monthly',\n    currency: 'CNY',\n    amountMinor: 500,",
      "    priceId: 'hosted-monthly',\n    currency: 'CNY',\n    amountMinor: 900,",
      pricingRun,
    ),
  );

  // ①b 海外价被改 —— 这一条在 ADR-0018 之前**抓不到**：门禁当时只比对大陆价，
  //     而 $5 只存在于词条表与法务文本里，服务端没有任何地方声明过它。
  //     ⚠️ CNY 与 USD 现在**都是 500**，所以锚点必须带上 priceId 与 currency。
  expectRed('pricing', '海外基线价被改而词条没改', () =>
    withMutation(
      BOOK,
      "    priceId: 'hosted-monthly',\n    currency: 'USD',\n    amountMinor: 500,",
      "    priceId: 'hosted-monthly',\n    currency: 'USD',\n    amountMinor: 900,",
      pricingRun,
    ),
  );

  // ①c 🔴 **第二档**的价格被改。ADR-0017 时代只有一档，这条无从谈起；
  //     现在两档各有一条基线，只盯住第一档是不够的。
  expectRed('pricing', '第二档（hosted-ai-monthly）基线价被改而词条没改', () =>
    withMutation(
      BOOK,
      "    priceId: 'hosted-ai-monthly',\n    currency: 'CNY',\n    amountMinor: 1_200,",
      "    priceId: 'hosted-ai-monthly',\n    currency: 'CNY',\n    amountMinor: 1_900,",
      pricingRun,
    ),
  );

  // ①d 🔴 把数字**抄回** adapter —— 抄回去的那份不会跟着改价动。
  //    这是 ADR-0018 新增的那条"负向"检查：价格收敛到一处还不够，
  //    还得拦住后来的人顺手再抄一份。
  expectRed('pricing', '把 totalFen 字面量抄回 adapter（同一个数字写两次）', () =>
    withMutation(
      ADAPTER,
      'export const WECHAT_DEFAULT_PRICES',
      "const SNEAKY = { 'hosted-monthly': { totalFen: 500, description: '抄一份' } };\nexport const WECHAT_DEFAULT_PRICES",
      pricingRun,
    ),
  );

  // ①e 把 CNY 基线价整条删掉 —— 门禁必须**报错**（锚点/完整性），不许当成"没有价格所以通过"。
  expectRed('pricing', 'CNY 基线价被删掉时不许静默通过', () =>
    withMutation(
      BOOK,
      "    priceId: 'hosted-monthly',\n    currency: 'CNY',\n    amountMinor: 500,",
      "    priceId: 'hosted-monthly',\n    currency: 'CNY',",
      pricingRun,
    ),
  );

  // ② 对外怎么说被改（中文词条）。
  expectRed('pricing', '中文词条的价格被改而价目表没改', () =>
    withMutation(
      ZH_PROBE,
      "'landing.pricing.hosted.priceCny': '¥5 / 月',",
      "'landing.pricing.hosted.priceCny': '¥9 / 月',",
      pricingRun,
    ),
  );

  // ②b 英文词条被改 —— 只查中文的话，英文页上那个 `$5` 是没人拦的。
  expectRed('pricing', '英文词条的价格被改而价目表没改', () =>
    withMutation(
      EN_PROBE,
      "'landing.pricing.hosted.priceUsd': '$5 / month',",
      "'landing.pricing.hosted.priceUsd': '$9 / month',",
      pricingRun,
    ),
  );

  // ③ 🔴 这条是"扫全量金额"的理由：法务文本里**已经有一个 ¥5**（§2 那张表），
  //    只改另一处（§4）。按"文档里出现过 ¥5 就算过"的写法，这一条必绿。
  expectRed('pricing', '同步法务文本另一处的价格被改（文档里仍留着一个 ¥5）', () =>
    withMutation(LEGAL, '| 价格 | 大陆人民币 **¥5 / 月**；', '| 价格 | 大陆人民币 **¥9 / 月**；', pricingRun),
  );

  // ③b 🔴 **AI 法务文本**自己被动过。这条钉的是"门禁真的读了两份法务"——
  //     只读同步条款的实现会让这一条**照绿**，而 AI 档的价格就没人管了。
  expectRed('pricing', 'AI 法务文本的价格被改而词条没改', () =>
    withMutation(
      LEGAL_AI,
      '| 价格 | 大陆人民币 **¥12 / 月**；',
      '| 价格 | 大陆人民币 **¥19 / 月**；',
      pricingRun,
    ),
  );

  // ④ 价格表自己（pricing-ssot 块）被改 —— 门禁必须抓到"唯一事实源"本身被动过。
  expectRed('pricing', 'pricing-ssot 块自己被动过', () =>
    withMutation(
      DOC,
      '"cny": { "amountMinor": 500, "display": "¥5 / 月" }',
      '"cny": { "amountMinor": 900, "display": "¥9 / 月" }',
      pricingRun,
    ),
  );

  // ⑤ 🔴 偷偷加**第三个**档。ADR-0020 批准的是**恰好两个** SKU
  //    （`EXPECTED_SKU_COUNT = 2`），不是"至多两个"：多一个就直接破坏
  //    「收费的只有托管与我们的 AI」这条对外承诺。
  //    ⚠️ 复用已有的 catalogKey，这样唯一的违规就是"多了一个档"。
  expectRed('pricing', 'pricing-ssot 里偷偷加第三个档', () =>
    withMutation(
      DOC,
      '      "usd": { "amountMinor": 1200, "display": "$12 / 月" }\n    }\n  ]',
      '      "usd": { "amountMinor": 1200, "display": "$12 / 月" }\n    },\n    {\n      "priceId": "team-monthly",\n      "period": "month",\n      "grants": ["hosting"],\n      "catalogKey": "landing.pricing.hosted",\n      "cny": { "amountMinor": 3900, "display": "¥39 / 月" },\n      "usd": { "amountMinor": 3900, "display": "$39 / 月" }\n    }\n  ]',
      pricingRun,
    ),
  );

  // ⑤b 🔴 `grants` 里塞一个**功能名**。这是 ADR-0020 §3.2 的核心禁令：
  //     「非 AI 能力永久免费」在代码里唯一可执行的形式就是"收费清单上没有功能名"。
  expectRed('pricing', 'grants 里混进功能名（把付费说成解锁功能）', () =>
    withMutation(DOC, '"grants": ["hosting"],', '"grants": ["hosting", "labels"],', pricingRun),
  );

  // ⑤c 🔴 把第二档的 `ai` 去掉 —— 两档就变成一样了，"多花 ¥7"没了对应物。
  //     门禁断言"恰好一个 SKU 含 ai"。
  expectRed('pricing', '两档的 grants 变成一样（第二档的 ai 被去掉）', () =>
    withMutation(DOC, '"grants": ["hosting", "ai"],', '"grants": ["hosting"],', pricingRun),
  );

  // ⑤d 代码基线里也偷偷加第三个档 —— 并且给一个**不在 ssot 里**的 priceId，
  //     门禁的反向检查（DEFAULT_PRICE_BOOK 不许有 ssot 没批过的 priceId）必须响。
  expectRed('pricing', '基线价目表里偷偷加 ssot 没批过的档', () =>
    withMutation(
      BOOK,
      "  {\n    priceId: 'hosted-monthly',\n    currency: 'USD',",
      "  {\n    priceId: 'team-monthly',\n    currency: 'CNY',\n    amountMinor: 3_900,\n    effectiveFrom: 0,\n    effectiveUntil: null,\n  },\n  {\n    priceId: 'hosted-monthly',\n    currency: 'USD',",
      pricingRun,
    ),
  );

  // ⑥ 门禁的锚点失效（词条被改名）：必须**报错**，不许静默跳过。
  expectRed('pricing', '门禁锚点失效（词条改名）时不许静默通过', () =>
    withMutation(ZH_PROBE, "'landing.pricing.hosted.priceCny':", "'landing.pricing.hosted.priceCNY':", pricingRun),
  );

  dropProbe('pricing');
}

/**
 * 组：优惠券的金额与名额规则。
 *
 * 🔴 这一组的存在理由是：**券的算术与名额判定最容易被"看起来等价"的改动弄错。**
 * 取整方向、门槛的开闭、限额的开闭 —— 四个 `>=` 与 `>` 的差别，每一个都
 * 只在边界上显形，而边界恰恰是同行评审最容易滑过去的地方。
 *
 * 每一发都打在 `server/tests/` 里一条**已经存在**的断言上；探针只负责证明
 * "那条断言真的会因为这一处坏掉而变红"，而不断言本身。
 */
function groupCoupon() {
  // 🔴 整组跑在**副本**上：`server/` 的源码与测试复制到 /tmp，注入改的都是副本。
  // `node_modules` 用软链 —— pnpm 的 workspace 链接指向真实仓库，不重建就解析不到依赖。
  // `prisma/` 也必须带上：`tests/pricing-ddl.helper.ts` 直接读迁移 SQL，
  // 少了它基线就红 —— 而**基线一红，后面 8 条"必须变红"全都变成空转**。
  // 🔴 `server/scripts` 同样必需：`tests/billing-pricing-store.pglite.spec.ts` 要
  // `import … from '../scripts/pricing'`。少了它，**这 9 条曾经全部是假绿** ——
  // 基线自己就红，"必须变红"的注入于是条条"通过"，实际一个断言都没跑到。
  const probe = prepareProbe(
    'coupon',
    [
      'server/src',
      'server/tests',
      'server/prisma',
      'server/scripts',
      'server/package.json',
      'server/tsconfig.json',
      'server/vitest.config.ts',
    ],
    { links: [['server/node_modules', 'server/node_modules']] },
  );
  const serverProbe = path.join(probe, 'server');
  const inProbe = (abs) => path.join(probe, path.relative(ROOT, abs));
  const MONEY = inProbe(COUPON_MONEY);
  const RULES = inProbe(COUPON_RULES);
  const STORE = inProbe(COUPON_STORE);
  assertCopied(probe, [COUPON_MONEY, COUPON_RULES, COUPON_STORE].map((abs) => path.relative(ROOT, abs)));

  const billingRun = () =>
    run(
      path.join(ROOT, 'server/node_modules/.bin/vitest'),
      ['run', 'tests/billing-money.spec.ts', 'tests/billing-coupon.spec.ts', 'tests/billing-pricing-store.pglite.spec.ts'],
      serverProbe,
    );

  expectGreen('coupon', '基线：券的算术 / 判定 / 持久化三套测试原样必须绿', billingRun);

  // ① 🔴 取整方向：偏向用户 → 偏向我们自己。33.33% off 的 9900 会从 6600 变 6601。
  //    这一改**不会**报任何错，只会每一笔都多收一分钱 —— 正是最该被拦住的那类。
  expectRed('coupon', '把折扣取整从 ceil 改成 floor（每一单多收用户的钱）', () =>
    withMutation(MONEY, 'return Math.ceil((amountMinor * bp) / PERCENT_SCALE);', 'return Math.floor((amountMinor * bp) / PERCENT_SCALE);', billingRun),
  );

  // ② 干掉"折后不可支付"这道闸：0 元单会被放进收银台，然后在支付通道那边失败。
  expectRed('coupon', '去掉"折后为 0 元不可支付"的判定', () =>
    withMutation(RULES, "    return reject('not_chargeable_after_discount');", '    return { ok: true, couponId: coupon.id, discountMinor: discountMinor, finalAmountMinor: 0 };', billingRun),
  );

  // ③ 门槛从闭区间改成开区间：刚好够门槛的那一单会被拒，用户莫名其妙用不了券。
  expectRed('coupon', '最低消费门槛 >= 被改成 >（刚好够门槛的单被拒）', () =>
    withMutation(RULES, 'ctx.originalAmountMinor < coupon.minimumOrderMinor', 'ctx.originalAmountMinor <= coupon.minimumOrderMinor', billingRun),
  );

  // ④ 🔴 预留时的名额判定放宽一格 —— 限量 1 张的券会被发出去 2 张。
  //    这是"报价时算一次、落库时再判一次"里落库那一次的全部价值所在。
  expectRed('coupon', '预留名额时把 >= 改成 >（限量券超发一张）', () =>
    withMutation(STORE, 'if (Number(total[0]?.n ?? 0) >= maxTotal) {', 'if (Number(total[0]?.n ?? 0) > maxTotal) {', billingRun),
  );

  // ⑤ 让 `expired` 也占用名额 —— sweep 就白跑了，限量券会被"点了支付没付款"占满。
  expectRed('coupon', '把 expired 也算进名额（占位刷满限量券）', () =>
    withMutation(STORE, "export const COUNTED_REDEMPTION_STATES: readonly RedemptionState[] = [\n  'reserved',\n  'applied',\n  'reversed',\n];", "export const COUNTED_REDEMPTION_STATES: readonly RedemptionState[] = [\n  'reserved',\n  'applied',\n  'reversed',\n  'expired',\n];", billingRun),
  );

  // ⑥ 让退款归还名额 —— "买 → 退 → 再买"可以无限薅同一份预算。
  expectRed('coupon', '把 reversed 移出名额计数（退款归还名额，可反复薅）', () =>
    withMutation(STORE, "export const COUNTED_REDEMPTION_STATES: readonly RedemptionState[] = [\n  'reserved',\n  'applied',\n  'reversed',\n];", "export const COUNTED_REDEMPTION_STATES: readonly RedemptionState[] = [\n  'reserved',\n  'applied',\n];", billingRun),
  );

  // ⑦ 结算时不再比对订单上冻结的金额 —— ADR-0018 修掉的那个洞会重新打开：
  //    付了原价的人也能白拿券的折扣。
  expectRed('coupon', '结算时不再比对冻结金额（付原价也能白拿折扣）', () =>
    withMutation(STORE, 'if (!isMinorAmount(input.paidAmountMinor) || input.paidAmountMinor !== expectedMinor) {', 'if (false) {', billingRun),
  );

  // ⑧ 让它不再幂等：重复投递的支付事件会被当成第二次授予。
  //
  // 🔴 锚点**只取那一行 `if`**，不要连函数体一起写死。2026-09-27 实测：这个用例
  //    曾长期失效（探针抛「锚点不存在：…already-paid…」）—— 根因是函数体被重新
  //    缩进过一次（`return` 从 6 空格变 4 空格），而旧锚点把缩进一起钉住了。
  //    这一行在 `pricing-store.ts` 里**唯一**（`grep -c` = 1），所以单行就够定位，
  //    也不会再随缩进漂移。风格与上一条（⑦）一致。
  //    ⚠️ 顺带一条值得记住的：探针**没有**静默放过它，而是抛异常报出来 ——
  //    这正是 `withMutation` 先断言锚点存在的原因（空转的注入比没有更坏）。
  expectRed('coupon', '去掉结算的幂等闸（重复投递重复授予）', () =>
    withMutation(STORE, "if (status === 'paid') {", 'if (false) {', billingRun),
  );

  dropProbe('coupon');
}

function groupStorage() {
  const oneRun = () =>
    run(path.join(STORAGE, 'node_modules/.bin/vitest'), ['run', 'tests/storage-error.spec.ts'], STORAGE);
  const allRun = () => run(path.join(STORAGE, 'node_modules/.bin/vitest'), ['run'], STORAGE);
  const webErrorRun = () =>
    run(
      path.join(ROOT, 'apps/web/node_modules/.bin/vitest'),
      ['run', 'tests/error-screen.spec.tsx'],
      path.join(ROOT, 'apps/web'),
    );

  expectGreen('storage', '基线：存储错误测试原样必须绿', allRun);

  // ① 把"被别的标签页阻塞"错报成"打不开" —— 用户从"关掉别的窗口就行"
  //    变成"不知道为什么就是打不开"，而两者都只显示一句笼统的话。
  expectRed('storage', '把 upgrade-blocked 错报成 open-failed', () =>
    withMutation(IDB_ADAPTER, "{ kind: 'upgrade-blocked' }", "{ kind: 'open-failed' }", oneRun),
  );

  // ② 丢掉"一手结构优先" —— 事务体外面那层统一 catch 会把更具体的原因降级成笼统的。
  expectRed('storage', '统一 catch 覆盖掉更具体的原因（编程错误被降级）', () =>
    withMutation(
      IDB_ADAPTER,
      "reject(asStorageError(error, '事务内的操作失败', { kind: 'request-failed' }));",
      "reject(storageError(error, '事务内的操作失败', { kind: 'request-failed' }));",
      oneRun,
    ),
  );

  // ③ 🔴 真实回归：不再往 `cause` 里找驱动原始错误名 → 唯一索引冲突被当成真失败，
  //    「同一 opId 写两次只留一条」的幂等直接坏掉。
  expectRed('storage', '冲突判定不再看驱动原始错误（幂等写入坏掉）', () =>
    withMutation(
      IDB_ADAPTER,
      'const driverError = error instanceof StorageError ? error.cause : error;',
      'const driverError = error;',
      allRun,
    ),
  );

  // ④ 🔴 壳侧：把"被别的标签页挡住"的建议退回通用那句 ——
  //    用户从"关掉别的窗口就行"变成"关掉无痕模式再试"，而后者对他没用。
  expectRed('storage', '崩屏建议不再区分失败原因（退回通用句）', () =>
    withMutation(
      ERROR_HINT,
      "'upgrade-blocked': 'web.error.storage.blockedHint',",
      "'upgrade-blocked': 'web.error.storage.hint',",
      webErrorRun,
    ),
  );

  // ⑤ 🔴 这条钉的是"原文必须降级"：把跨包中文放回建议的位置 = 英文界面又露中文。
  expectRed('storage', '把原始错误文本放回建议位置（英文界面又露中文）', () =>
    withMutation(ERROR_SCREEN, '{t(hintKey)}', '{message}', webErrorRun),
  );

  expectGreen('storage', '全部还原后重跑，必须回到绿', allRun);
}

// ── 组 15：诊断字段（规则 5）──────────────────────────────────────────
//
// 这一组证明的是**规则的形状**，不是那两个文件里曾经写过的两行字：
// 四种注入分别命中「码退回整句中文」「模板字面量拼中文」「换成 detail 字段名」
// 「换一个已迁移的壳」，每一条都必须让门禁变红 —— 少红一条，就说明规则
// 被钉在了某个具体名字或某个具体文件上，下一个壳再写一句中文原因照样会漏。
function groupDiag() {
  expectGreen('diag', '基线：门禁原样必须绿（42 处诊断字段全是码）', gateRun);

  // ① P1-4 修掉的那一类：把码退回整句中文。
  expectRed('diag', 'web 推送：把原因码退回整句中文', () =>
    withMutation(
      PUSH_SUBSCRIBE,
      "reason: 'insecure-context' }",
      "reason: '当前不是安全上下文，推送不可用' }",
      gateRun,
    ),
  );

  // ② 模板字面量：`${...}` 要被剥掉，但剥完之后剩下的必须是码。
  //    这条抓的是"用变量拼句子"的写法 —— 它比裸字符串更像真实事故。
  expectRed('diag', 'web 推送：模板字面量里拼中文句子', () =>
    withMutation(
      PUSH_SUBSCRIBE,
      "reason: 'insecure-context' }",
      "reason: `当前不是安全上下文（${String(window.location.protocol)}）` }",
      gateRun,
    ),
  );

  // ③ 换一个诊断字段名：证明拦的是 reason/detail/cause **这一类**，不是 reason 这一个词。
  expectRed('diag', 'web 推送：同样的句子写进 detail 字段', () =>
    withMutation(
      PUSH_SUBSCRIBE,
      "reason: 'insecure-context' }",
      "detail: '当前不是安全上下文' }",
      gateRun,
    ),
  );

  // ④ 换一个已迁移的壳：证明规则没有钉在 push-subscribe.ts 上。
  //    移动端这条链路（粘贴凭据）界面同样用 t('…', { reason })，漏一点露一点。
  expectRed('diag', '移动端：粘贴失败的原因退回整句中文', () =>
    withMutation(
      MOBILE_PASTE,
      "reason: 'invalid-input' }",
      "reason: '剪贴板里的内容不是有效凭据' }",
      gateRun,
    ),
  );

  expectGreen('diag', '全部还原后重跑，必须回到绿', gateRun);
}

// ── 组 15：出境披露的那句否定，按**词条 key** 查界面真正读的表（P1-6）──
/**
 * `check-ai-coverage.mjs` 的 8c 以前查的是 `packages/ai` 里那句中文兼容句 ——
 * 而它**早就不在任何界面上了**（`AiDisclosure` 渲染的是 `web.ai.disclosure.e2ee*`）。
 * 于是"把界面上的『不受端到端加密保护』改成『受端到端加密保护』"这件 ADR-0006
 * 明令禁止的事，旧门禁照样绿。现在它读的是产物里真正被渲染的那两份表。
 *
 * 🔴 改坏的必须是被查的对象，不是查它的那段代码，所以两条词条注入打在
 * `packages/i18n/dist/` 的**产物**上（8c `import()` 的就是它，未跟踪的构建产物）。
 * 产物文件名不写死（见 `I18N_DIST_DIR` 上面的注释），锚点必须写成 esbuild 的
 * `\uXXXX` 转义形式，而且**必须带上值** —— 只写 key 会同时命中 en 与 zh 两个
 * chunk（同一个 key 在两份表里都出现），那会让探针抛「锚点有 2 处」而不是变红。
 *
 * 第三条打的是门禁自己的登记表：证明**「新语言必须为这句话做一次真判断」真的会红**。
 * 这是日/韩就绪的其中半边 —— 没有它，加第三门语言可以什么都不做就通过。
 */
function groupE2eeCopy() {
  const coverageRun = () => run(NODE_BIN, [AI_COVERAGE]);

  expectGreen('e2eecopy', '基线：门禁原样必须绿（两份表都通过）', coverageRun);

  const ZH_STRONG = String.raw`"web.ai.disclosure.e2eeStrong": "\u4E0D\u53D7\u7AEF\u5230\u7AEF\u52A0\u5BC6\u4FDD\u62A4\u3002"`;
  const ZH_FLIPPED = String.raw`"web.ai.disclosure.e2eeStrong": "\u53D7\u7AEF\u5230\u7AEF\u52A0\u5BC6\u4FDD\u62A4\u3002"`;
  expectRed('e2eecopy', 'zh 去掉否定：「不受端到端加密保护」→「受端到端加密保护」', () =>
    withMutation(i18nDistFileWith(ZH_STRONG), ZH_STRONG, ZH_FLIPPED, coverageRun),
  );

  const EN_STRONG = '"web.ai.disclosure.e2eeStrong": "not protected by end-to-end encryption."';
  // key 改名 = 词条表里"没有这一条"的产物形状。界面取到 `undefined`，
  // 那句否定**整条从披露里消失** —— 比改措辞更隐蔽，因为它什么都不说。
  expectRed('e2eecopy', 'en 的 key 改名（披露里不再有那句否定）', () =>
    withMutation(
      i18nDistFileWith(EN_STRONG),
      EN_STRONG,
      EN_STRONG.replace('e2eeStrong', 'e2eeStrongRenamed'),
      coverageRun,
    ),
  );

  // 把 `E2EE_COPY_RULES` 里 en 那一行登记拿掉：表还在、词条还在，但没人判断过它。
  const EN_RULE = String.raw`  en: { term: /end[-\s]?to[-\s]?end encrypt/i, negation: /\b(?:not|never)\b/i },
`;
  expectRed('e2eecopy', '把 en 从 `E2EE_COPY_RULES` 里拿掉（新语言必须登记）', () =>
    withMutation(AI_COVERAGE, EN_RULE, '', coverageRun),
  );

  expectGreen('e2eecopy', '全部还原后重跑，必须回到绿', coverageRun);
}

const GROUPS = {
  gate: groupGate,
  catalog: groupCatalog,
  recurrence: groupRecurrence,
  disclosure: groupDisclosure,
  conflict: groupConflict,
  landing: groupLanding,
  scene: groupScene,
  storage: groupStorage,
  sync: groupSync,
  preference: groupPreference,
  preset: groupPreset,
  aifailure: groupAiFailure,
  pricing: groupPricing,
  coupon: groupCoupon,
  diag: groupDiag,
  e2eecopy: groupE2eeCopy,
};
const only = process.argv[2];
const names = only === undefined ? Object.keys(GROUPS) : [only];
for (const name of names) {
  const group = GROUPS[name];
  if (group === undefined) throw new Error(`没有这一组：${name}（可选：${Object.keys(GROUPS).join(' / ')}）`);
  group();
}

console.log('故障注入验证 —— 每一行都是"改坏一处 → 对应检查必须变红"：\n');
let lastGroup = '';
for (const r of results) {
  if (r.group !== lastGroup) {
    console.log(`\n【${r.group}】`);
    lastGroup = r.group;
  }
  console.log(`${r.ok ? '✅' : '❌'} ${r.name}  （退出码 ${String(r.code)}）`);
  if (!r.ok) {
    const tail = r.out.trim().split('\n').slice(-6).join('\n    ');
    console.log(`    ↑ 期望${r.group === 'recurrence' || r.name.startsWith('基线') ? '0' : '非零'}，实际不是。输出尾部：\n    ${tail}`);
  }
}
const bad = results.filter((r) => !r.ok).length;
console.log(
  bad === 0
    ? `\n✅ ${String(results.length)} 个用例全部符合预期：该绿的绿、该红的红。`
    : `\n🔴 ${String(bad)}/${String(results.length)} 个用例不符合预期 —— 上面每一条 ❌ 都意味着对应的检查**没有在保护它声称保护的东西**。`,
);
process.exitCode = bad === 0 ? 0 : 1;