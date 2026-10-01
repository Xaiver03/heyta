/**
 * 变异验证：`tests/legal-pages.spec.ts` 会不会失败
 * ==============================================
 *
 * 依据 AGENTS.md §8「不能失败的检查没有价值」与设计系统门禁同样的做法：
 * **注入违规 → 断言那条判据报红 → 还原 → 断言回到全绿**。
 *
 * 六个变异各对应一类**真实会发生的漏法**，不是编的对抗样本：
 *
 *   M1 从注册表里删掉一份法律页面    —— 「@heyta/legal 里有，站点上没有」
 *   M2 `legalDocId` 拼错一个字母      —— 挂了一份不存在的文件
 *   M3 改 `path`                      —— 已经把 URL 发出去了还顺手缩短
 *   M4 `inFooter: false`              —— 页面在、导航里没有 ⇒ 只能手打地址
 *   M5 组件登记改成别的组件            —— 一份法律承诺用营销页外壳渲染
 *   M6 手改一条投影出来的词条          —— `<title>` 说的与正文不是一版
 *
 * M6 顺带交叉验证 `gen-site-copy.mjs --check` 对同一次改动也报红
 * （两处必须同时红，否则"生成物 + 门禁"这条链有一半是装饰）。
 *
 * ⚠️ 这个脚本会**临时改写工作树里的源码**。串行跑（不并发），每一处都在
 * `finally` 里按内存里的原文还原；跑之前先证明基线是绿的 ——
 * 基线本来就红的话，"变异后红了"什么都证明不了。
 *
 * 用法：`node apps/landing/tests/mutate-legal-gate.mjs`
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(APP, '../..');

const PAGES = resolve(APP, 'src/site/pages.ts');
const COMPONENTS = resolve(APP, 'src/pages/index.ts');
const I18N_ZH = resolve(REPO, 'packages/i18n/src/locales/zh-CN.ts');

const SPEC = 'tests/legal-pages.spec.ts';
const read = (p) => readFileSync(p, 'utf8');

/**
 * 🔴 共享工作树里的并发写入闸门。
 *
 * 本脚本会临时改写 `pages.ts` / `pages/index.ts` / `locales/zh-CN.ts`，而这三份
 * 文件此刻**另有其人在改**（`/help` → `/docs` 那条改名）。如果还原时只是一味
 * 把开场备份写回去，就会**静默盖掉别人在这几秒里写进去的内容** ——
 * 那种事故在 `git status` 里看不出来，因为文件仍然"是改过的"。
 *
 * 所以每次还原前先看一眼"现在磁盘上的字节 == 我上一次写进去的字节吗"：
 * 不相等就说明有人在中间动过，**立刻停手、不写盘**，把冲突报出来。
 */
const ORIGINALS = new Map();
const LAST_WRITTEN = new Map();

const backup = (p) => {
  if (!ORIGINALS.has(p)) ORIGINALS.set(p, read(p));
};
const write = (p, text) => {
  backup(p);
  writeFileSync(p, text, 'utf8');
  LAST_WRITTEN.set(p, text);
};
const patch = (p, from, to) => {
  const text = read(p);
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`锚点命中 ${String(count)} 次（期望 1）：${from.slice(0, 60)}`);
  write(p, text.replace(from, to));
};
const restoreAll = () => {
  for (const [p, text] of ORIGINALS) {
    const current = read(p);
    const expected = LAST_WRITTEN.get(p);
    if (current !== expected) {
      throw new Error(
        `检测到并发写入：${p} 磁盘内容与我写进去的字节不一致。\n` +
          '本脚本**不会**覆盖别人刚写的内容 —— 请确认没有别的会话在改这三份文件后重跑。',
      );
    }
    writeFileSync(p, text, 'utf8');
    LAST_WRITTEN.delete(p);
  }
  ORIGINALS.clear();
  LAST_WRITTEN.clear();
  build('i18n');
};

function build(what) {
  execFileSync('pnpm', ['--filter', `@heyta/${what}`, 'build'], { cwd: REPO, stdio: 'pipe' });
}

/**
 * 跑判据。返回 `{ red, text }`。
 *
 * ⚠️ 用**默认 reporter**而不是 `--reporter=json`：json reporter 要 `--outputFile`
 * 才稳定落到文件，而默认 reporter 的输出里有 `FAIL … > 用例名` 这种整行，
 * 拿"needle 是否出现在输出里"判"哪条判据抓到的"直接得多，也不需要第二套解析器。
 */
