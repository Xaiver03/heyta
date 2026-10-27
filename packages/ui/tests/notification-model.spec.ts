import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NOTIFICATION_PREFS,
  shouldNotifyActivity,
} from '../src/sync/notification-model';

describe('偏好形状：只登记有消费者的那一档', () => {
  // 🔴 这一档是"界面不许谎称有能力"的钉子。曾经的 `taskScope`（四档）与
  //    `autoAcceptKnownCollaborators` 被删，不是因为设计变了，是因为**它们没有输入**：
  //    前者判 `Task.assigneeUserId`（全仓零写点），后者要一份还不存在的合作者名单。
  //    往这个形状里加一档而不带消费者，这里就该红。
  it('默认偏好里只有 activities 一个键', () => {
    expect(Object.keys(DEFAULT_NOTIFICATION_PREFS)).toEqual(['activities']);
    expect(Object.keys(DEFAULT_NOTIFICATION_PREFS.activities).sort()).toEqual([
      'onAdded',
      'onCompleted',
      'onDeleted',
    ]);
  });
});

describe('活动通知三类（默认全关）', () => {
  it('默认偏好：三类都不响', () => {
    expect(shouldNotifyActivity(DEFAULT_NOTIFICATION_PREFS, 'completed')).toBe(false);
    expect(shouldNotifyActivity(DEFAULT_NOTIFICATION_PREFS, 'added')).toBe(false);
    expect(shouldNotifyActivity(DEFAULT_NOTIFICATION_PREFS, 'deleted')).toBe(false);
  });

  it('开一类只响一类（其余仍静默）', () => {
    const prefs = {
      ...DEFAULT_NOTIFICATION_PREFS,
      activities: { onCompleted: true, onAdded: false, onDeleted: false },
    };
    expect(shouldNotifyActivity(prefs, 'completed')).toBe(true);
    expect(shouldNotifyActivity(prefs, 'added')).toBe(false);
    expect(shouldNotifyActivity(prefs, 'deleted')).toBe(false);
  });
});

