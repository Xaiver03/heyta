#!/usr/bin/env node
/* 公开站点的重发布装置（落地页 + 应用本体）—— 把 `docs/runbooks/deployment.md` §3.7 那三条命令
 * 和"站点先发、发前对账、发后验收"这套顺序固化成一条**默认不动手**的命令。
 *
 * ## 为什么要有它（不是图省事）
 *
 * 本批改了对外文案（G-40③④⑤⑥、G-51 那句「可安装」、§8.27 那四处元数据抄件），而
 * **词条只有随构建产物发出去才对外可见** —— 于是"停掉对外错话"这半件事，唯一的关闭动作就是重发一次。
 * 问题是这件事**手工做过两次**，而每一次都要现场回忆同样的五件事：
 *   ① 从哪棵树发（必须正好是 `main`，不能是我这棵工作树的瞬时状态）
 *   ② 两个站点都要 `build`，且**挂载路径必须显式给**（`HEYTA_WEB_BASE=/app/`；不给就是根绝对路径，
 *      挂在 `/app/` 下会去请求落地页的资源、拿回 HTML 而不是样式表）
 *   ③ 发之前要对账产物（`check:web-artifact:app` + `verify-landing-dist.mjs`）——
 *      本仓库栽过两次"命令退出码 0 而产物引用不存在的东西"（§7 第 82 条、deployment §3.7）
 *   ④ 远端要先备份（`rsync --delete` 是把目标目录**改成**源目录）
 *   ⑤ 站点先发、应用后发（反过来的话，中间那一分钟里落地页的入口指向还没换过去的旧应用）
 * 这五条只要漏一条，产出的都是一个**看起来成功**的对外状态。手抄的命令还一定会漂（本档 §8.143 那条
 * 就是"抄一句会漂的话"烧掉的）。所以把顺序写进代码，把"要不要真的发"留给人。
 *
 * ## 默认是 dry-run
 *
 * 🔴 发布是对外动作，**不由这条脚本自己决定**：不带 `--confirm` 时它只做只读的守卫读数并把
 * 将要执行的每一条原样打出来。`--confirm` 才真的 build / 备份 / rsync / 验收。
 * 它也不在这里发服务端镜像（那仍然是没拍板的一件事，见 G-55）。
 *
 * ## 用法
 *
 *   node research/tools/publish-public-sites.mjs                 # 体检 + 打印将执行的每一条（不动手）
 *   node research/tools/publish-public-sites.mjs --confirm       # 真的发（需要人明确授权）
 *   node research/tools/publish-public-sites.mjs --selftest      # 顺序与守卫的臂：每条都写明凭什么会红
 *   node research/tools/publish-public-sites.mjs --mutation      # 把上面那些臂各打红一次（11 条变异腿，含未变异对照）
 *   HEYTA_PUBLISH_REF=main HEYTA_SSH_HOST=ubuntu-jcli HEYTA_SITE_DOMAIN=… 覆盖默认值
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REF = process.env.HEYTA_PUBLISH_REF || 'main';
const HOST = process.env.HEYTA_SSH_HOST || 'ubuntu-jcli';
const DOMAIN = process.env.HEYTA_SITE_DOMAIN || 'heyta.waytofuture.cn';
const APP_URL = `https://${DOMAIN}/app/`;
const LANDING_DIST = 'apps/landing/dist';
const WEB_DIST = 'apps/web/dist';
/** 参与这两次构建的**输入**目录：它们脏 = 要发的字节不等于 `<REF>` 的提交物。 */
const INPUT_PATHS = ['apps/landing', 'apps/web', 'packages', 'server/public'];

const git = (args, cwd = ROOT) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/**
 * 守卫读数。**每一条都必须是量出来的**，读不出来就按"不成立"处理 ——
 * 这条脚本的立场与 `selfhost-land-main.mjs` 一样：宁可拒绝，也不发一个说不清来源的产物。
 * @returns {{ok:boolean, fails:string[], readings:string[], headSha:string, refSha:string}}
 */
