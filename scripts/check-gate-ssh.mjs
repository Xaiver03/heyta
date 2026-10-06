#!/usr/bin/env node
/**
 * `check:gate-ssh` —— 钉住"SSH 门禁"这条路本身的形状
 * ====================================================
 *
 * 为什么需要一道门禁来管一个运维脚本
 * ----------------------------------
 * 这条路的全部价值是一句承诺：**跑门禁这件事，一个字节都不经过代理**。
 * 而一句没有载体的承诺会烂掉，且烂得没有声音 —— 本仓库为同一件事写过两道门禁
 * （`check:image-license-stamp` 管许可证快照、`check:android-gradle-remote` 管远程构建的形状）。
 * 这里缺的正是同一类东西：
 *
 *   - 有人把依赖装进镜像里（"这样跑得快"）⇒ "新克隆能不能立起来"那条判据**永久关掉**，
 *     而所有测试照样绿；
 *   - 有人在 `ENV_LIMITED` 里留了一条**早就在载体上能跑**的跳过 ⇒ 那道门禁从"验过"
 *     退成"没验"，输出里还是一片绿；
 *   - 有人把阳性对照删了 ⇒ "curl github 连不上"被读成"没走代理"，
 *     而实际上那次是**整台机器的出口坏了**（§7 元规则 1：先怀疑探针）；
 *   - 有人给容器传了宿主机的 proxy ⇒ 前面三条全都白写。
 *
 * ## 用法
 *
 *   node scripts/check-gate-ssh.mjs              # 正常跑（由 pnpm check 调用）
 *   node scripts/check-gate-ssh.mjs --self-test  # 逐臂注入，证明这道门禁**真的会红**
 *   node scripts/check-gate-ssh.mjs --root <dir> # 把被检查的文件指到临时树（注入用）
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(HERE, '..');
const argv = process.argv.slice(2);
const ROOT = argv.includes('--root') ? argv[argv.indexOf('--root') + 1] : DEFAULT_ROOT;
const SELF_TEST = argv.includes('--self-test');

// ⚠️ 这一枚 bug 是 self-test **自己**抓出来的：第一版把 `read()` 写成了闭包引用模块级
//    `ROOT`，而 `collectIssues(root)` 收的那个参数只用在 package.json 那一行上 ⇒
//    八条注入臂全部**存活**（它们改的是临时树，判据读的是原始树）。
//    症状是"这道门禁没有牙"，根因是"探针够不着被注入的那份文件"（§7 元规则 1）。
//    所以 `read` 现在显式收树根，一个默认值都不给。
const read = (root, rel) => {
  const p = join(root, rel);
  if (!existsSync(p)) throw new Error(`缺文件：${rel}`);
  return readFileSync(p, 'utf8');
};

/** 唯一的门禁链权威 = 根 package.json 的 `check`。本文件不抄它的条数。 */
function chain(root) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  return (pkg.scripts.check || '').split('&&').map((s) => s.trim()).filter(Boolean);
}

