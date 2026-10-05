#!/usr/bin/env node
/**
 * "跑 `pnpm check`（或它的某一段）之前，哪些端口上的进程会被 SIGKILL，以及现在有没有人"
 * —— 这一件事的**唯一事实源**。
 *
 * ## 为什么要有这个文件（两处抄件 + 一个会咬人的假 0）
 *
 * `scripts/check-ai-e2e-preflight.mjs` 会把它拿到参数的那些端口上的监听者逐个
 * `process.kill(pid, 'SIGKILL')`。两个工具都需要先判这件事：
 * `selfhost-check-segments.mjs`（逐段归属，只跑某几段）和 `selfhost-land-main.mjs`
 * （落地前跑完整链）。原来**各写了一份**：
 *
 * | 那份抄件 | 实测到的问题 |
 * |---|---|
 * | segments 里 `SEG_PORTS` 的三行正则→端口表 | 端口是对的，但**来源是手抄**：链里新增一段传别的端口，它不会自己长出来 |
 * | land-main 里"stdout 空 = 没人监听" | 🔴 **假 0**：lsof 探针坏（如 `-sTCP` 重复）时同样是 stderr 有字 + stdout 空，于是"判不了"被读成"没人用"⇒ 照样放行 SIGKILL。`da3345c3` 在另一份里已经修过同一形状，抄过来时把这个坑抄丢了 |
 * | land-main 里 `join(tmpdir(), …)` 当载体目录 | macOS 的 `TMPDIR` 不是 `/tmp` ⇒ 判的是一棵不存在的路径（现在由自检臂 6 与建库脚本对账） |
 *
 * ## 三条不变量（改这个文件前先读）
 *
 * 1. **读不到 ⇒ 报错，不返回空集。** 空集在这一档不是"安全"，是探针没接上。
 * 2. **rc 不是判据。** 有监听时 `lsof` 同样退 1（实测）。坏探针的信号是 **stderr 有字**。
 * 3. **`Number('')` 是 `0`。** "这段没传参数" split 出 `['']`，不滤掉 `<= 0` 就会被读成"传了端口 0"，
 *    于是回落不发生、真正会被清的默认端口整个掉出射程（控制臂实测就是 `[0,4320,4322]`）。
 *
 * 用法：`node research/tools/selfhost-kill-ports.mjs --selftest [载体目录]`
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const PREFLIGHT = 'scripts/check-ai-e2e-preflight.mjs';
/** 与 selfhost-merge-carrier.mjs 的默认值必须逐字相同（自检臂 6 判这个）。 */
export const CARRIER_DIR_DEFAULT = '/tmp/heyta-merge-carrier';

const toPorts = (list) => list.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0);

/** preflight 里那份默认端口清单。读不到就返回 `{ error }`，**不猜**。 */
export function defaultsFrom(dir) {
  const pfPath = join(dir, PREFLIGHT);
  if (!existsSync(pfPath)) {
    return { error: `${dir} 里没有 ${PREFLIGHT} ⇒ 不知道链会清哪些端口；不知道不等于不清` };
  }
  const dm = readFileSync(pfPath, 'utf8').match(/const DEFAULT_PORTS = \[([\d,\s]+)\]/);
  if (!dm) return { error: `读不到 ${PREFLIGHT} 的 DEFAULT_PORTS（它改了形状）⇒ 不猜` };
  const ports = toPorts(dm[1].split(','));
  if (!ports.length) return { error: `${PREFLIGHT} 的 DEFAULT_PORTS 解析出 0 个端口 ⇒ 形状变了，不猜` };
  return { ports };
}

/**
 * 这一条命令里**显式**传给 preflight 的端口（没传就是空数组 —— 空数组不等于"射程为空"）。
 * 🔴 `Number('')` 是 `0`：不滤掉 `<= 0` 的话"没传参数"会被读成"传了端口 0"，回落就不发生，
 *    真正会被清的默认端口整个掉出射程（控制臂实测正是 `[0,4320,4322]`）。
 */
export function explicitPortsOf(cmd) {
  const out = new Set();
  for (const m of String(cmd).matchAll(/check-ai-e2e-preflight\.mjs((?:\s+\d+)*)/g)) {
    for (const p of toPorts(m[1].trim().split(/\s+/))) out.add(p);
  }
  return [...out];
}