export function guardReadings(g = git, root = ROOT) {
  const fails = [];
  const readings = [];
  let headSha = '';
  let refSha = '';
  try {
    headSha = g(['rev-parse', 'HEAD']);
    refSha = g(['rev-parse', REF]);
  } catch (e) {
    return { ok: false, fails: [`git 读不到 HEAD 或 ${REF}：${String(e.message).slice(0, 80)}`], readings, headSha, refSha };
  }
  readings.push(`HEAD=${headSha.slice(0, 8)} · ${REF}=${refSha.slice(0, 8)}`);
  if (headSha !== refSha) {
    fails.push(`HEAD 不等于 ${REF} ⇒ 要发的是**提交物**，不是这棵树现在的样子（差的这一截没进 ${REF}）`);
  }
  let dirty = [];
  try {
    dirty = g(['status', '--porcelain', '--', ...INPUT_PATHS]).split('\n').filter((l) => l.trim() !== '');
  } catch (e) {
    fails.push(`工作树状态读不出来：${String(e.message).slice(0, 80)}`);
  }
  readings.push(`构建输入（${INPUT_PATHS.join(' / ')}）脏条目 ${dirty.length} 条`);
  if (dirty.length) {
    fails.push(`构建输入有未提交改动 ⇒ 发出去的字节不等于 ${REF} 的那一笔：\n     ${dirty.slice(0, 8).join('\n     ')}`);
  }
  for (const p of [join(root, 'research/tools/verify-landing-dist.mjs'), join(root, 'scripts/check-web-artifact.mjs')]) {
    if (!existsSync(p)) fails.push(`发布链要用的判据文件不在树上：${p}`);
  }
  return { ok: fails.length === 0, fails, readings, headSha, refSha };
}

/**
 * 要执行的每一条（纯函数 ⇒ 顺序本身是可被臂断言的对象，而不是"我记得是这样"）。
 * 返回的每一项都是 **argv 数组**，不是拼好的 shell 串 —— 路径里有空格也不会被拆开。
 */
export function planSteps(o = { ref: REF, host: HOST, domain: DOMAIN, appUrl: APP_URL }) {
  return [
    {
      label: '1/9 落地页入口页与烘焙域名对账（红 ⇒ 先跑 gen 并提交，别发未提交的产物）',
      argv: ['pnpm', '--filter', '@heyta/landing', 'check:entries'],
    },
    {
      label: '2/9 构建落地页（VITE_APP_URL 决定「立即使用」那条入口在不在，不给就整条不渲染）',
      argv: ['pnpm', '--filter', '@heyta/landing', 'build'],
      env: { VITE_SITE_URL: `https://${o.domain}`, VITE_APP_URL: o.appUrl },
    },
    {
      label: '3/9 构建应用本体（🔴 必须显式给挂载路径；默认 base=/ 会让 /app/ 下拿回 HTML 而不是样式表）',
      argv: ['pnpm', '--filter', '@heyta/web', 'build'],
      env: { HEYTA_WEB_BASE: '/app/' },
    },
    {
      label: '4/9 产物对账：应用声明的挂载路径必须等于我们真要放的位置',
      argv: ['node', 'scripts/check-web-artifact.mjs', '--mount', '/app/', '--dist', 'apps/web/dist'],
    },
    {
      label: '5/9 产物自洽：入口页齐 / index.html 引的本地资源都在 / 域名对账 / 现行句钉在自己那一篇',
      argv: ['node', 'research/tools/verify-landing-dist.mjs', 'apps/landing/dist', o.domain],
    },
    {
      label: '6/9 远端先备份（下面两条 rsync 都带 --delete，它是"把目标改成源"而不是"补上去"）',
      argv: ['ssh', o.host, 'tar', 'czf', `/tmp/heyta-public-backup-$(date +%Y%m%d-%H%M%S).tgz`, '-C', '/var/www', 'heyta-landing', 'heyta-app'],
    },
    {
      label: '7/9 发落地页（**站点先发**：反过来会有一分钟落地页入口指着还没换过去的应用）',
      argv: ['rsync', '-az', '--delete', `${LANDING_DIST}/`, `${o.host}:/var/www/heyta-landing/`],
    },
    {
      label: '8/9 发应用本体',
      argv: ['rsync', '-az', '--delete', `${WEB_DIST}/`, `${o.host}:/var/www/heyta-app/`],
    },
    {
      label: '9/9 线上验收（真浏览器 + 真 TLS；这一条读的是**发出去之后**的公开产物）',
      argv: ['pnpm', '--dir', 'e2e', 'exec', 'playwright', 'test', '--config', 'playwright.live-site.config.ts'],
    },
  ];
}

