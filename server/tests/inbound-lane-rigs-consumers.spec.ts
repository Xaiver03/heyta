import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOLS = join(REPO_ROOT, 'research', 'tools');

// `research/tools/verify-inbound-*` 那批装置此前没有任何自动载体：
// 所有 package.json（含各包）、scripts/、.github、根 check 链、glob 循环 五路分母现量全 0，
// 唯一的"引用"是两枚测试里的注释行 —— 装置坏了不会有人知道。这个文件接住其中能安全常驻的那些。
// 枚数不在这里写死：盘上多一枚而名单里没它 ⇒ 第一条用例红（分母自检）。
// 只接"对仓库只读"的：写盘目标全在 TemporaryDirectory / mkdtemp 里，或根本不写。
const WIRED = [
  'verify-inbound-ac-ticks.py',
  'verify-inbound-ac8-matrix.py',
  'verify-inbound-doc-tables.py',
  'verify-inbound-doc-endpoints.py',
  'verify-inbound-cjs-require-order.py',
  'verify-inbound-producer-seam.py',
  // 八处失法各起一次电池的 self_test，本机器实测整趟 2 秒 ⇒ 便宜到可以常驻。
  // 它只写临时副本，被跟踪的那份电池一个字不改。
  'verify-inbound-ac-battery-negctl.py',
];

// 反向验证臂的收尾行，逐字取自本 HEAD 上的一次真实运行（判据是退出码，这一行只挡"装置退化成什么都不判还是 0"）。
const SELF_TEST_LINE: Record<string, string> = {
  'verify-inbound-ac-ticks.py': '臂数=5，不成立=0',
  'verify-inbound-ac8-matrix.py': 'SELF_TEST=OK',
  'verify-inbound-doc-tables.py': '臂数=3，全部成立=True',
  'verify-inbound-doc-endpoints.py': '臂数=6，不成立=0',
  'verify-inbound-cjs-require-order.py': '不成立=0',
};

// 每一枚被接进来的装置要么有 self-test 腿，要么在这里写下"这一腿为什么不跑"。
const SELF_TEST_OMITTED: Record<string, string> = {
  'verify-inbound-producer-seam.py':
    '它的 --self-test 单趟实测 172 秒（其余四枚合计约 30 秒），常驻不合算；六臂已在 2026-10-12 手跑并贴进台账读数',
  // 它自己就是"给别人的臂做反向验证"的那一枚 —— 八处对照就是它的全部判据，
  // 再给它加一层 self-test 只能是把同一件事套两遍。
  'verify-inbound-ac-battery-negctl.py': '元装置：八处失法各起一次电池的 self-test，没有自己的 self-test 腿',
};

// 🔴 **只常驻反向验证臂**的那几枚：它们的判据腿要么要外部输入、要么本身就是一整串重活，
// 常驻不合算，但**臂**（测这把尺有没有牙）便宜到可以天天跑。
// chain-ownership 的判据腿在当前 HEAD 上如实就是 rc=1（第 21 道那四处真命中，见 BLOCKED.md B212）——
// 把一条"如实的红"接成常驻的"退出 0"用例，等于自己把它洗成假绿，所以那一腿留手跑。
const SELF_TEST_ONLY: Record<string, string> = {
  'verify-inbound-chain-ownership.py': 'failed=0',
  'verify-inbound-ac-battery.py': 'failed=0',
};

