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
 * ⚠️ 这个脚本会**临时修改工作区里的文件**并还原。它不碰 git、不 commit。
 * 别在别的进程正改同一批文件时跑它 —— `withMutation` 会拒绝覆盖别人的改动并直接报错。
 */

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const NODE_BIN = path.join(path.dirname(process.execPath), 'node');

const GATE = path.join(ROOT, 'scripts/check-ui-language.mjs');
const ZH = path.join(ROOT, 'packages/i18n/src/locales/zh-CN.ts');
const EN = path.join(ROOT, 'packages/i18n/src/locales/en.ts');
const I18N_DIST = path.join(ROOT, 'packages/i18n/dist/index.js');
const MOBILE = path.join(ROOT, 'apps/mobile');
const MOBILE_PROBE = '/tmp/heyta-i18n-probe/apps/mobile';
const AI = path.join(ROOT, 'packages/ai');
const AI_SUPPLY = path.join(AI, 'src/supply.ts');
const AI_HEALTH = path.join(AI, 'src/health-store.ts');
const SYNC_CLIENT = path.join(ROOT, 'packages/sync-client');
const SC_CLIENT = path.join(SYNC_CLIENT, 'src/client.ts');
const SYNC_FAILURE_COPY = path.join(ROOT, 'apps/web/src/features/sync/sync-failure-copy.ts');
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
const STORAGE = path.join(ROOT, 'packages/storage');
const IDB_ADAPTER = path.join(STORAGE, 'src/indexeddb/indexeddb-adapter.ts');
const ERROR_HINT = path.join(ROOT, 'apps/web/src/features/shell/error-hint.ts');
const ERROR_SCREEN = path.join(ROOT, 'apps/web/src/features/shell/ErrorScreen.tsx');
const HEALTH_COPY = path.join(ROOT, 'apps/web/src/features/settings/health-copy.ts');

/** 跑一条命令，返回退出码与合并输出。**不抛错** —— 非零退出就是被测的结果。 */
function run(bin, args, cwd = ROOT) {
  try {
    const out = execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
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
  const now = readFileSync(file, 'utf8');
  if (now !== mutated) {
    console.error(
      `\n🔴 ${why}：${path.relative(ROOT, file)} 在注入期间被**别的进程**改过，拒绝还原。\n` +
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
  console.error(`\n⚠️ ${why}：已还原 ${path.relative(ROOT, file)}。`);
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
    throw new Error(`注入失败（锚点不存在）：${path.relative(ROOT, file)}\n  锚点：${from}`);
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
        `拒绝还原：${path.relative(ROOT, file)} 在探针运行期间被别的进程改过。` +
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
  rmSync('/tmp/heyta-i18n-probe', { recursive: true, force: true });
  mkdirSync(MOBILE_PROBE, { recursive: true });
  for (const item of ['src', 'tests', 'package.json', 'tsconfig.json']) {
    cpSync(path.join(MOBILE, item), path.join(MOBILE_PROBE, item), { recursive: true });
  }
  symlinkSync(path.join(MOBILE, 'node_modules'), path.join(MOBILE_PROBE, 'node_modules'), 'dir');
  cpSync(path.join(ROOT, 'tsconfig.base.json'), '/tmp/heyta-i18n-probe/tsconfig.base.json');
  return path.join(MOBILE_PROBE, 'src/lib/recurrence-display.ts');
}

function groupRecurrence() {
  const display = prepareMobileProbe();
  const real = readFileSync(path.join(MOBILE, 'src/lib/recurrence-display.ts'), 'utf8');
  if (readFileSync(display, 'utf8') !== real) throw new Error('探针副本与真实源码不一致');

  const spec = path.join(MOBILE_PROBE, 'tests/recurrence-display.spec.ts');
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
   */
  const ZH_DAILY = String.raw`"mobile.recurrence.daily": "\u6BCF\u5929"`;
  expectRed('recurrence', 'zh 词条「每天」→「每日」（一个字之差）', () =>
    withMutation(I18N_DIST, ZH_DAILY, String.raw`"mobile.recurrence.daily": "\u6BCF\u65E5"`, mobileRun),
  );
  expectRed('recurrence', 'en 词条漏出中文（every day → 每天）', () =>
    withMutation(
      I18N_DIST,
      '"mobile.recurrence.daily": "every day"',
      String.raw`"mobile.recurrence.daily": "\u6BCF\u5929"`,
      mobileRun,
    ),
  );

  expectGreen('recurrence', '全部还原后重跑，必须回到绿', mobileRun);
  rmSync('/tmp/heyta-i18n-probe', { recursive: true, force: true });
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
      '<link rel="canonical" href="https://heyta.finlaw.cloud/en/" />',
      '<link rel="canonical" href="https://heyta.finlaw.cloud/" />',
      seoRun,
    ),
  );

  // ③ hreflang 标签写错（`en-US` 不是我们声明的 `en`）—— 三件套少一件。
  expectRed('landing', 'hreflang 标签写成 en-US（三件套缺一件）', () =>
    withMutation(
      LANDING_ZH,
      '<link rel="alternate" hreflang="en" href="https://heyta.finlaw.cloud/en/" />',
      '<link rel="alternate" hreflang="en-US" href="https://heyta.finlaw.cloud/en/" />',
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
 *   2. **web 壳**按 reason 取词条；
 *   3. **移动端壳**同样按 reason 取词条（它原来更糟：整句丢掉，只剩"同步失败"）。
 */
function groupSync() {
  const syncRun = () => run(path.join(SYNC_CLIENT, 'node_modules/.bin/vitest'), ['run'], SYNC_CLIENT);
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
  /** 三条一起跑：注入点在三个不同的包里，还原后三个都得回绿。 */
  const allRun = () => {
    for (const r of [syncRun, webSyncRun, mobileSyncRun]) {
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

  // ② web 壳：两条不同的失败指到同一条词条 —— 英文界面会给出**错的**下一步。
  expectRed('sync', 'web 壳把两种失败指到同一条词条', () =>
    withMutation(
      SYNC_FAILURE_COPY,
      "  'no-encryption-password': 'common.sync.error.noPassword',",
      "  'no-encryption-password': 'common.sync.error.notConfigured',",
      webSyncRun,
    ),
  );

  // ③ 移动端壳：不再区分原因，全都退回"同步失败"（迁移前的行为）。
  expectRed('sync', '移动端不再区分原因（全退回"同步失败"）', () =>
    withMutation(
      MOBILE_STATUS_TEXT,
      ": t(SYNC_FAILURE_KEY[status.reason]);",
      ": t('mobile.sync.error');",
      mobileSyncRun,
    ),
  );

  expectGreen('sync', '全部还原后三条一起重跑，必须回到绿', allRun);
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