/* ── 自检：顺序与守卫都要能被臂打红 ──────────────────────────────────── */
/** 按 **argv 形状**找步号，不按散文标签：标签会重写、会翻译，顺序才是被判的东西。
 *  🔴 返回 -1 时**不能**当成"排在前面" —— 找不到就是判不出来，必须响亮地红。 */
const idx = (steps, pred) => steps.findIndex(pred)
const findIdx = (name, at) => {
  if (at >= 0) return at;
  throw new Error(`臂 ${name} 的前提没了：argv 形状里找不到那一步（步骤被改名不等于被删，先看清再改这条臂）`);
};
const isBuild = (s) => s.argv[1] === '--filter' && s.argv.includes('build');
const isWebBuild = (s) => isBuild(s) && s.argv.includes('@heyta/web');
const isLandingBuild = (s) => isBuild(s) && s.argv.includes('@heyta/landing');
const isEntries = (s) => s.argv.includes('check:entries');
const isRsync = (s) => s.argv[0] === 'rsync';
const isBackup = (s) => s.argv[0] === 'ssh' && s.argv.includes('tar');
const isAppCheck = (s) => s.argv[1] === 'scripts/check-web-artifact.mjs';
const isLandingCheck = (s) => s.argv[1] === 'research/tools/verify-landing-dist.mjs';
const rsyncDest = (s) => s.argv.filter((a) => !a.startsWith('-') && a !== 'rsync')[1];