// 不接进来的每一枚都要写下"为什么不接"，否则分母自检那条用例会把它们当成漏网。
const DELIBERATELY_NOT_WIRED: Record<string, string> = {
  // 三枚牙臂的判据是"临时改写被跟踪的源文件、再从不带 git 的备份还原"（queue-teeth 的 TARGET
  // 就是 server/src/automation/inbound.routes.ts）。挂进并发跑的测试套件 = 在共享检出里开一段
  // 源码被改坏的窗口，别的用例会读到它（AGENTS §8.9 要求这类独占验收），只能手跑。
  'verify-inbound-queue-teeth.py': '变异臂临时改写被跟踪源文件后还原，不能进并发测试（AGENTS §8.9 独占验收）',
  'verify-inbound-quota-teeth.py': '同上',
  'verify-inbound-ticket-teeth.py': '同上',
  'verify-inbound-api-slice.py': '切片已落进 HEAD，它自退 3 = 入库工具退役，不该常驻',
  'verify-inbound-host-options-slice.py': '同上（自退 3 的退役信号）',
  'verify-inbound-worker-identity.py': '要起一次性 PostgreSQL；它的用例由 server/package.json 的 test:integration:postgres 消费',
  'verify-inbound-dual-host.py':
    '要两条真宿主 + 真服务端；同一批故障窗口由 tests/integration/inbound-dual-host-fault-windows.integration.spec.ts 消费',
  'verify-inbound-commit-scope.py': 'BLOCKED.md B169：当前 rc=1 且红因在别线的主题提及，接进来会把别人的红写成本线的红',
  'verify-inbound-plan-audit.ts': 'BLOCKED.md B184：前提已被日历线改掉（rc=1），且 .ts 那枚不在本线地界内',
  'verify-inbound-check-chain.py': '它自己就是"逐道跑完整条 check 链"的载体，接进单测会自我递归',
  // 2026-10-20 合并 feat/paycenter-integration 时补登记：这枚尺在 main 上已存在（PROGRESS 第 141 条）却从没进过任何名单，
  // 于是这条分母自检把它当成漏网 ⇒ server 单测真红。它读的是仓外本机取证目录（`~/.heyta-evidence/**`，不受 git 管），
  // 在没有那批件的克隆上会因缺件而红；第 141 条 ⑤ 又明文写着不接进 28 腿电池与 116 道链（两处都会改动已交付的分母）。
  // 八枚反向验证臂由它自己的 `--self-test` 带（只在临时目录造样本），判据腿留手跑。
  'verify-inbound-evidence-pointers.py':
    '判据腿要看仓外本机取证目录，无那批件的机器上必红；PROGRESS 第 141 条 ⑤ 写明不接进电池与链（会改动已交付分母），留手跑',
};

function runRig(file: string, extraArgs: string[] = []) {
  return spawnSync('python3', [join(TOOLS, file), ...extraArgs], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 300_000,
  });
}

function describeRun(file: string, args: string[], r: { stdout?: string; stderr?: string }) {
  return `${file} ${args.join(' ')}\n--- stdout ---\n${r.stdout ?? ''}\n--- stderr ---\n${r.stderr ?? ''}`;
}

describe('本线装置的自动消费者', () => {
  beforeAll(() => {
    const probe = spawnSync('python3', ['-c', 'print(1)'], { encoding: 'utf8' });
    if (probe.status !== 0) {
      throw new Error('本线装置需要 python3；缺它这条判据不能静默通过');
    }
  });

  it('research/tools 里没有"造出来却没人消费"的新装置', () => {
    const all = readdirSync(TOOLS)
      .filter((name) => /^verify-inbound-.+\.(py|ts)$/.test(name))
      .sort();
    const accounted = new Set([...WIRED, ...Object.keys(SELF_TEST_ONLY), ...Object.keys(DELIBERATELY_NOT_WIRED)]);
    expect(all.filter((name) => !accounted.has(name))).toEqual([]);
    // 名单里也不许留着盘上已经不存在的装置 —— 那会让上面那条判据的分母悄悄缩小
    expect([...accounted].filter((name) => !all.includes(name))).toEqual([]);
  });

  it('接进来的每一枚要么有 self-test 腿，要么写下这一腿为什么不跑', () => {
    expect(WIRED.filter((f) => !(f in SELF_TEST_LINE) && !(f in SELF_TEST_OMITTED))).toEqual([]);
    expect(Object.keys(SELF_TEST_OMITTED).filter((f) => !WIRED.includes(f))).toEqual([]);
  });

  for (const file of WIRED) {
    it(`${file} 退出 0`, () => {
      const r = runRig(file);
      expect(r.status, describeRun(file, [], r)).toBe(0);
      expect((r.stdout ?? '').trim().length, describeRun(file, [], r)).toBeGreaterThan(0);
    }, 300_000);
  }

  for (const [file, okLine] of Object.entries(SELF_TEST_LINE)) {
    it(`${file} --self-test 的反向验证臂全成立`, () => {
      const r = runRig(file, ['--self-test']);
      expect(r.status, describeRun(file, ['--self-test'], r)).toBe(0);
      expect(r.stdout ?? '', describeRun(file, ['--self-test'], r)).toContain(okLine);
    }, 300_000);
  }

  for (const [file, okLine] of Object.entries(SELF_TEST_ONLY)) {
    it(`${file} --self-test 的臂常驻成立（判据腿按 B212 留手跑）`, () => {
      const r = runRig(file, ['--self-test']);
      expect(r.status, describeRun(file, ['--self-test'], r)).toBe(0);
      expect(r.stdout ?? '', describeRun(file, ['--self-test'], r)).toContain(okLine);
    }, 300_000);
  }
});