/**
 * 这一条命令（某个 package.json script 的值）真跑起来会清哪些端口。
 * 显式参数优先，**没传参数才**回落到默认值 —— 与 preflight 自己的
 * `ARGS.length > 0 ? ARGS : DEFAULT_PORTS` 同一口径。
 */
export function portsForCommand(cmd, defaults) {
  const explicit = explicitPortsOf(cmd);
  return (explicit.length ? explicit : defaults).slice().sort((a, b) => a - b);
}

/**
 * 这条命令**会不会**清端口，会的话清哪几枚。不调 preflight 的命令返回 `[]`。
 * 🔴 这一层 guard 必须在模块里：`portsForCommand` 对"没传显式参数"的回落是默认的，
 *    调用方一旦忘了先判"它到底调不调 preflight"，就会把整条链都读成"会清端口"（过度拒绝），
 *    或者反过来挑错段。消费方只该调这个。
 */
export function portsKilledBy(cmd, defaults) {
  if (!String(cmd).includes('check-ai-e2e-preflight.mjs')) return [];
  return portsForCommand(cmd, defaults);
}

/** 整条 `check` 链的射程，带归因（拒绝时要能说出是谁把这台端口放进射程的）。 */
export function deriveKillPorts(dir) {
  const def = defaultsFrom(dir);
  if (def.error) return { error: def.error };
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    return { error: `${dir}/package.json 读不到或不是合法 JSON ⇒ 链的形状不可知` };
  }
  const chain = String(pkg.scripts?.check ?? '');
  if (!chain.trim()) return { error: 'package.json 里没有 check 链 ⇒ 这不是"链没有破坏性前置"，是没读到' };
  const owners = new Map();
  for (const seg of chain.split(' && ').map((s) => s.replace(/^pnpm /, '').trim())) {
    const cmd = String(pkg.scripts?.[seg] ?? '');
    const killed = portsKilledBy(cmd, def.ports); // guard 在这一层：不调 preflight 的段返回 []
    if (!killed.length) continue;
    const explicit = explicitPortsOf(cmd);
    for (const p of killed) {
      if (!owners.has(p)) {
        owners.set(p, `${seg}${explicit.length ? `（显式传 ${explicit.join('/')}）` : '（用 DEFAULT_PORTS）'}`);
      }
    }
  }
  if (!owners.size) {
    return { error: '链里一段都不清端口？要么 preflight 改名了、要么我的匹配没接上 ⇒ 按"判不了"处理，不放行' };
  }
  return { ports: [...owners.keys()].sort((a, b) => a - b), owners };
}

/**
 * lsof 的一次读数 ⇒ 三档，**互不相同**：
 * `{noLsof}` 工具不在 / `{brokenProbe}` 探针坏了 / `{rows}` 可信读数（可以为空 = 真的没人监听）。
 * 判据来自 `da3345c3`：rc 不作数，stderr 有字才是坏探针。
 */
export function probeVerdict({ noLsof = false, stderr = '', stdout = '' }) {
  if (noLsof) return { noLsof: true };
  const err = String(stderr).trim();
  if (err) return { brokenProbe: err.split('\n')[0].slice(0, 160) };
  const rows = [];
  for (const line of String(stdout).split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/).filter(Boolean);
    const m = line.match(/:(\d+)\s*\(LISTEN\)/u);
    if (!m || !cols[1]) continue;
    rows.push({ port: Number(m[1]), pid: cols[1], text: cols.join('/') });
  }
  return { rows };
}

/**
 * 这些端口上的监听者。**一条 lsof 带多枚 `-iTCP:<port>`，但 `-sTCP:LISTEN` 只出现一次**
 * （各带一个 ⇒ `duplicate TCP inclusion` ⇒ stdout 空、rc=1，与"端口空闲"在退出码上同形）。
 */
export function listenersOn(ports) {
  if (!ports.length) return { rows: [] };
  const args = ['-nP'];
  for (const p of ports) args.push(`-iTCP:${p}`);
  args.push('-sTCP:LISTEN');
  let r;
  try {
    r = spawnSync('lsof', args, { encoding: 'utf8' });
  } catch (e) {
    if (e?.code === 'ENOENT') return probeVerdict({ noLsof: true });
    return probeVerdict({ stderr: String(e?.message ?? e) });
  }
  return probeVerdict({ noLsof: r.error?.code === 'ENOENT', stderr: r.stderr ?? '', stdout: r.stdout ?? '' });
}