function runSpec() {
  try {
    const out = execFileSync('npx', ['vitest', 'run', SPEC, '--reporter=dot'], {
      cwd: APP,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
    return { red: false, text: out.toString() };
  } catch (error) {
    return { red: true, text: String(error.stdout ?? '') + String(error.stderr ?? '') + String(error.message ?? '') };
  }
}

function failingTitles(text) {
  return text
    .split('\n')
    .filter((line) => line.includes('FAIL') && line.includes('>'))
    .map((line) => line.slice(line.lastIndexOf('> ') + 2).trim());
}

function expectRed(label, needle, mutate) {
  mutate();
  const { red, text } = runSpec();
  const hit = failingTitles(text).find((title) => title.includes(needle));
  if (hit === undefined) {
    // 🔴 "红了"不等于"这条判据抓到的"。整文件加载失败也是非零退出，
    // 那种红什么都不是 —— 它下一次会因为别的原因不红。
    const other = red ? `进程红了，但报红的用例里没有「${needle}」。实际红的是：${failingTitles(text).join(' | ') || '（没有 FAIL 行 ⇒ 很可能是加载期崩溃，见下）'}` : '完全没红 —— 这条判据是装饰';
    throw new Error(`❌ ${label}：${other}\n${text.slice(-1200)}`);
  }
  console.log(`✓ ${label}\n    ⇒ 报红的是：${hit}`);
}

const PRIVACY_DOCID = "    legalDocId: 'privacy',";
const TERMS_PATH = "    path: '/legal/terms',";
const MINORS_FOOTER = "    id: 'legal-minors',\n    path: '/legal/minors',\n    group: 'legal',\n    inNav: false,\n    inFooter: true,";

const MUTATIONS = [
  {
    label: 'M1 删掉一份法律页面（@heyta/legal 里有、站点上没有）',
    needle: '数量相等',
    run: () => {
      const text = read(PAGES);
      // 🔴 从 `  {` 那一行开始删，删到 `  },` 那一行结束。
      //    原来这里从 `id:` 那行开始删，留下了一个光秃秃的 `{` ——
      //    于是 vitest 是**加载期语法错误**红的，不是判据红的，
      //    而这两种红在"退出码非零"上长得一模一样（本文件的 `expectRed` 专门拦这种冒名）。
      const start = text.indexOf(`  {\n    id: 'legal-minors',`);
      if (start < 0) throw new Error('找不到 legal-minors 那条注册项');
      const end = text.indexOf('  },\n', start);
      if (end < 0) throw new Error('找不到 legal-minors 那条注册项的结尾');
      write(PAGES, text.slice(0, start) + text.slice(end + 6));
    },
  },
  {
    label: 'M2 legalDocId 拼错一个字母（挂了一份不存在的文件）',
    needle: '取得到',
    run: () => patch(PAGES, PRIVACY_DOCID, "    legalDocId: 'privacys',"),
  },
  {
    label: 'M3 改 path（把已经发出去的 URL 顺手缩短）',
    needle: 'path 就是',
    run: () => patch(PAGES, TERMS_PATH, "    path: '/legal/tos',"),
  },
  {
    label: 'M4 inFooter: false（页面在，但没有任何地方链得到）',
    needle: 'path 就是',
    run: () =>
      patch(PAGES, MINORS_FOOTER, MINORS_FOOTER.replace('inFooter: true', 'inFooter: false')),
  },
  {
    label: 'M5 组件登记改成别的组件（法律承诺用营销页外壳渲染）',
    needle: '组件登记的就是法律文本组件',
    run: () => patch(COMPONENTS, "  'legal-minors': LegalDocumentPage,", "  'legal-minors': FeaturesPage,"),
  },
  {
    label: 'M6 手改一条投影出来的词条（<title> 与正文不是一版）',
    needle: '四条都等于投影',
    run: () => patch(I18N_ZH, '  "site.legal.permissions.title": "应用权限清单",', '  "site.legal.permissions.title": "权限",'),
    after: () => build('i18n'),
    // M6 还要求生成器的 --check 对同一次改动也报红 —— 两处同时红，这条链才算闭合。
    crossCheck: () => {
      let red = false;
      try {
        execFileSync('node', ['packages/legal/scripts/gen-site-copy.mjs', '--check'], {
          cwd: REPO,
          stdio: 'pipe',
        });
      } catch {
        red = true;
      }
      if (!red) throw new Error('❌ M6：手改词条之后 gen-site-copy --check 仍然报绿 —— 那它是装饰');
      console.log('✓ M6 交叉验证：gen-site-copy.mjs --check 对同一次改动也报红');
    },
  },
];

console.log('基线：先确认判据本来是绿的 …');
const baseline = runSpec();
if (baseline.red) {
  throw new Error(
    `基线就是红的（${failingTitles(baseline.text).join(' | ') || '加载期崩溃'}），变异验证无意义。\n${baseline.text.slice(-1500)}`,
  );
}
console.log('基线全绿。\n');

try {
  for (const m of MUTATIONS) {
    expectRed(m.label, m.needle, () => {
      m.run();
      m.after?.();
    });
    m.crossCheck?.();
    restoreAll();
    const back = runSpec();
    if (back.red) throw new Error(`还原后没有回到全绿：${failingTitles(back.text).join(' | ')}`);
  }
  console.log('\n结论：6 条变异全部被抓到，还原后判据回到全绿。');
} finally {
  try {
    restoreAll();
    console.log('工作树已还原。');
  } catch (error) {
    // 🔴 这里不能只把错误抛出去就完事 —— 那意味着变异还留在源码里，
    // 而下一个人跑 `pnpm check` 看到的红与本脚本的红完全不同，归因会错一整天。
    console.error(String(error.message ?? error));
    console.error('⚠️ 上面那处改动**没有**被本脚本覆盖还原。请人工核对这三份文件：');
    for (const p of [PAGES, COMPONENTS, I18N_ZH]) console.error(`   ${p}`);
    process.exitCode = 1;
  }
}
