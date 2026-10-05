/**
 * Windows 源码同步的**新鲜度对账**有没有牙：在一次性临时 git 仓里把 `ssh`/`scp` 换成
 * 本地垫片，伪造/摘掉远端侧的读数，看判据是否精确报红。
 *
 * 🔴 为什么用垫片而不是真跑打包机：这一族判据的本体是"**本地字节 == 远端字节**"这个裁决；
 * 真跑一次会把 `C:\src\heyta` 覆盖成我这棵树的状态，而那是另一条会话正在用的构建输入。
 * 垫片只回答三类远端命令（解包、`Get-FileHash`、`Measure-Object` 计数），
 * **认不出的命令退 9 并打印原文** —— 所以"判据读了一个我没模拟的形状"会响，不会静默通过。
 *
 * 证明什么：三条锚点（`index.html` / 桥 bundle / chunk 枚数）与"读不到算红"那几支会不会红。
 * 不证明什么：不证明真 PowerShell 的输出格式能被 `grep -E '^[0-9a-f]{64}$'` 解析
 * （那是真跑过的读数），也不证明 tar 传输本身。
 *
 * 两种来源各跑一遍：`--source branch`（本分支这一版）/ `--source main`（主线重写过的那一版）。
 * 🔴 main 侧才是落地之后真正会跑的代码 ⇒ 只跑 branch 版的绿**不算**这条对账过了。
 *
 * 用法：node research/tools/selfhost-windows-sync-arms.mjs [--source branch|main]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIB = 'scripts/lib/sync-windows-sources.sh';
const FAKE_HOST = '__shim_host__';
const source = (() => {
  const i = process.argv.indexOf('--source');
  const v = i < 0 ? 'branch' : process.argv[i + 1];
  if (v !== 'branch' && v !== 'main') throw new Error(`--source 只认 branch / main，收到 ${v}`);
  return v;
})();

/** 取判据本体：branch = 工作树这一份；main = `git show main:` 那一份。 */
const libText = () =>
  (source === 'branch'
    ? readFileSync(join(ROOT, LIB), 'utf8')
    : execFileSync('git', ['-C', ROOT, 'show', `main:${LIB}`], { encoding: 'utf8' }));