/** 会被链清掉的**现有监听者**，每条带上是谁把它放进射程的、以及那个 pid 的真实命令行。 */
export function busyEntries(ports, owners) {
  const seen = listenersOn(ports);
  if (seen.noLsof) return { noLsof: true };
  if (seen.brokenProbe) return { brokenProbe: seen.brokenProbe };
  const busy = [];
  for (const row of seen.rows) {
    let cmd = '(读不到)';
    try {
      cmd = execFileSync('ps', ['-p', row.pid, '-o', 'command='], { encoding: 'utf8' }).trim();
    } catch { /* 进程可能刚退 */ }
    busy.push(`:${row.port}（来自 ${owners.get(row.port) ?? '?'}）pid=${row.pid} ${cmd.slice(0, 80)}`);
  }
  return { busy };
}

/** 建一棵只含这两份文件的假树喂 deriveKillPorts（不碰任何真工作树）。 */
function fixtureTree(pkgScripts) {
  const dir = mkdtempSync(join(tmpdir(), 'ht-ports-fixture-'));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, PREFLIGHT), 'const DEFAULT_PORTS = [4318, 4319];\n');
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ scripts: pkgScripts }, null, 2)}\n`);
  return dir;
}

/**
 * 射程判据的自检。`{ problems, reading, probeReading }` —— problems 非空 ⇒ 判据自己坏了，
 * **调用方不能拿它任何一句"没人用"当放行**。
 *
 * @param {{carrierDir?: string, carrierScriptPath?: string}} cfg
 */
export function portsSelftest(cfg = {}) {
  const carrierDir = cfg.carrierDir ?? CARRIER_DIR_DEFAULT;
  const carrierScript = cfg.carrierScriptPath ?? join(dirname(fileURLToPath(import.meta.url)), 'selfhost-merge-carrier.mjs');
  return (async () => {
    const problems = [];
    const eq = (got, want, name) => {
      const a = JSON.stringify(got);
      const b = JSON.stringify(want);
      if (a !== b) problems.push(`${name}：实际 ${a}，应当 ${b}`);
    };
    const errs = [];
    const def4318 = [4318, 4319];

    /* 控制臂：三段调用（默认 / 显式 4322 / 显式 4320）+ 一段根本不清端口 */
    const base = {
      check: 'pnpm a && pnpm b && pnpm c && pnpm d',
      a: `node ${PREFLIGHT} && playwright test`,
      b: `node ${PREFLIGHT} 4322 && playwright test`,
      c: `node ${PREFLIGHT} 4320 && playwright test`,
      d: 'node scripts/other-check.mjs',
    };
    const r0 = deriveKillPorts(fixtureTree(base));
    if (r0.error) problems.push(`控制臂应当出数却报错：${r0.error}`);
    else eq(r0.ports, [4318, 4319, 4320, 4322], '控制臂射程');

    /* 臂 1：preflight 不在树上 ⇒ 必须是"判不了"，不能是空集 */
    const noPf = fixtureTree(base);
    rmSync(join(noPf, PREFLIGHT));
    const r1 = deriveKillPorts(noPf);
    errs.push(r1.error ?? '(没报错)');
    if (!r1.error) problems.push('臂1 摘掉 preflight 文件后判据静默 ⇒ 会被读成"链不清端口"');

    /* 臂 2：DEFAULT_PORTS 换了形状 ⇒ 必须报错，不能回落到脑里的数 */
    const shape = fixtureTree(base);
    writeFileSync(join(shape, PREFLIGHT), 'const DEFAULT_PORTS = PORTS_DEFAULT;\n');
    const r2 = deriveKillPorts(shape);
    errs.push(r2.error ?? '(没报错)');
    if (!r2.error) problems.push('臂2 把改形的 DEFAULT_PORTS 当成读到了');

    /* 臂 3：链里一段都不提 preflight ⇒ 必须报错（不是"安全"） */
    const r3 = deriveKillPorts(fixtureTree({ ...base, a: 'node x.mjs', b: 'node y.mjs', c: 'node z.mjs' }));
    errs.push(r3.error ?? '(没报错)');
    if (!r3.error) problems.push('臂3 匹配没接上却返回了端口集');

    /* 臂 4：只有一段且它传了显式参数 ⇒ 射程必须恰好是那一个，**不许把默认值也拖进来**
     * （那是过度拒绝：闸门会把自己要保护的路也堵死）。*/
    const r4 = deriveKillPorts(fixtureTree({ check: 'pnpm only', only: `node ${PREFLIGHT} 4399 && playwright test` }));
    if (r4.error) problems.push(`臂4 应当出数却报错：${r4.error}`);
    else eq(r4.ports, [4399], '臂4 显式参数不该带出 DEFAULT_PORTS');

    /* 臂 5：同一端口被两段认领 ⇒ 去重，归因只留第一条 */
    const r5 = deriveKillPorts(fixtureTree({
      check: 'pnpm a && pnpm b',
      a: `node ${PREFLIGHT} 4320`,
      b: `node ${PREFLIGHT} 4320 && node c`,
    }));
    if (r5.error) problems.push(`臂5 应当出数却报错：${r5.error}`);
    else eq(r5.ports, [4320], '臂5 端口去重');

    /* 臂 5b：一条**根本不调 preflight** 的命令必须返回空集 ——
     * 回落逻辑写在 portsForCommand 里，忘了 guard 就会把普通段读成"会清 4318/4319"。 */
    eq(portsKilledBy('node scripts/check-design.mjs', def4318), [], '臂5b 不调 preflight 的段');
    eq(portsKilledBy(`node ${PREFLIGHT} && x`, def4318), [4318, 4319], '臂5b 传了参数才算回落');

    /* 臂 6：假 0 —— 探针坏的读数必须和"没人监听"分开。
     * 两腿：① 真实环境里那把坏形状**确实**还在往 stderr 写字（否则这条判据是空的）；
     * ② 判定层把 `da3345c3` 记下的那行原文喂进去，必须出 `{brokenProbe}` 而不是空 rows。 */
    const bad = spawnSync('lsof', ['-nP', '-iTCP:4318', '-sTCP:LISTEN', '-iTCP:4319', '-sTCP:LISTEN'], { encoding: 'utf8' });
    if (bad.error?.code === 'ENOENT') {
      problems.push('臂6 没法验假 0：这台机器上没有 lsof');
    } else if (!(bad.stderr ?? '').trim()) {
      problems.push(`臂6 的坏形状这次**没**往 stderr 写字（rc=${bad.status}）⇒ "stderr 有字才是坏探针"这条依据在此环境不成立，得重判`);
    }
    const fakeZero = probeVerdict({ stderr: 'lsof: duplicate TCP inclusion: LISTEN', stdout: '' });
    if (!fakeZero.brokenProbe) {
      problems.push('臂6 把"探针坏了 + stdout 空"读成了可信空集 ⇒ "判不了"会被当成"没人用"，SIGKILL 照旧发生');
    } else errs.push(`坏探针读数=${fakeZero.brokenProbe}`);

    /* 臂 7：载体目录默认值必须和建它的那个脚本逐字相同（抄件防漂） */
    if (!existsSync(carrierScript)) {
      problems.push(`读不到 ${carrierScript} ⇒ 无法对账载体目录默认值（不是"对上了"）`);
    } else {
      const cm = readFileSync(carrierScript, 'utf8')
        .match(/const WT = process\.env\.HEYTA_CARRIER_WT \|\| '([^']+)'/);
      if (!cm) {
        problems.push('读不到 selfhost-merge-carrier.mjs 里载体目录的默认值（它改了形状）⇒ 不敢假设还是本文件这个');
      } else if (cm[1] !== CARRIER_DIR_DEFAULT) {
        problems.push(`载体目录默认值漂移：本文件 ${CARRIER_DIR_DEFAULT} vs 载体脚本 ${cm[1]} ⇒ 闸门判的是另一棵树`);
      }
    }

    /* 探测腿：真造监听者，两种栈各一条，关掉之后再测一次。
     * IPv6 单栈那条是重点 —— vite 就绑 `[::1]`；只认 IPv4 的探测会把**正在被人用**的端口读成空闲。
     * 关闭后仍被读成有人用 = 过度拒绝，闸门会把自己的路也堵死。 */
    const probe = [];
    for (const host of ['::1', '127.0.0.1']) {
      const srv = createServer();
      await new Promise((res, rej) => { srv.once('error', rej); srv.listen(0, host, res); });
      const port = srv.address().port;
      const seen = listenersOn([port]);
      if (seen.noLsof) problems.push(`这台机器上没有 lsof ⇒ 探测腿（${host}）判不了（夹具腿仍然成立）`);
      else if (seen.brokenProbe) problems.push(`探测腿（${host}）的 lsof 报坏：${seen.brokenProbe}`);
      else {
        const mine = seen.rows.filter((r) => r.pid === String(process.pid));
        if (mine.length !== 1) {
          problems.push(`${host}:${port} 上数出 ${mine.length} 条属于本进程的监听行，应当恰好 1（全部行：${seen.rows.map((r) => `${r.port}/${r.pid}`).join(' ') || '无'}）`);
        } else if (mine[0].port !== port) {
          problems.push(`探测腿把 :${port} 解析成了 :${mine[0].port} ⇒ 归因会指错端口`);
        } else probe.push(`${host}:${port}→pid ${mine[0].pid}`);
        /** 开着时 busyEntries 必须数出恰好 1 条且带来源 —— 否则闸门里那条拒绝分支永远走不进去。 */
        const on = busyEntries([port], new Map([[port, `fixture（${host}）`]]));
        if (on.noLsof || on.brokenProbe) problems.push(`busyEntries(${host}) 判不了`);
        else if (on.busy.length !== 1) problems.push(`${host}:${port} 开着时数出 ${on.busy.length} 条，应当 1 ⇒ 拒绝分支走不进去`);
        else if (!on.busy[0].includes(`fixture（${host}）`)) problems.push(`${host}:${port} 的归因串里没有来源 ⇒ 拒绝信息指不出是谁放进射程的`);
      }
      await new Promise((res) => srv.close(res));
      if (!seen.noLsof && !seen.brokenProbe) {
        const after = listenersOn([port]);
        if (after.rows.length) problems.push(`已关闭的 ${host}:${port} 仍被读成有人监听 ⇒ 闸门会过度拒绝`);
        const off = busyEntries([port], new Map([[port, 'fixture'] ]));
        if (off.busy?.length) problems.push(`已关闭的 ${host}:${port} 在 busyEntries 里数出 ${off.busy.length} 条 ⇒ 闸门会过度拒绝`);
      }
    }
    const probeReading = probe.join('、') || '未跑（判不了）';

    /* 收尾复绿：PATH 里没有 lsof 时必须报"判不了"，换回来必须又能判。
     * 无条件跑 —— 前面任何一臂红了都不该把这一臂一起省掉。 */
    {
      const saved = process.env.PATH;
      let noLsof;
      try {
        process.env.PATH = '/nonexistent-heyta-ports-selftest';
        noLsof = listenersOn([4318]);
      } finally {
        process.env.PATH = saved;
      }
      if (!noLsof?.noLsof) problems.push('PATH 里没有 lsof 时探测腿没报"判不了" ⇒ "判不了"会被当成"没人用"');
      else if (listenersOn([4318]).noLsof) problems.push('恢复 PATH 之后 lsof 仍然判不了 ⇒ 收尾没复绿');
    }

    const carrier = deriveKillPorts(carrierDir);
    const reading = carrier.error
      ? `载体树 ${carrierDir} 判不了：${carrier.error}`
      : `载体射程 ${carrier.ports.length} 个端口（${carrier.ports.map((p) => `${p}←${carrier.owners.get(p)}`).join('、')}）`;
    return { problems, reading, errs, probeReading, carrier };
  })();
}

/* 只有被**直接运行**时才接管 --selftest：被别的工具 import 时不能让它的 argv 触发这一段
   （同形状的坑在 selfhost-capture-replay 上已经踩过一次）。 */
if (process.argv[1]?.endsWith('selfhost-kill-ports.mjs') && process.argv.slice(2).includes('--selftest')) {
  const s = await portsSelftest({ carrierDir: process.argv.slice(3).find((a) => !a.startsWith('--')) });
  process.stdout.write(`${s.reading}\n探测腿：${s.probeReading}\n`);
  s.errs.forEach((e) => process.stdout.write(`  臂读数：${e}\n`));
  if (s.problems.length) {
    process.stdout.write(`🔴 自检 ${s.problems.length} 条问题：\n - ${s.problems.join('\n - ')}\n`);
    process.exit(2);
  }
  process.stdout.write('✅ 射程判据自检：控制臂出数 + 六臂各按预期 + 假 0 与"没人用"分开 + IPv6/IPv4 单栈都可见且关闭后读成空闲 + 无 lsof 报"判不了" + 收尾复绿\n');
  process.exit(0);
}