export function publishArms() {
  const arms = [];
  const push = (name, expect, got) => arms.push({ name, expect, got });
  const steps = planSteps();
  const at = (pred) => steps.findIndex(pred);
  // 🔴 每条臂都**按形状找那一步**，不按下标：按下标写的话，中间插一步会让臂读到一个
  //    没有 `.env` 的对象并**抛异常**（响亮，但整份读数就没了）。形状查找则继续报"哪几条红了"。
  const buildIdxs = steps.map((s, i) => (isBuild(s) ? i : -1)).filter((i) => i >= 0);
  const rsyncIdxs = steps.map((s, i) => (isRsync(s) ? i : -1)).filter((i) => i >= 0);
  const webBuild = steps.find(isWebBuild);
  const landingBuild = steps.find(isLandingBuild);

  push('control 九条一步不少，且最后一条是线上验收', 9, steps.length);
  push('P1 入口对账必须排在**构建之前**（红就不该发）', true,
    at(isEntries) >= 0 && buildIdxs.length > 0 && at(isEntries) < Math.min(...buildIdxs));
  push('P2 两条构建之间不许插 rsync（rsync 全在最后三条）', true,
    buildIdxs.length === 2 && rsyncIdxs.length === 2 && Math.min(...rsyncIdxs) > Math.max(...buildIdxs));
  push('P3 应用构建必须显式带 HEYTA_WEB_BASE=/app/（不给就是根绝对路径，线上拿回 HTML）', '/app/',
    webBuild?.env?.HEYTA_WEB_BASE);
  push('P4 落地页构建必须带 VITE_APP_URL（未配置时整条入口不渲染，这是故意的）', true,
    landingBuild?.env?.VITE_APP_URL === APP_URL && String(landingBuild.env.VITE_SITE_URL).includes(DOMAIN));
  // 🔴 这两条判据各钉一个真实事故：产物对账排在 rsync 之后 = 发完才发现引用不存在的东西；
  //    备份排在 rsync 之后 = `--delete` 把上一版删干净了才想起来没备份。
  push('P5 两次产物判据都在第一条 rsync **之前**', true,
    [findIdx('P5-应用', idx(steps, isAppCheck)), findIdx('P5-落地页', idx(steps, isLandingCheck))]
      .every((at) => at < findIdx('P5-rsync', idx(steps, isRsync))));
  push('P6 备份必须排在任何 rsync 之前', true,
    findIdx('P6-备份', idx(steps, isBackup)) < findIdx('P6-rsync', idx(steps, isRsync)));
  push('P7 站点先发、应用后发（按 rsync 的目标目录判，不按标签）', 'heyta-landing,heyta-app',
    steps.filter(isRsync).map((s) => rsyncDest(s).match(/heyta-\w+/)?.[0] ?? '?').join(','));
  // 🔴 这两条各钉一个真实事故：少 `--delete` 会留下上一版没被替换的旧 chunk（§7 第 175 条：
  //    Windows 那侧 26 vs 本地 7 就是这么来的）；源目录不带尾斜杠则会把目录本身嵌进去。
  push('P8 两条 rsync 都带 --delete，且第 1 条实参是本地 dist/、第 2 条是 <主机>:/var/www/…/', 2,
    steps.filter((s) => {
      if (s.argv[0] !== 'rsync' || !s.argv.includes('--delete')) return false;
      const dirs = s.argv.filter((a) => !a.startsWith('-') && a !== 'rsync');
      return dirs.length === 2 && /\/$/.test(dirs[0]) && dirs[1].startsWith(`${HOST}:`) && /\/var\/www\/heyta-/.test(dirs[1]);
    }).length);
  // 🔴 这条是**形状**唯一的牙：实测 M6（把一步的 argv 换成一个 shell 串）只红 P9，
  //    P1 那些用 `argv.includes(...)` 的顺序臂**跟着绿** —— 字符串上 includes 同样为真。
  push('P9 没有一条是拼好的 shell 串（argv 数组 ⇒ 路径里的空格不会被拆）', true,
    steps.every((s) => Array.isArray(s.argv) && s.argv.every((a) => typeof a === 'string')));
  push('P10 线上验收排最后（它读的是发出去之后的公开产物，不是本机目录）', true,
    steps[steps.length - 1].argv.includes('playwright') &&
      steps[steps.length - 1].argv.includes('playwright.live-site.config.ts'));

  // 🔴 下面三条判的是"对账对象对不对"，不是"顺序对不对"：顺序全对但判据读的是另一份产物，
  //    正是 §7 第 82 条那个形状（本地与远端拿着同一份错产物互相对账，两边都绿）。
  const flag = (s, name) => {
    const i = s.argv.indexOf(`--${name}`);
    return i < 0 ? undefined : s.argv[i + 1];
  };
  const appCheckStep = steps.find(isAppCheck);
  const landingCheckStep = steps.find(isLandingCheck);
  const rsyncSteps = steps.filter(isRsync);
  const rsyncSrc = (s) => s.argv.filter((a) => !a.startsWith('-') && a !== 'rsync')[0];
  push('P16 构建给的挂载路径 == 产物对账判的那个挂载（不一致 = 判据判的不是这个产物）', true,
    !!webBuild && !!appCheckStep && webBuild.env.HEYTA_WEB_BASE === flag(appCheckStep, 'mount'));
  const appRsync = rsyncSteps.find((s) => /heyta-app\/$/.test(rsyncDest(s) ?? ''));
  // ⚠️ 尾斜杠两边**本来就该不同**（rsync 不带尾斜杠会把目录本身嵌进去，P8 判它；判据脚本收的是目录名）。
  //    所以这条臂比的是"同一个目录"，不是"同一个字符串" —— 拿字符串直接比会恒假，比改成不判更糟。
  const dirOf = (p) => String(p).replace(/\/+$/, '');
  push('P17 产物对账判的 dist == 真正 rsync 到 heyta-app 的那个目录', true,
    !!appCheckStep && !!appRsync && dirOf(rsyncSrc(appRsync)) === dirOf(flag(appCheckStep, 'dist')));
  push('P18 落地页判据读的是落地页自己的 dist 和同一个域名', true,
    !!landingCheckStep && landingCheckStep.argv[2] === LANDING_DIST && landingCheckStep.argv[3] === DOMAIN);

  /* 🔴 本脚本的命令是 `docs/runbooks/deployment.md` §3.7 那一节的**第二份抄件**（抄件一定会漂）。
   *    留两份而不做对账，等于把"手抄要现场回忆五件事"换成"手抄和脚本要各自回忆"。
   *    这里按**目的目录集合**对账，不按出现次数：那一节里有三处历史事故记录各自印着同一条命令，
   *    判次数会把它们读成"漂移"，而那些行是刻意不改写的（§3.7 末尾明写"不要改写这一段本身"）。 */
  const RUNBOOK = 'docs/runbooks/deployment.md';
  const uniq = (a) => [...new Set(a)].sort();
  let docDests = ['读不到 ' + RUNBOOK];
  try {
    docDests = uniq(readFileSync(join(ROOT, RUNBOOK), 'utf8')
      .match(/rsync\s+-\w+\s+--delete\s+\S+\s+\S+:(\/var\/www\/[^\s`]+?\/)/g)
      ?.map((m) => m.match(/:(\/var\/www\/[^\s`]+\/)$/)[1]) ?? []);
  } catch { /* 读不到就是红，不许当"没有 rsync" */ }
  push('P19 本脚本发的目的目录 == runbook 那一节印的（两份抄件必须一起改）',
    docDests.join(','), uniq(rsyncSteps.map((s) => (rsyncDest(s) ?? '').replace(/^[^:]*:/, ''))).join(','));

  // 守卫：三条各被单独打红过一次，才知道它们不是装饰。
  const fakeGit = (opts) => (args) => {
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return opts.head;
    if (args[0] === 'rev-parse') return opts.ref;
    if (args[0] === 'status') return opts.dirty;
    throw new Error('unexpected git call');
  };
  push('P11 HEAD == 目标 ref ⇒ 通过', true,
    guardReadings(fakeGit({ head: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ref: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', dirty: '' }), ROOT).ok);
  push('P12 HEAD != 目标 ref ⇒ 拒绝（不许发没进 ref 的那一截）', false,
    guardReadings(fakeGit({ head: 'bbbbbbbb', ref: 'aaaaaaaa', dirty: '' }), ROOT).ok);
  push('P13 构建输入有未提交改动 ⇒ 拒绝', false,
    guardReadings(fakeGit({ head: 'aaaaaaaa', ref: 'aaaaaaaa', dirty: ' M apps/web/src/main.tsx' }), ROOT).ok);
  push('P14 脏条目里必须点名是哪一个文件（"有改动"三个字不足以让人知道改哪儿）', true,
    /apps\/web\/src\/main\.tsx/.test(guardReadings(fakeGit({ head: 'aaaaaaaa', ref: 'aaaaaaaa', dirty: ' M apps/web/src/main.tsx' }), ROOT).fails.join('')));
  push('P15 判据文件不在树上 ⇒ 拒绝（发一条没有对账的链等于没判据）', false,
    guardReadings(fakeGit({ head: 'aaaaaaaa', ref: 'aaaaaaaa', dirty: '' }), join(ROOT, '..')).ok);
  return arms;
}

/* ── 变异 rig：把上面每条臂各打红一次 ──────────────────────────────────
 * 为什么进仓库而不是留在 /tmp：这七条读数是"这套顺序判据有牙"唯一的证明，
 * 而臂本身只会说"全绿"。没有可重跑的变异载体，下一次改顺序的人就只能重新推导一遍。
 * 每条变异都带**实参锚点命中数**断言 —— 锚点漂了就抛错，不会静默地"没变异成功所以没红"。
 */
const SELF = fileURLToPath(import.meta.url);
/* 🔴 变异只作用在 **planSteps 那一段**上，不作用在整份文件上。
 *    第一版是改整份文件，结果 rig 自己的锚点字符串也在同一个文件里 —— 每条锚点命中 2 次，
 *    命中数断言当场抛错，9 条变异全部读成"红集为空"。这正是"needle 扫到自己"那一族。 */
const PLAN_START = 'export function planSteps(';
const PLAN_END = '/* ── 自检：顺序与守卫都要能被臂打红 ────';
const planSlice = (src) => {
  const a = src.indexOf(PLAN_START);
  const b = src.indexOf(PLAN_END);
  if (a < 0 || b < 0 || b <= a) throw new Error(`planSteps 段落定位失败（PLAN_START=${a} PLAN_END=${b}）`);
  return [src.slice(0, a), src.slice(a, b), src.slice(b)];
};
const stepStart = (lines, labelNeedle) => {
  const li = lines.findIndex((l) => l.includes(labelNeedle));
  if (li < 0) throw new Error(`锚点没了：${labelNeedle}`);
  for (let i = li; i >= 0; i -= 1) if (lines[i] === '    {') return i;
  throw new Error(`找不到 "${labelNeedle}" 所属步骤的对象起始行`);
};
const rep = (src, needle, withWhat, expectHits) => {
  const hits = src.split(needle).length - 1;
  if (hits !== expectHits) throw new Error(`实参锚点命中 ${hits} 次，期望 ${expectHits}：${needle.slice(0, 60)}`);
  return src.replaceAll(needle, withWhat);
};
const withPlan = (fn) => (src) => {
  const [head, plan, tail] = planSlice(src);
  return head + fn(plan) + tail;
};

const MUTATIONS = [
  ['control 未变异（对照组：不许有红）', (s) => s, []],
  ['M1 rsync 插进两条构建之间', withPlan((plan) => {
    const l = plan.split('\n');
    l.splice(stepStart(l, "      label: '3/9"), 0,
      "    { label: 'MUT', argv: ['rsync', '-az', '--delete', 'apps/web/dist/', 'ubuntu-jcli:/var/www/heyta-app/'] },");
    return l.join('\n');
  }), ['control', 'P2', 'P5', 'P6', 'P7', 'P8']],
  // P3 与 P16 同时红是**对的**（P3 = 构建没给挂载路径；P16 = 判据判的不是这个产物）。
  // 它们不是同一条判据抄两遍 —— M7 只红 P16（P3 仍绿）就是证据。
  ['M2 应用构建不给 HEYTA_WEB_BASE', withPlan((p) =>
    rep(p, "env: { HEYTA_WEB_BASE: '/app/' },", 'env: {},', 1)), ['P3', 'P16']],
  ['M3 落地页构建不给 VITE_APP_URL', withPlan((p) =>
    rep(p, 'VITE_APP_URL: o.appUrl', 'VITE_APP_URL: undefined', 1)), ['P4']],
  ['M4 入口对账那一步的命令名没了', withPlan((p) =>
    rep(p, "'check:entries'],", "'check:entries-gone'],", 1)), ['P1']],
  ['M5 最后一条不是线上验收配置', withPlan((p) =>
    rep(p, "'--config', 'playwright.live-site.config.ts'", "'--config', 'playwright.config.ts'", 1)), ['P10']],
  // ⚠️ 只红 P9：P1 那些用 `argv.includes(...)` 的顺序臂在**字符串**上同样为真，会跟着绿。
  ['M6 某一步退化成拼好的 shell 串', withPlan((p) =>
    rep(p, "      argv: ['pnpm', '--filter', '@heyta/landing', 'check:entries'],",
      "      argv: 'pnpm --filter @heyta/landing check:entries',", 1)), ['P9']],
  ['M7 构建挂 /app/ 但判据判的是 /', withPlan((p) =>
    rep(p, "'--mount', '/app/'", "'--mount', '/'", 1)), ['P16']],
  ['M8 判据读了一个不存在的 dist', withPlan((p) =>
    rep(p, "'--dist', 'apps/web/dist'", "'--dist', 'apps/web/dist-old'", 1)), ['P17']],
  ['M9 落地页判据读旧域名', withPlan((p) =>
    rep(p, "apps/landing/dist', o.domain]", "apps/landing/dist', 'old.example.com']", 1)), ['P18']],
  ['M10 判据根本没带 --dist（缺参不许当通过）', withPlan((p) =>
    rep(p, "'--mount', '/app/', '--dist', 'apps/web/dist'", "'--mount', '/app/'", 1)), ['P17']],
  // 把目的目录改名 ⇒ 三条同时红（P7 按目录判顺序、P17 找不到"发给 heyta-app 的那一条"、P19 与 runbook 对不上）。
  // P19 单独的红读法由 M12 给：只改 runbook 那一侧的话改的是文档，rig 不动文档，所以这里改脚本侧。
  ['M11 脚本发的目的目录与 runbook 不再一致', withPlan((p) =>
    rep(p, '/var/www/heyta-app/', '/var/www/heyta-web/', 1)), ['P7', 'P17', 'P19']],
];

function runMutation() {
  const base = readFileSync(SELF, 'utf8');
  let bad = 0;
  for (const [name, apply, expect] of MUTATIONS) {
    const tag = name.split(' ')[0];
    const copy = join(dirname(SELF), `publish-mut-${tag}.tmp.mjs`);
    let red = [];
    let threw = false;
    try {
      writeFileSync(copy, apply(base));
      const out = execFileSync(process.execPath, [copy, '--selftest'], { cwd: ROOT, encoding: 'utf8' });
      red = out.split('\n').filter((l) => l.startsWith('RED '))
        .map((l) => l.slice(4).trim().split(/\s+/)[0]).sort();
    } catch (e) {
      threw = /Error|throw/i.test(`${e.stdout ?? ''}${e.stderr ?? ''}`);
      red = `${e.stdout ?? ''}`.split('\n').filter((l) => l.startsWith('RED '))
        .map((l) => l.slice(4).trim().split(/\s+/)[0]).sort();
    } finally {
      rmSync(copy, { force: true });
    }
    const ok = JSON.stringify(red) === JSON.stringify([...expect].sort()) && !threw;
    if (!ok) bad += 1;
    console.log(`${ok ? '  ok' : 'RED '} ${name} ⇒ 红集 [${red.join(', ')}]（期望 [${[...expect].sort().join(', ')}]）${threw ? ' 且抛错' : ''}`);
  }
  console.log(`变异 rig：${MUTATIONS.length} 条 · 不符 ${bad}`);
  if (bad) {
    console.log('❌ 有臂打不红（或锚点漂了）⇒ 那几条判据是装饰，别信这套顺序');
    process.exit(1);
  }
  console.log(`✅ 顺序、形状、三条"对账对象"臂各有独立的变异读数；未变异对照组无红。`);
  process.exit(0);
}

function runSelftest() {
  const arms = publishArms();
  let bad = 0;
  for (const a of arms) {
    const hit = JSON.stringify(a.got) === JSON.stringify(a.expect);
    if (!hit) bad += 1;
    console.log(`${hit ? '  ok' : 'RED '} ${a.name}（期望 ${JSON.stringify(a.expect)}，实得 ${JSON.stringify(a.got)}）`);
  }
  console.log(`发布装置自检：臂数 ${arms.length} · 红 ${bad}`);
  // ⚠️ 地板随臂数**只升不降**：加一条臂就要把这里抬上去。臂被删掉时这个数会拦住"看起来还在自检"。
  if (arms.length < 20 || bad > 0) {
    console.log('❌ 自检没过 ⇒ 这条链的顺序与守卫不可信，别用它发布');
    process.exit(1);
  }
  console.log('✅ 顺序（入口对账 → 构建 → 两次产物判据 → 备份 → 站点 → 应用 → 线上验收）与五条守卫各有臂打红过一次。');
  process.exit(0);
}

const argv = process.argv.slice(2);
if (argv.includes('--selftest')) runSelftest();
if (argv.includes('--mutation')) runMutation();
const CONFIRM = argv.includes('--confirm');
const unknown = argv.filter((a) => !['--confirm', '--selftest', '--mutation'].includes(a));
if (unknown.length) {
  console.error(`未知参数：${unknown.join(' ')}（支持 --confirm / --selftest / --mutation）`);
  process.exit(2);
}

const g = guardReadings();
console.log(`发布对象 = ${REF} 那一笔（当前 ${g.headSha.slice(0, 8)}）· 主机 ${HOST} · 域名 ${DOMAIN}`);
for (const r of g.readings) console.log(`  · ${r}`);
if (!g.ok) {
  console.log(`\n🔴 守卫不成立（${g.fails.length} 条），一条命令都不会执行：`);
  for (const f of g.fails) console.log(`  - ${f}`);
  console.log(`\n   要发的必须正好是 ${REF}：先提交（或先落地），再重跑本脚本。`);
  process.exit(1);
}
console.log(`\n✅ 守卫成立：现在这棵树正好等于 ${REF}，且构建输入没有未提交改动。`);
console.log(CONFIRM ? '\n--confirm：按下面顺序真的执行（对外动作已经由人明确授权）\n' : '\n默认 dry-run：只打印，不 build、不 ssh、不 rsync。\n');

for (const s of planSteps()) {
  const env = s.env ? Object.entries(s.env).map(([k, v]) => `${k}=${v}`).join(' ') + ' ' : '';
  console.log(`${s.label}\n    $ ${env}${s.argv.join(' ')}`);
  if (!CONFIRM) continue;
  try {
    const out = execFileSync(s.argv[0], s.argv.slice(1), {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, ...(s.env ?? {}) },
      maxBuffer: 1 << 26,
    });
    const tail = out.trim().split('\n').slice(-2).join(' / ').replace(/\s+/g, ' ');
    console.log(`    ✅ exit 0${tail ? ` —— ${tail.slice(0, 200)}` : ''}`);
  } catch (e) {
    const text = `${e.stdout ?? ''}${e.stderr ?? ''}${e.message ?? ''}`;
    console.log(`    ❌ 这一步没成（退 ${e.status ?? '?'}），**链到此为止**：\n${text.split('\n').slice(-8).join('\n')}`);
    console.log(`    🔴 后面的 rsync 一条都没执行 —— 这正是要的顺序：宁可不发，也不发一半。\n` +
      `       远端备份的路径在上面第 6 条的输出里；要回滚就拿它还原。`);
    process.exit(e.status ?? 1);
  }
}
if (!CONFIRM) {
  console.log(`\n（没加 --confirm ⇒ 上面每一步都没执行。发布是对外动作，要人明确授权。）`);
  process.exit(0);
}
console.log(`\n✅ 九步全过。请把最后一步线上验收的输出留档（它读的是公开域名上的产物，不是本机目录）。`);