/** 一次性临时 git 仓：lib + 两份构建输入 + 桥生成脚本的桩。 */
function makeRepo({ withIndexHtml }) {
  const dir = mkdtempSync(join(tmpdir(), 'hta-sync-arms-'));
  const run = (args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  mkdirSync(join(dir, 'scripts/lib'), { recursive: true });
  mkdirSync(join(dir, 'apps/web/dist/assets'), { recursive: true });
  mkdirSync(join(dir, 'packages/app-host/bridge-bundle'), { recursive: true });
  mkdirSync(join(dir, 'packages/app-host/scripts'), { recursive: true });
  writeFileSync(join(dir, LIB), libText());
  writeFileSync(join(dir, 'package.json'), '{ "name": "hta-arms-fixture", "private": true }\n');
  writeFileSync(join(dir, 'apps/web/dist/assets/index-aaa.js'), 'console.log(1)\n');
  writeFileSync(join(dir, 'apps/web/dist/assets/index-bbb.js'), 'console.log(2)\n');
  if (withIndexHtml) {
    writeFileSync(join(dir, 'apps/web/dist/index.html'), '<!doctype html><title>fixture</title>\n');
  }
  // 桥生成脚本的桩：lib 无条件调它，桩只做一件事 —— 把 bundle 写出来。
  writeFileSync(
    join(dir, 'packages/app-host/scripts/build-native-bridge.mjs'),
    "import { mkdirSync, writeFileSync } from 'node:fs';\n" +
      "import { dirname, join } from 'node:path';\n" +
      "const p = join(process.cwd(), 'packages/app-host/bridge-bundle/native-bridge.js');\n" +
      "mkdirSync(dirname(p), { recursive: true });\n" +
      "writeFileSync(p, 'bridge fixture\\n');\n",
  );
  run(['init', '-q']);
  run(['add', '-A']);
  run(['-c', 'user.email=a@b', '-c', 'user.name=arms', 'commit', '-qm', 'fixture']);
  return dir;
}

const SHIM_SSH = `#!/bin/bash
set -u
# C:\\a\\b 与 C:/a/b 都映射到 $FAKE_REMOTE/a/b
map() { local p="\${1#C:}"; p="\${p//\\\\//}"; printf '%s%s' "$FAKE_REMOTE" "$p"; }
sha_of() { shasum -a 256 "$1" 2>/dev/null | awk '{print toupper($1)}'; }
fail() { echo "SHIM-UNEXPECTED: $*" >&2; exit 9; }
[ "\${1:-}" = "-o" ] && shift 2
[ "\${1:-}" = "${FAKE_HOST}" ] || fail "host 不是垫片名：\${1:-<空>}"
cmd="\${2:-}"
case "$cmd" in
  *Get-FileHash*)
    path=$(printf '%s' "$cmd" | sed -n "s/.*Get-FileHash *'\\([^']*\\)'.*/\\1/p")
    [ -n "\${path:-}" ] || fail "解析不出 Get-FileHash 的参数：$cmd"
    lp=$(map "$path")
    case "\${SHIM_CORRUPT:-}" in
      nohash) [ "\${lp##*.}" != "gz" ] && exit 0 ;;
    esac
    if [ -f "$lp" ]; then sha_of "$lp"; else fail "远端文件不存在：$lp"; fi
    ;;
  *Get-ChildItem*Measure-Object*)
    case "\${SHIM_CORRUPT:-}" in
      nochunkcount) exit 0 ;;
    esac
    d=$(map 'C:\\src\\heyta\\apps\\web\\dist\\assets')
    ls "$d"/*.js 2>/dev/null | wc -l | tr -d ' '
    ;;
  *Remove-Item*tar*-xzf*)
    tar=$(printf '%s' "$cmd" | sed -n 's/.*tar -xzf \\([^ ]*\\) .*/\\1/p')
    dest=$(printf '%s' "$cmd" | sed -n 's/.* -C \\([^ ]*\\).*/\\1/p')
    [ -n "$tar" ] && [ -n "$dest" ] || fail "解析不出解包的 tar/dest：$cmd"
    rm -rf "$(map "$dest")/apps/web/dist"
    mkdir -p "$(map "$dest")"
    tar -xzf "$(map "$tar")" -C "$(map "$dest")" || fail "解包失败"
    case "\${SHIM_CORRUPT:-}" in
      staleindex) printf 'appended\\n' >> "$(map "$dest")/apps/web/dist/index.html" ;;
      stalebridge) printf 'appended\\n' >> "$(map "$dest")/packages/app-host/bridge-bundle/native-bridge.js" ;;
      extrachunk) printf 'old\\n' > "$(map "$dest")/apps/web/dist/assets/index-ZZ-old.js" ;;
    esac
    ;;
  *) fail "没模拟过的远端命令：$cmd" ;;
esac
`;

const SHIM_SCP = `#!/bin/bash
set -u
# 真调用是 scp -q <tar> <host:C:/...>，先摘掉选项
while [ "\${1:-}" = "-q" ] || [ "\${1:-}" = "-r" ]; do shift; done
[ "$#" -eq 2 ] || { echo "SHIM-UNEXPECTED: scp 参数形状不是两枚：$*" >&2; exit 9; }
src="$1"; spec="\${2#*:}"; spec="\${spec#C:}"; spec="\${spec//\\\\//}"
[ -f "$src" ] || { echo "SHIM-UNEXPECTED: scp 源不存在：$src" >&2; exit 9; }
out="$FAKE_REMOTE$spec"
mkdir -p "$(dirname "$out")" && cp "$src" "$out"
`;

function makeShims(binDir) {
  mkdirSync(binDir, { recursive: true });
  for (const [name, body] of [['ssh', SHIM_SSH], ['scp', SHIM_SCP]]) {
    const f = join(binDir, name);
    writeFileSync(f, body);
    chmodSync(f, 0o755);
  }
}

/**
 * 臂表。`expect: 'red'` 的每条都同时断言退出码与**报红那一句的原文**，
 * 因为"退 1"可能是垫片自己挂了（`SHIM-UNEXPECTED` 也算退 1）。
 * F 是 `expect: 'hole'`：它断言的是代码**当前真的会绿**，用来把敞口钉在账上 ——
 * 哪天有人补了判据，这一臂会转红并提醒改这张表。
 */
const ARMS = [
  { id: '对照', corrupt: '', indexHtml: true, expect: 'green', needle: '远端新鲜度对账通过' },
  { id: 'A', corrupt: 'staleindex', indexHtml: true, expect: 'red', needle: 'apps/web/dist/index.html 哈希对不上' },
  { id: 'B', corrupt: 'stalebridge', indexHtml: true, expect: 'red', needle: '桥的 bundle 不新鲜' },
  { id: 'C', corrupt: 'extrachunk', indexHtml: true, expect: 'red', needle: '远端 chunk 数' },
  { id: 'D', corrupt: 'nohash', indexHtml: true, expect: 'red', needle: 'apps/web/dist/index.html 哈希对不上' },
  { id: 'E', corrupt: 'nochunkcount', indexHtml: true, expect: 'red', needle: '数不到远端' },
  { id: 'F', corrupt: '', indexHtml: false, expect: 'hole', needle: '远端新鲜度对账通过' },
];

function runArm(arm, fakeRoot) {
  const repo = makeRepo({ withIndexHtml: arm.indexHtml });
  const fakeRemote = join(fakeRoot, `${arm.id}-remote`);
  const binDir = join(fakeRoot, `${arm.id}-bin`);
  mkdirSync(join(fakeRemote, 'src'), { recursive: true });
  makeShims(binDir);
  const r = spawnSync('bash', ['-c', `cd ${JSON.stringify(repo)} && source ${JSON.stringify(LIB)} && sync_windows_sources ${FAKE_HOST}`], {
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, FAKE_REMOTE: fakeRemote, SHIM_CORRUPT: arm.corrupt },
    encoding: 'utf8',
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  rmSync(repo, { recursive: true, force: true });
  return { ...arm, rc: r.status, out };
}

const libSha = createHash('sha256').update(libText()).digest('hex').slice(0, 12);

// 🔴 本装置会写 `/tmp/heyta-src.tar.gz` 与 `/tmp/heyta-src-files.txt` —— 那正是真脚本
//    硬编码的两个临时名。并发起一次真的重装/远程构建就会互相覆盖，所以先查有没有活着的
//    宿主进程，有就退 3（环境无效，不是判据红）。
const busy = spawnSync('ps', ['-Ao', 'command'], { encoding: 'utf8' }).stdout
  .split('\n')
  .filter(
    (l) =>
      /reinstall-all\.sh|run-gradle\.mjs|verify-windows-shell-journey|package-msix/.test(l) &&
      !l.includes('selfhost-windows-sync-arms'),
  );
if (busy.length > 0) {
  console.error(`退 3：这趟窗口里有活的 Windows/Android 远程构建宿主，临时名会撞车：\n  ${busy.join('\n  ')}`);
  process.exit(3);
}

const fakeRoot = mkdtempSync(join(tmpdir(), 'hta-sync-fake-'));
const findings = [];
console.log(`# ${source} 侧 ${LIB}（sha256 前 12 = ${libSha}）· 臂数 ${ARMS.length}`);
for (const arm of ARMS) {
  const r = runArm(arm, fakeRoot);
  const shimBroke = r.out.includes('SHIM-UNEXPECTED');
  const needleOk = r.out.includes(arm.needle);
  let ok;
  let note = '';
  if (arm.expect === 'green') ok = r.rc === 0 && needleOk;
  else if (arm.expect === 'red') ok = r.rc === 1 && needleOk && !shimBroke;
  else if (r.rc === 0 && needleOk) {
    ok = true;
    note = '敞口仍在（判据在这种形状下返回 0）';
  } else {
    ok = true;
    note = '敞口已闭 ⇒ 把这条臂的 expect 改成 red，并撤销登记的缺口号';
  }
  if (!ok) findings.push(arm.id);
  const last = r.out.trim().split('\n').filter((l) => l.trim()).slice(-1)[0] ?? '';
  const tag = arm.expect === 'hole' ? '敞口' : arm.expect;
  console.log(
    `${ok ? 'OK ' : 'BAD'} ${arm.id}[${tag}] rc=${r.rc} needle「${arm.needle}」${needleOk ? '命中' : '未命中'}${shimBroke ? ' (垫片报了未模拟的命令)' : ''}${note ? ` · ${note}` : ''}${ok ? '' : ` ⇒ ${last.slice(0, 170)}`}`,
  );
}
rmSync(fakeRoot, { recursive: true, force: true });
console.log(
  findings.length === 0
    ? `结论：${ARMS.length} 臂全部按预期（对照不红、A–E 各红一次、F 记录的是当前真实行为）`
    : `结论：${findings.length} 臂不符预期：${findings.join(', ')}`,
);
process.exit(findings.length === 0 ? 0 : 1);