function collectIssues(root) {
  const issues = [];
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const c = (pkg.scripts.check || '').split('&&').map((s) => s.trim()).filter(Boolean);
  const gate = read(root, 'scripts/gate-ssh.mjs');
  const dockerfile = read(root, 'scripts/ci/Dockerfile.gate');
  const probe = read(root, 'scripts/ci/egress-probe.sh');

  // A. 链的权威只有一处：脚本必须**运行时解析** package.json，不许抄一份清单进来。
  if (!/pkg\.scripts\.check/.test(gate)) {
    issues.push('gate-ssh.mjs 没有从根 package.json 的 check 现推门禁链 —— 抄件一定会漂（AGENTS §6 明写条数不许写在文档里，同一个理由）');
  }

  // B. ENV_LIMITED 的每一项必须**真的还在链里**。
  //    链改了这个运维没跟上的表现，是那道门禁从链里掉了 —— 而这一条会先红。
  const keys = [...gate.matchAll(/\[\s*'(pnpm [^']+)',\s*'/g)].map((m) => m[1]);
  for (const k of keys) {
    if (!c.includes(k)) issues.push(`ENV_LIMITED 登记的「${k}」不在当前门禁链里 ⇒ 这条跳过理由已经过期（要么它改名了、要么它已经能从载体跑起来），请删掉这一项`);
  }
  if (keys.length === 0) issues.push('ENV_LIMITED 解析到 0 项 —— 解析式或那张表被改坏了；0 项会让"跳过"变成"全绿"');

  // C. 载体镜像**不许预装依赖**：那等于永久关掉"新克隆能不能立起来"这条判据。
  //    ⚠️ 两条实测踩过的坑，都在这条判据的第一版里：
  //    ① **注释里写着"不许 pnpm install"，正则抓到注释本身** ⇒ 一条永远红的判据；
  //    ② `RUN` 与文件末尾的 `CMD ["bash","-lc","pnpm install …"]` 被 `[\s\S]{0,300}` 连成一段
  //       ⇒ 把"默认命令"读成"构建期执行"。判据必须按**指令**切，不是按字符窗口。
  //    所以：剥掉注释行 → 把反斜杠续行拼回一条逻辑行 → 只看以 RUN 开头的那些。
  const dockerCode = dockerfile
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n')
    .replace(/\\\n/g, ' ');
  const runInstrs = dockerCode.split(/\n(?=(?:RUN|CMD|ENTRYPOINT|FROM|COPY|ENV|ARG|USER|WORKDIR)\b)/).filter((s) => /^\s*RUN\b/.test(s));
  if (runInstrs.some((s) => /pnpm (install|fetch)\b/.test(s))) {
    issues.push('Dockerfile.gate 里有 RUN … pnpm install —— 把依赖烘进镜像就关掉了 --frozen-lockfile 那条探测器');
  }
  if (!/WORKDIR \/work/.test(dockerCode)) {
    issues.push('Dockerfile.gate 没有 /work —— gate-ssh.mjs 的挂载假设落空');
  }

  // D. 容器的出口必须是**关掉的**：proxy 变量要显式置空，而不是"没设"。
  //    "没设"会跟着宿主的 daemon 配置漂；置空才是这条路的声明。
  const envLine = (gate.match(/const CONTAINER_ENV = ([^;]+);/s) || [])[1] || '';
  if (!envLine.trim()) issues.push('gate-ssh.mjs 里找不到 CONTAINER_ENV —— 容器出口没人管了');
  for (const v of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']) {
    if (!new RegExp(`-e ${v}=`).test(envLine)) issues.push(`CONTAINER_ENV 没有把 ${v} 显式置空 ⇒ 容器可能继承宿主代理，"零代理字节"这句承诺作废`);
  }

  // E. 探针是"配对仪器测试"，不是可达性断言。
  //    🔴 四件套缺一不可，每一件都对应一种"会假装成功"的坏法：
  //    ① 阳性对照（挂代理真打一次并在账本里看得见）—— 没有它，"没记到"分不清
  //       "没走代理"与"仪器瞎了"；
  //    ② 对照看不见 ⇒ INCONCLUSIVE + exit 2，**不许**落回"通过"；
  //    ③ 拖住连接（--limit-rate）：`/connections` 只列活跃连接，一次 0.2 秒的快请求
  //       根本采不到 ⇒ 那条"没记到"是探针够不着，不是结论；
  //    ④ **不许**再写"连不上 GitHub ⇒ 没走代理"那一类判据 —— 2026-10-06 实测这台机器
  //       直连 github.com 是 200/0.09s，那条前提已经死了，留着它就是一条永远红的判据。
  //    ⚠️ 全部判据跑在**剥掉注释**的那份文本上：这一枚探针的说明里就写着 `--limit-rate`
  //       与 `GITHUB_DIRECT`（它讲的是"上一版为什么错"），照原文判会得到一条永远红的
  //       判据 —— 与上面 Dockerfile 那一处是**同一个 bug 的第二次现形**，同一个提交里修的。
  const probeCode = probe
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
  if (!/CONTROL=OK/.test(probeCode)) {
    issues.push('egress-probe.sh 没有阳性对照（挂代理再打一次并确认账本看得见）⇒ "没记到"会被读成"没走代理"，而这两种是相反的事实');
  }
  if (!/EGRESS=INCONCLUSIVE[\s\S]{0,80}exit 2/.test(probeCode)) {
    issues.push('egress-probe.sh 的"对照看不见"没有走到 exit 2 ⇒ 仪器瞎了时会静默变成"通过"');
  }
  if (!/--limit-rate/.test(probeCode)) {
    issues.push('egress-probe.sh 的标记请求没有拖住连接（缺 --limit-rate）⇒ /connections 采不到它，"零记录"是探针失效而不是证据');
  }
  if (/GITHUB_DIRECT/.test(probeCode)) {
    issues.push('egress-probe.sh 里又出现了"以 GitHub 可达性判代理"的写法 —— 2026-10-06 实测直连 github.com = 200/0.09s，这条前提已死');
  }
  // 控制器地址只许出现一份（抄件的漂移方式是"改了上面那行、python 还在读旧端口"）
  const ctrlLiterals = (probeCode.match(/172\.17\.0\.1:9090/g) || []).length;
  if (ctrlLiterals > 1) {
    issues.push(`egress-probe.sh 里把 mihomo 控制器地址写死了 ${ctrlLiterals} 处 ⇒ 应当由参数传进去，只留一处默认值`);
  }

  // F. 探针必须排在**任何花钱动作之前**（负载门 → 传输 → 构建 → 探针 → 装依赖）。
  const order = (label) => gate.indexOf(label);
  const iProbe = order('步骤 6：出口探针');
  const iInstall = order('步骤 7：pnpm install');
  if (iProbe < 0 || iInstall < 0) issues.push('gate-ssh.mjs 里找不到步骤 6/7 的编号锚点 ⇒ 顺序判据退化成"读一遍看看"');
  else if (iProbe > iInstall) issues.push('出口探针排在装依赖**之后** ⇒ 先花完额度再宣布没花钱，这条判据没有意义');

  // G. 装依赖失败时不许出"0 失败"那种汇总。
  if (!/⇒ \$\{steps\.length\} 段门禁\*\*一段都没有执行\*\*/.test(gate) && !/段门禁\*\*一段都没有执行\*\*/.test(gate)) {
    issues.push('gate-ssh.mjs 在装依赖失败时没有明说"0 段执行" —— §8.1 记过这个形状：22 道门禁一次都没跑，而人看到的是"CI 红了 = 装依赖失败"');
  }

  // H. 负载门阈值必须**是 nproc 的函数**，不是"文里出现了 nproc 这四个字母"。
  //    ⚠️ 第一版判据是 `!/nproc/.test(gate) || /LIMIT=[0-9]/.test(gate)`，
  //    而注入 `n*0.75 → 3.5` 之后**两半都还是绿的**：`N=$(nproc)` 那行还在，
  //    `LIMIT=$(awk …)` 也不匹配 `LIMIT=[0-9]`。写死的数字换了个藏身之处，判据看不见。
  //    ⇒ 判据要落在"阈值表达式里必须乘上 nproc 那个值"，而不是"某个词在不在"。
  if (!/nproc/.test(gate)) {
    issues.push('gate-ssh.mjs 的负载门不再读 nproc —— 阈值失去了被约束的来源');
  } else if (!/LIMIT=\$\(awk[^\n]*\bn\s*\*/.test(gate)) {
    issues.push('gate-ssh.mjs 的负载阈值不是 nproc 的函数（awk 表达式里没有 `n *`）—— 阈值写死就是"永远通过的判据"那一类');
  }

  return issues;
}

