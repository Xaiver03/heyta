/**
 * CLI 的三类实体写命令**参数解析**行为（§10.223 留的那条边界的另一半）
 * ==================================================================
 *
 * §10.223 那条用例打的是 `NodeHost` 的公开通道；这个文件打的是**命令行本身**：
 * 子命令怎么分流、缺参数怎么响亮失败、`--json` 那条信封长什么样。
 *
 * 🔴 为什么这两层都要有：`host.trashRows()` 有牙不代表 `notes remove` 真的把参数递到了它身上。
 * 本批给 CLI 新加的六个分支（`notes|projects|habits` × `add|remove`）如果只在类型检查里过过，
 * 那么"seed 时四类各建一条删一条"这条路会在**下一次真跑的人**手上才第一次现形 ——
 * 而 seed 失败的界面症状是"回收站里只画了任务"，长得和"功能没做"一模一样（§10.219 那条教训）。
 *
 * ⚠️ 这里 spawn 的是 **`dist/cli.js`（构建产物）**，不是源码 —— 与 `cli-ai-e2e.spec.ts` 同一把尺。
 *    所以跑之前必须 `pnpm --filter @heyta/node-host build`，否则测的是旧产物（AGENTS §7 第 27 条那个形状）。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'dist', 'cli.js');

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: readonly string[], db: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, '--db', db, ...args], {
      env: process.env as Record<string, string>,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString('utf8');
    });
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString('utf8');
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const dirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-cli-trash-'));
  dirs.push(dir);
  return join(dir, 'heyta.sqlite');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('CLI 写子命令：notes / projects / habits 的 add 与 remove', () => {
  it('add 回 id、remove 认这个 id、`trash --json` 里出现这一行（四类各走一遍）', async () => {
    const db = tempDb();
    const cases = [
      { kind: 'notes', verbArg: '命令行便签正文' },
      { kind: 'projects', verbArg: '命令行清单' },
      { kind: 'habits', verbArg: '命令行习惯' },
      { kind: 'add', verbArg: '命令行任务' },
    ] as const;

    for (const { kind, verbArg } of cases) {
      const addArgs = kind === 'add' ? ['add', verbArg, '--json'] : [kind, 'add', verbArg, '--json'];
      const added = await runCli(addArgs, db);
      expect(added.code, `${kind} add 没退 0：${added.stderr}`).toBe(0);
      const id = String(JSON.parse(added.stdout).id);
      expect(id.length, `${kind} add 的 --json 信封里没有 id`).toBeGreaterThan(0);

      const removeArgs = kind === 'add' ? ['remove', id, '--json'] : [kind, 'remove', id, '--json'];
      const removed = await runCli(removeArgs, db);
      expect(removed.code, `${kind} remove 没退 0：${removed.stderr}`).toBe(0);

      const trashed = await runCli(['trash', '--json'], db);
      expect(trashed.code, `trash 没退 0：${trashed.stderr}`).toBe(0);
      const rows = JSON.parse(trashed.stdout).rows as { id: string }[];
      expect(rows.map((row) => row.id), `${kind} 删掉了却没在回收站里列出来`).toContain(id);
    }
  }, 120_000);

  it('缺参数与不认识的子命令都必须响亮失败（不许静默当成"列出"）', async () => {
    const db = tempDb();
    const missing = await runCli(['notes', 'add', '--json'], db);
    expect(missing.code, '`notes add` 少正文却退 0 ⇒ 命令自己把缺参数咽下去了').not.toBe(0);
    expect(missing.stderr + missing.stdout).toContain('需要');

    // 🔴 证据词从 `habits list` 换成 `habits bogus`：**list 现在是合法动词了**（#110 补的通道）。
    //    拿一个已经被实现的词当"未知命令"的用例，会在有人补通道的那一刻悄悄变成一条恒绿 ——
    //    所以这里同时留一条正向腿，证明换词不是把判据放宽。
    const goodList = await runCli(['habits', 'list', '--json'], db);
    expect(goodList.code, '`habits list` 是这条命令的读通道，却退了非 0').toBe(0);
    expect(JSON.parse(goodList.stdout).ok).toBe(true);

    const badVerb = await runCli(['habits', 'bogus'], db);
    expect(badVerb.code, '`habits bogus` 不是这条命令，却被当成成功').not.toBe(0);
    expect(badVerb.stderr + badVerb.stdout).toContain('需要');
  }, 60_000);
});

/**
 * 回收站的**还原**与**彻底删除**：四类都得能做（本轮现量到的 CLI 缺口）
 * ================================================================
 *
 * 原来这个壳是"读宽写窄"：`trash` 能把四路都列出来，但只有任务能 purge、
 * 四类都不能 restore。于是 W6 的判据 ③（"还原之后这台设备读到它还活着"）
 * 在这个宿主上**只能读、不能验** —— 而界面两端都画得出这两颗按钮。
 *
 * 🔴 判据必须把**三个状态**分开（列表里活着 / 只在回收站里 / 两处都没有）：
 *    只查"回收站里没了"的话，一次失败的 restore（其实发生了 purge）也会读成过。
 *    四类都得有列表读通道才算这条用例成立 —— `habits` 原来没有（登记成 #110，本轮补上），
 *    于是末尾那条分母腿把"恰好 4 类走过列表"钉死：少一个通道就红，而不是静默退化。
 */
