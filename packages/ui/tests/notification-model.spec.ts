import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NOTIFICATION_PREFS,
  shouldNotifyActivity,
} from '../src/sync/notification-model';

describe('偏好形状：只登记有消费者的那一档', () => {
  // 🔴 这一档是"界面不许谎称有能力"的钉子。
  //    · `taskScope`（任务提醒四档）2026-10-24 因**没有输入**被删；2026-11-23 随着
  //      `set_task_assignee` 给了 `Task.assigneeUserId` 真实写点，按原设计**恢复**（ADR-0088）。
  //    · `autoAcceptKnownCollaborators` 仍无输入（合作者名单那一档产品面不存在），**不恢复**。
  //    所以这里恰好两档：`activities` + `taskScope`。往这个形状里加**第三档而不带消费者**，这里就该红。
  it('默认偏好里恰好两档：activities + taskScope（任务提醒档已随指派写点落地）', () => {
    expect(Object.keys(DEFAULT_NOTIFICATION_PREFS)).toEqual(['activities', 'taskScope']);
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
// ── 反向那一半：指派落地后，写点与档位必须**同时**在场，且写点只在那几处 ──────────
// 2026-10-27 这一组做成**双向**的：既钉"加档位没输入会红"，也钉"输入出现了而档位没回来会红"。
// 2026-11-23 `set_task_assignee` 落地 ⇒ 指派写点真的出现了、`taskScope` 档也回来了。
// 所以这组**按新事实重钉**（不是删、不是放宽）：
//   · 写点今天**预期存在**——旧断言 `toBe(0)` 若留着会永远红，必须改成"存在且位置确定"；
//   · 档位今天**预期在**（`taskScope`）；
//   · 条件臂仍证明任一方向被单独撤掉都会红：写点>0 而偏好缺档 ⇒ `assignmentGap` 为真；
//     写点跑出一个**白名单之外**的文件 ⇒ 文件集合断言红（"没人评审过的新写路径"）。
describe('反向那一半：指派落地后——写点与档位同时在场，且写点只在那几处', () => {
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

  /**
   * 🔴 唯一所有者：给定 `[相对路径, 正文]` 返回**写点**列表（`{rel, line}`）。
   * 生产判据与变异臂调的是同一枚函数 —— 不另写一遍规则。
   * 返回列表（而不是计数）是为了让"写点落在哪些文件"能作为**集合**被钉住：
   * 计数会被行号抖动误伤，文件集合不会；而"新开一条写路径"恰恰会改变集合。
   */
  const assignmentWriteSites = (files: Array<[string, string]>): Array<{ rel: string; line: string }> => {
    const sites: Array<{ rel: string; line: string }> = [];
    for (const [rel, src] of files) {
      if (rel.endsWith('.d.ts')) continue;
      for (const line of src.split('\n')) {
        if (!line.includes(FIELD)) continue;
        if (isComment(line) || isDeclaration(line)) continue;
        sites.push({ rel, line: line.trim() });
      }
    }
    return sites;
  };

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

  /** 写点**应当**落在这几处（ADR-0088 落地时新增的那一条链 + 判它的谓词本身）。 */
  const EXPECTED_WRITE_FILES = [
    'apps/mobile/src/ai/intent-copy.ts',
    'apps/web/src/features/ai/AiToolRun.tsx',
    'packages/app-host/src/actions.ts',
    'packages/app-host/src/local-api-host.ts',
    'packages/local-api/src/tools/shared.ts',
    'packages/local-api/src/tools/task.ts',
    'packages/ui/src/sync/notification-model.ts',
  ];

  it('现量：指派已落地——写点存在、档位在、且写点文件集合恰为预期那几处', () => {
    const files = realFiles();
    const sites = assignmentWriteSites(files);
    // 反向那一半的"输入"侧：输入应当已经出现。跌回 0 就是"指派被整条撤掉"⇒ 这一档又变成空壳。
    expect(
      sites.length,
      `指派写点全没了（现量 0）⇒ 要么指派被回滚、要么遍历器瞎了；含该字段的文件：${JSON.stringify(files.map(([r]) => r))}`,
    ).toBeGreaterThan(0);
    // 🔴 断言的**集合**（按文件），不是行号/枚数：新开一条白名单之外的写路径 ⇒ 红。
    const filesWithSites = [...new Set(sites.map((s) => s.rel))].sort();
    expect(filesWithSites, '写点落到了预期之外的文件 ⇒ 见 ADR-0088；新写路径要先过评审').toEqual(
      [...EXPECTED_WRITE_FILES].sort(),
    );
    // 档位侧：偏好里有一个判 /task|remind/i 的键（现状 = `taskScope`）。
    expect(
      Object.keys(DEFAULT_NOTIFICATION_PREFS).some((k) => /task|remind/i.test(k)),
      '写点在、却没有任务提醒档 ⇒ 正是"输入出现了而档位没回来"那一形',
    ).toBe(true);
    // 条件臂在真实输入上**不**成立（写点>0 且有档 ⇒ 无 gap）。
    expect(assignmentGap(sites.length, Object.keys(DEFAULT_NOTIFICATION_PREFS))).toBe(false);
    // 分母探活（保留原来的两枚）：声明行仍被看见、候选文件数不像坏了。
    const decls = files.reduce(
      (acc, [, src]) => acc + src.split('\n').filter((l) => l.includes(FIELD)).length,
      0,
    );
    expect(decls, '一把连声明都扫不到的尺 ⇒ 它的读数没有信息量').toBeGreaterThan(0);
    const scanned = countTsFiles();
    console.log(
      `[assignment-gap 分母] 候选文件 ${scanned} 枚 · 含该字段的 ${files.length} 枚 · ` +
        `含该字段的行 ${decls} 行 · 写点 ${sites.length} 处 · 写点文件 ${filesWithSites.length} 个`,
    );
    expect(scanned, '扫到的 .ts/.tsx 少到不像整仓源码面 ⇒ 遍历器或分母坏了').toBeGreaterThan(200);
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

  it('施变臂（内存副本，不碰工作树）：写点形状要数到、声明与注释不许数、条件那一支与整条链都真的会红', () => {
    const cases: Array<[string, string, number]> = [
      ['a.ts', 'task.assigneeUserId = user.id;', 1],
      ['b.ts', "const patch = { assigneeUserId: 'u1' };", 1],
      ['c.ts', '  assigneeUserId?: string;', 0],
      ['d.ts', "  // 以后可以支持 assigneeUserId: 'u1'", 0],
      ['e.d.ts', '  assigneeUserId?: string;', 0],
    ];
    for (const [rel, src, want] of cases) {
      const got = assignmentWriteSites([[rel, src]]).length;
      expect(got, `${rel} 那一形数错（期望 ${want}）`).toBe(want);
    }
    // 条件那一支必须被走到过：合成"有写点 + 无档位"与"有写点 + 有档位"两枚输入。
    // 现状档名是 `taskScope`，所以"有档"用 `['activities','taskScope']`。
    expect(assignmentGap(1, ['activities'])).toBe(true);
    expect(assignmentGap(1, ['activities', 'taskScope'])).toBe(false);
    expect(assignmentGap(0, ['activities', 'taskScope'])).toBe(false);
    // 第三枚：把写点**接到一枚真被扫到的文件正文尾巴上**，证明"遍历器 + 谓词"这一整条链会红，
    // 而不是只有谓词有牙。判据是"比该文件基线多 1"，不是"整文件等于 1"（该文件本就有写点）。
    // 工作树一字未动。
    const real = realFiles();
    expect(real.length, '一枚候选文件都没扫到 ⇒ 这一臂没有输入').toBeGreaterThan(0);
    const first = real[0];
    if (!first) throw new Error('扫到空列表 ⇒ 这一臂没有输入（上面那枚 real.length 断言应当先红）');
    const [rel, src] = first;
    const baseline = assignmentWriteSites([[rel, src]]).length;
    expect(
      assignmentWriteSites([[rel, `${src}\nrow.assigneeUserId = ctx.user.id;\n`]]).length,
      `往真扫到的 ${rel} 尾巴上接一发写点，读数没涨 1 ⇒ 链上有一环是瞎的`,
    ).toBe(baseline + 1);
  });
});
