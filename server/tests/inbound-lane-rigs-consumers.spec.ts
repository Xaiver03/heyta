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
    const accounted = new Set([...WIRED, ...Object.keys(DELIBERATELY_NOT_WIRED)]);
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
});