describe('CLI 回收站的 restore 与 purge：四类各走"删 → 在回收站 → 还原 → 活着 → 再删 → purge → 两处都没"', () => {
  it('四类逐条走完三态，且新建未删的那条作为阳性对照', async () => {
    const db = tempDb();
    const kinds = [
      // 任务走顶层命令（add / remove / restore / purge），其余三类走子命令动词。
      { add: (t: string) => ['add', t], act: (v: string, id: string) => [v, id], list: ['list'], text: '验收任务' },
      { add: (t: string) => ['notes', 'add', t], act: (v: string, id: string) => ['notes', v, id], list: ['notes'], text: '验收便签' },
      {
        add: (t: string) => ['projects', 'add', t],
        act: (v: string, id: string) => ['projects', v, id],
        list: ['projects'],
        text: '验收清单',
      },
      {
        add: (t: string) => ['habits', 'add', t],
        act: (v: string, id: string) => ['habits', v, id],
        // #110 补的那一格：没有它，习惯这一类只能走回收站那一腿，purge 那一腿不可判。
        list: ['habits'],
        text: '验收习惯',
      },
    ] as const;

    let listLegCovered = 0;

    for (const kind of kinds) {
      const added = await runCli([...kind.add(kind.text), '--json'], db);
      expect(added.code, `${kind.text} add 没退 0：${added.stderr}`).toBe(0);
      const id = String(JSON.parse(added.stdout).id);

      const trashIds = async (): Promise<string[]> => {
        const r = await runCli(['trash', '--json'], db);
        expect(r.code, `trash 没退 0：${r.stderr}`).toBe(0);
        return (JSON.parse(r.stdout).rows as { id: string }[]).map((row) => row.id);
      };
      const aliveInList = async (): Promise<boolean> => {
        // ⚠️ 这一腿的写法在第一版是"没有列表通道就返回 true"，于是 purge 之后那句
        //    "列表里读不到"变成一条**永远不可能成立**的断言 —— 第一次跑整包就撞红。
        //    沉默的替值会把判据变成装饰；现在四类都有通道（#110），所以这里不再有任何替值。
        const r = await runCli([...kind.list, '--json'], db);
        expect(r.code, `列表读通道没退 0：${r.stderr}`).toBe(0);
        return r.stdout.includes(id);
      };

      // 阳性对照：刚建的那条**不在**回收站里（否则"purge 后不在回收站"是恒真的）
      expect(await trashIds(), `${kind.text} 刚建好就出现在回收站里`).not.toContain(id);

      const removed = await runCli([...kind.act('remove', id), '--json'], db);
      expect(removed.code, `${kind.text} remove 没退 0：${removed.stderr}`).toBe(0);
      expect(await trashIds(), `${kind.text} 删了却没进回收站`).toContain(id);

      const restored = await runCli([...kind.act('restore', id), '--json'], db);
      expect(restored.code, `${kind.text} restore 没退 0：${restored.stderr}`).toBe(0);
      expect(await trashIds(), `${kind.text} 还原后仍留在回收站里`).not.toContain(id);
      expect(await aliveInList(), `${kind.text} 还原后列表里读不到它（还原没生效）`).toBe(true);

      await runCli([...kind.act('remove', id), '--json'], db);
      const purged = await runCli([...kind.act('purge', id), '--json'], db);
      expect(purged.code, `${kind.text} purge 没退 0：${purged.stderr}`).toBe(0);
      expect(await trashIds(), `${kind.text} purge 之后回收站还列着它`).not.toContain(id);
      expect(await aliveInList(), `${kind.text} purge 之后列表里还读得到它（没真删）`).toBe(false);
      listLegCovered += 1;
    }
    // 🔴 分母腿：四类**都得**走过列表那一腿。第一版这里写成 `toBeGreaterThanOrEqual(3)`
    //    是因为 `habits` 那时没有通道 —— 容忍一个缺口，判据就会朝那个方向退化。
    //    通道补齐了，计数就钉成恰好 4：少一类（或将来第五类没接）当场红。
    expect(listLegCovered, '走过列表读通道那一腿的种类数不对（判据在退化）').toBe(4);
  }, 300_000);

  /**
   * 归档与软删除是**两件事**（ADR-0048：归档不进回收站、也不进任何出口）。
   *
   * 🔴 这一条钉的是最容易混的那一格：`projects archive` 如果其实发的是软删除 op，
   *    界面上"归档"和"删除"就会变成同一个开关，而回收站会开始显示用户从没删过的清单。
   *    所以判据必须**两边都读**：列表里不出现 ⇒ 出口收住了；回收站里不出现 ⇒ 它不是软删除。
   */
  it('projects archive ⇒ 列表里读不到，但回收站里也读不到；unarchive ⇒ 回列表', async () => {
    const db = tempDb();
    const added = await runCli(['projects', 'add', '归档验收清单', '--json'], db);
    expect(added.code, `projects add 没退 0：${added.stderr}`).toBe(0);
    const id = String(JSON.parse(added.stdout).id);

    const inList = async (): Promise<boolean> => {
      const r = await runCli(['projects', '--json'], db);
      expect(r.code, `projects 列表没退 0：${r.stderr}`).toBe(0);
      return r.stdout.includes(id);
    };
    const inTrash = async (): Promise<boolean> => {
      const r = await runCli(['trash', '--json'], db);
      expect(r.code, `trash 没退 0：${r.stderr}`).toBe(0);
      return (JSON.parse(r.stdout).rows as { id: string }[]).some((row) => row.id === id);
    };

    // 阳性对照：刚建的清单在列表里、且不在回收站里
    expect(await inList(), '新建的清单没出现在列表读通道里（这条判据的分母是空的）').toBe(true);
    expect(await inTrash(), '新建的清单不该在回收站里').toBe(false);

    const archived = await runCli(['projects', 'archive', id, '--json'], db);
    expect(archived.code, `projects archive 没退 0：${archived.stderr}`).toBe(0);
    expect(await inList(), '归档之后列表里还读得到 ⇒ 归档没生效（W9：归档清单不进任何出口）').toBe(false);
    expect(await inTrash(), '归档的清单出现在回收站里 ⇒ 归档被实现成了软删除（ADR-0048 的两态被压成一态）').toBe(false);

    const unarchived = await runCli(['projects', 'unarchive', id, '--json'], db);
    expect(unarchived.code, `projects unarchive 没退 0：${unarchived.stderr}`).toBe(0);
    expect(await inList(), '取消归档后列表里读不到它').toBe(true);
    expect(await inTrash(), '取消归档却把清单落进了回收站').toBe(false);
  }, 180_000);
});