// ── 反向那一半：「没有输入」这句不能只靠人记着 ────────────────────────────────
// 上面那枚钉子判的是**加档位没输入**（往形状里塞一档 ⇒ 红）。它判不到相反那一形：
// **输入出现了、档位没回来**。那一天真落地时（谁给任务加了指派写点），链上没有任何一枚装置会红，
// 而"这一档还没做"这句话只活在注释和交接书里 —— 正是本仓反复登记过的那形（手搭的哨兵要等于规范裁判、
// "不含 X"有两类形状只有黑名单会假绿）。这一组把它做成**双向**的。
describe('偏好形状的反向那一半：指派有了写点，这一档必须回来', () => {
  // 🔴 必须走 fileURLToPath：本仓所在路径里有空格，`new URL(...).pathname` 会把它 percent-encode 成
  //    `All%20in%20one%20Data` ⇒ 每一枚目录都 ENOENT，而那形看起来像"目录不存在 ⇒ 没有写点"。
  const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
  // 🔴 分母不许手写死：写成一串包名，下一个新包里落地指派写点时这把尺是瞎的（本仓同族教训）。
  //    现取"每个工作区包自己的 src"——`packages/*`、`apps/*`、`server`。
  const scanDirs = (): string[] => {
    const acc: string[] = [];
    for (const group of ['packages', 'apps']) {
      for (const name of readdirSync(join(REPO, group))) {
        const src = join(group, name, 'src');
        if (existsSync(join(REPO, src))) acc.push(src);
      }
    }
    if (existsSync(join(REPO, 'server/src'))) acc.push('server/src');
    return acc;
  };
  const FIELD = 'assigneeUserId';
  /** 声明形状（可选字段 / `.d.ts`）不算写点；注释行不算。 */
  const isDeclaration = (line: string): boolean => /^\s*[\w.$]*\bassigneeUserId\?\s*:/.test(line);
  const isComment = (line: string): boolean => /^\s*(\/\/|\*|\/\*)/.test(line);

  /** 唯一所有者：给定 `[相对路径, 正文]` 数出**写点**数。生产判据与变异臂调的是同一枚函数。 */
  const assignmentWriteSites = (files: Array<[string, string]>): number =>
    files.reduce((acc, [rel, src]) => {
      if (rel.endsWith('.d.ts')) return acc;
      let n = 0;
      for (const line of src.split('\n')) {
        if (!line.includes(FIELD)) continue;
        if (isComment(line) || isDeclaration(line)) continue;
        n += 1;
      }
      return acc + n;
    }, 0);

  /** 同一枚判据：写点在场而偏好缺档 ⇒ 报"欠那一档"。两半都由它说话，臂不另写一遍规则。 */
  const assignmentGap = (writeSites: number, prefKeys: string[]): boolean =>
    writeSites > 0 && !prefKeys.some((k) => /task|remind/i.test(k));

  const realFiles = (): Array<[string, string]> => {
    const acc: Array<[string, string]> = [];
    const walk = (dir: string, relDir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist' || name === '__tests__') continue;
        const full = join(dir, name);
        const rel = `${relDir}/${name}`;
        if (statSync(full).isDirectory()) walk(full, rel);
        else if (/\.tsx?$/.test(name) && !/\.spec\.tsx?$/.test(name)) {
          const src = readFileSync(full, 'utf8');
          if (src.includes(FIELD)) acc.push([rel, src]);
        }
      }
    };
    for (const d of scanDirs()) walk(join(REPO, d), d);
    return acc;
  };

  it('现量：今天零写点，且这把尺**看得见**声明（分母探活，防"匹配不到任何东西"冒充"没有"）', () => {
    const files = realFiles();
    expect(assignmentWriteSites(files), `指派写点已出现但仍判绿 ⇒ 见下面那枚条件臂：${JSON.stringify(files.map(([r]) => r))}`).toBe(0);
    const decls = files.reduce(
      (acc, [, src]) => acc + src.split('\n').filter((l) => l.includes(FIELD)).length,
      0,
    );
    expect(decls, '一把连声明都扫不到的尺 ⇒ 它的 0 没有信息量').toBeGreaterThan(0);
    // 分母探活第二枚：扫到的**候选文件数**由装置自己印，跌到个位数就说明遍历器坏了而不是树干净了。
    const scanned = countTsFiles();
    console.log(`[assignment-gap 分母] 候选文件 ${scanned} 枚 · 含该字段的 ${files.length} 枚 · 声明行 ${decls} 行`);
    expect(scanned, '扫到的 .ts/.tsx 少到不像整仓源码面 ⇒ 遍历器或分母坏了').toBeGreaterThan(200);
    expect(assignmentGap(0, Object.keys(DEFAULT_NOTIFICATION_PREFS))).toBe(false);
  });

  const countTsFiles = (): number => {
    let n = 0;
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist' || name === '__tests__' || name === 'evidence') continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) n += 1;
      }
    };
    for (const d of scanDirs()) walk(join(REPO, d));
    return n;
  };

  it('施变臂（内存副本，不碰工作树）：写点形状要数到、声明与注释不许数、条件那一支真的会红', () => {
    const cases: Array<[string, string, number]> = [
      ['a.ts', 'task.assigneeUserId = user.id;', 1],
      ['b.ts', "const patch = { assigneeUserId: 'u1' };", 1],
      ['c.ts', '  assigneeUserId?: string;', 0],
      ['d.ts', "  // 以后可以支持 assigneeUserId: 'u1'", 0],
      ['e.d.ts', '  assigneeUserId?: string;', 0],
    ];
    for (const [rel, src, want] of cases) {
      const got = assignmentWriteSites([[rel, src]]);
      expect(got, `${rel} 那一形数错（期望 ${want}）`).toBe(want);
    }
    // 条件那一支必须被走到过：合成"有写点 + 无档位"与"有写点 + 有档位"两枚输入。
    expect(assignmentGap(1, Object.keys(DEFAULT_NOTIFICATION_PREFS))).toBe(true);
    expect(assignmentGap(1, ['activities', 'taskReminder'])).toBe(false);
    expect(assignmentGap(0, ['activities', 'taskReminder'])).toBe(false);
    // 第三枚：把写点**接到一枚真被扫到的文件正文尾巴上**，证明"遍历器 + 谓词"这一整条链会红，
    // 而不是只有谓词有牙（前两臂各自证的都不是这一条）。工作树一字未动。
    const real = realFiles();
    expect(real.length, '一枚候选文件都没扫到 ⇒ 这一臂没有输入').toBeGreaterThan(0);
    const first = real[0];
    if (!first) throw new Error('扫到空列表 ⇒ 这一臂没有输入（上面那枚 real.length 断言应当先红）');
    const [rel, src] = first;
    expect(
      assignmentWriteSites([[rel, `${src}\nrow.assigneeUserId = ctx.user.id;\n`]]),
      `往真扫到的 ${rel} 尾巴上接一发写点，读数仍为 0 ⇒ 链上有一环是瞎的`,
    ).toBe(1);
  });
});