if (SELF_TEST) {
  const base = collectIssues(DEFAULT_ROOT);
  if (base.length > 0) {
    console.log(`🔴 基线就不干净（${base.length} 条），先修再说 self-test：`);
    base.forEach((b) => console.log('   - ' + b));
    process.exit(1);
  }
  const tree = (mut) => {
    const dir = mkdtempSync(join(tmpdir(), 'ht-gate-arm-'));
    for (const rel of ['package.json', 'scripts/gate-ssh.mjs', 'scripts/ci/Dockerfile.gate', 'scripts/ci/egress-probe.sh']) {
      const dst = join(dir, rel);
      mkdirSync(dirname(dst), { recursive: true });
      let content = readFileSync(join(DEFAULT_ROOT, rel), 'utf8');
      if (mut[rel]) content = mut[rel](content);
      writeFileSync(dst, content);
    }
    return dir;
  };
  const ARMS = [
    {
      name: '阳性对照被删',
      files: { 'scripts/ci/egress-probe.sh': (s) => s.replace(/printf 'CONTROL=OK[^\n]*\n/, '') },
    },
    {
      name: '对照看不见时落回"通过"（不再 exit 2）',
      files: { 'scripts/ci/egress-probe.sh': (s) => s.replace(/echo 'EGRESS=INCONCLUSIVE'; exit 2/g, "echo 'EGRESS=OK'; exit 0") },
    },
    {
      name: '标记请求不拖住连接（仪器必然瞎）',
      files: { 'scripts/ci/egress-probe.sh': (s) => s.replace(/--limit-rate 20k /g, '') },
    },
    {
      name: '退回"以 GitHub 可达性判代理"那套死前提',
      files: { 'scripts/ci/egress-probe.sh': (s) => s.replace('# ── 0)', 'if curl -m 5 https://github.com/ >/dev/null; then echo GITHUB_DIRECT=FAIL; fi\n# ── 0)') },
    },
    {
      name: '控制器地址被抄成两份',
      files: { 'scripts/ci/egress-probe.sh': (s) => s.replace('CTRL="${3:-http://172.17.0.1:9090}"', 'CTRL="${3:-http://172.17.0.1:9090}"\nBAK=http://172.17.0.1:9090') },
    },
    {
      name: 'ENV_LIMITED 留了一条已经不在链里的项',
      files: { 'scripts/gate-ssh.mjs': (s) => s.replace("const ENV_LIMITED = new Map([", "const ENV_LIMITED = new Map([\\n  ['pnpm check:不存在的门禁', '注入用'],") },
    },
    {
      name: '镜像里预装依赖（关掉 frozen-lockfile 探测器）',
      files: { 'scripts/ci/Dockerfile.gate': (s) => s.replace('WORKDIR /work', 'WORKDIR /work\nRUN pnpm install --frozen-lockfile') },
    },
    {
      name: '容器不再显式关代理（继承宿主 daemon 的 mihomo）',
      files: { 'scripts/gate-ssh.mjs': (s) => s.replace(/-e http_proxy= /g, '') },
    },
    {
      name: '探针排到装依赖之后',
      files: { 'scripts/gate-ssh.mjs': (s) => s.replace('步骤 6：出口探针', '步骤 7：pnpm install 出口探针') },
    },
    {
      // ⚠️ 这一臂第一版是 `pkg.scripts.check` → `pkg.scripts.check_DISABLED`，
      //    结果它**存活**了：判据写的是 `/pkg\.scripts\.check/`，而那串后缀照样含这个子串。
      //    也就是说"判据命中一个前缀超集"= 一条抓不到东西的判据（§7 元规则 2 的又一副面孔）。
      //    现在注入的是"真的换成硬编码抄件"，判据也收成**必须是成员访问**那一形。
      name: '链改成硬编码抄件（不再读 package.json）',
      files: { 'scripts/gate-ssh.mjs': (s) => s.replace('pkg.scripts.check', "['pnpm check:a', 'pnpm check:b']") },
    },
    {
      name: '装依赖失败不再明说"0 段执行"',
      files: { 'scripts/gate-ssh.mjs': (s) => s.replace(/段门禁\*\*一段都没有执行\*\*/, '段门禁照常汇总') },
    },
    {
      name: '负载阈值写成一个固定数字',
      files: { 'scripts/gate-ssh.mjs': (s) => s.replace('n*0.75', '3.5').replace(/LIMIT=\$\(awk[\s\S]*?nproc=\$N"\)/, 'echo "LOAD=OK"') },
    },
  ];
  console.log(`基线：链外对账 ${chain(DEFAULT_ROOT).length} 段，collectIssues 干净。`);
  let survived = 0;
  ARMS.forEach((arm, i) => {
    const dir = tree(arm.files);
    let got = [];
    try {
      got = collectIssues(dir);
    } catch (e) {
      got = ['抛错：' + e.message];
    }
    rmSync(dir, { recursive: true, force: true });
    const dead = got.length > 0;
    if (!dead) survived++;
    console.log(`  臂 ${i}｜${arm.name} → ${dead ? '✅ 红（预期）' : '🔴 **存活**（这道门禁没有牙）'}`);
    if (dead) console.log(`        抓到：${got[0].slice(0, 110)}`);
  });
  console.log(`\n臂数=${ARMS.length}（由本脚本自己打印，文档里不许抄这个数）存活=${survived}`);
  if (survived > 0) {
    console.log('🔴 有臂存活：那条注入对应的承诺没有任何一层在守。');
    process.exit(1);
  }
  console.log('✅ 全部臂都会红 —— 这道门禁能失败。');
  process.exit(0);
}

const issues = collectIssues(ROOT);
if (issues.length === 0) {
  console.log(`check:gate-ssh ✅ SSH 门禁载体形状成立（链 ${chain(ROOT).length} 段现取自根 package.json；跳过表逐项对过）`);
  process.exit(0);
}
console.log('check:gate-ssh 🔴');
issues.forEach((i) => console.log('   - ' + i));
process.exit(1);