/**
 * 「没做成」与「做成了」在这个宿主上必须是两句话（G-8 的出口）
 * ==========================================================
 *
 * 动作层有四条"这一句什么都没写"的分支（任务 restore/purge 原来是 `void`，
 * 其余三类的 purge 也是），而这里原来每个分支各写一遍 `out(\`${write.label} ${id}\`)`
 * —— 于是一句关于**不可逆动作**的书面凭据（"已彻底删除"）在什么都没发生时被打印出来，
 * 而 `--json` 的信封里只有一个 `ok: true`，脚本读不出区别。
 *
 * 🔴 判据两侧都要读：**正向对照**证明"真的写了一次"仍然说成功字样（否则这条用例会被
 *    "永远报未写入"这种更坏的修法骗过去），**负向腿**证明没写时那两个成功字样不许出现。
 * 🔴 两路都要读：顶层任务走的是 `case 'restore'` 那一段，**不在** `trashWrites` 那张表里 ——
 *    只测子命令那一路的话，任务那一格的修复可以完全不落地而用例照样绿。
 */
describe('CLI 的 no-op 出口：动作层返回 false 时不许打印成功字样', () => {
  const legs = [
    { name: '任务', add: (t: string) => ['add', t], act: (v: string, id: string) => [v, id] },
    { name: '便签', add: (t: string) => ['notes', 'add', t], act: (v: string, id: string) => ['notes', v, id] },
  ] as const;

  for (const leg of legs) {
    it(`${leg.name}：对活着的 restore、对已 purge 的再 purge，都说"未写入"；真的写了那两次仍说成功`, async () => {
      const db = tempDb();
      const added = await runCli([...leg.add(`G-8 验收${leg.name}`), '--json'], db);
      expect(added.code, `${leg.name} add 没退 0：${added.stderr}`).toBe(0);
      const id = String(JSON.parse(added.stdout).id);

      // ① 刚建好的这条**活着**，restore 它是 no-op（动作层返回 false，没写 op）。
      const noopJson = await runCli([...leg.act('restore', id), '--json'], db);
      expect(noopJson.code, `no-op 不该把命令判成失败：${noopJson.stderr}`).toBe(0);
      expect(
        JSON.parse(noopJson.stdout).opWritten,
        '一条本来就在回收站外的被记成"写入了 op"—— 界面/脚本据此会说"已还原"',
      ).toBe(false);
      const noopText = await runCli(leg.act('restore', id), db);
      expect(noopText.stdout, '什么都没写的一行却打印了成功字样').not.toContain('已还原');
      expect(noopText.stdout).toContain('未写入');

      // ② 正向对照（JSON 侧）：真的还原一次 ⇒ opWritten 必须回到 true。
      const removed = await runCli([...leg.act('remove', id), '--json'], db);
      expect(removed.code, `${leg.name} remove 没退 0：${removed.stderr}`).toBe(0);
      const realRestore = await runCli([...leg.act('restore', id), '--json'], db);
      expect(
        JSON.parse(realRestore.stdout).opWritten,
        '真的还原了一次却报未写入 ⇒ 这条判据会被"永远报未写入"的修法骗过去',
      ).toBe(true);

      // ③ 正向对照（文本侧）+ ④ 真的 purge 之后再 purge ⇒ 第二句没有成功字样。
      await runCli([...leg.act('remove', id), '--json'], db);
      const purgeText = await runCli(leg.act('purge', id), db);
      expect(purgeText.stdout, `${leg.name} 第一次 purge 没说成功字样`).toContain('已彻底删除');
      const noopPurgeText = await runCli(leg.act('purge', id), db);
      expect(noopPurgeText.stdout, '已经彻底删除的那条又被报成"已彻底删除"').not.toContain('已彻底删除');
      expect(noopPurgeText.stdout).toContain('未写入');
      const noopPurgeJson = await runCli([...leg.act('purge', id), '--json'], db);
      expect(JSON.parse(noopPurgeJson.stdout).opWritten).toBe(false);
    }, 300_000);
  }
});
