/**
 * 附件接进 web 详情面（工单 #9 的移植，2026-11-05）
 * ===================================================
 *
 * 这一单不是"发明附件"，是**把移动端那一份抬到共享层并接上 web 的详情面**：
 * 领域规则（`@heyta/domain/src/attachments.ts`）、写路径
 * （`@heyta/app-host/src/attachment-actions.ts`）、移动端的参考实现
 * （`apps/mobile/src/screens/TaskDetailSheet.tsx`）本来就在，
 * 而 web 侧此前的引用数是 **0**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这一族钉的是"真的挂在详情面上、真的进了同一份数据"，不是"画了个框"
 *
 * 判据 ① 的形状是三条**同时**成立（少一条这个功能就只是在本端自娱自乐）：
 *
 *   a. 在 web 上**加**一个附件 → 列表里出现；
 *   b. **刷新**（丢掉内存里的引擎、从 IndexedDB 重新恢复）后它**还在** ——
 *      这一条把"只活在 React state 里"的实现直接判死；
 *   c. 那条实体在**物化状态**里、带着**服务端回执**的字节数
 *      （`currentState().attachments[id].sizeBytes === 服务端说的大小`）——
 *      移动端读的是同一份 op-log，所以"移动端也能看到"与 c 是同一条判据；
 *      反过来，若大小是客户端按 base64 长度估的，这里会对不上。
 *
 * 判据 ②（去掉挂载点 ⇒ ① 必须失败）由**变异实测**给出，不是靠这里再多一条断言：
 * 把 `TaskDetailCard.tsx` 里那行 `<AttachmentField … />` 删掉之后，
 * 本文件第一条用例当场红在"栏里没有附件区"。下面 {@link 判据二} 那一族留了一条
 * **源码形状**的钉子，防的是"挂载点被悄悄挪走、而用例还在别处绿"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 零 mock（只有网络边界之外的一切都是真的）
 *
 * 真 op-log（fake-indexeddb）、真 `createAttachmentActions`、真
 * `createAttachmentBlobPort`、真 `encodeBase64` 那条读文件的链（jsdom 的 `File`
 * 与 `arrayBuffer`）。唯一被替掉的是 `globalThis.fetch` —— 那是**网络边界**，
 * 而"服务端回了什么"必须由用例决定（`byteCount` 是判据 c 的输入）。
 * 这与 `ticktick-import.spec.tsx` 的 `chooseFile()` 是同一个手法。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAttachmentActions } from '@heyta/app-host';
import { I18nProvider, zhCN } from '@heyta/i18n';
import { HeytaUiProvider } from '@heyta/ui';

import { __resetOpLogForTests, initOpLog, useTaskStore } from '../src/features/tasks/store.js';
import { useSyncStore } from '../src/features/sync/store.js';
import { selection } from '../src/lib/selection.js';
import { currentState, dispatchIntent } from '../src/lib/oplog.js';

const { TaskDetailCard } = await import('../src/features/tasks/TaskDetailCard.js');

/** 服务端"测到"的字节数。**故意与文件本身（3 字节）不同** —— 判据 c 靠这个分辨真伪。 */
const SERVER_BYTE_COUNT = 2_048;
/** 服务端回执里的 hash。判据不读它，但它必须有（`sendJson` 对"2xx 但形状不对"很硬）。 */
const SERVER_HASH = 'sha256-test-only';

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let dbName = '';
/** 这一轮用例里 `fetch` 被打了几次、打的什么。 */
let calls: Array<{ readonly url: string; readonly method: string }> = [];

function mount(): void {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <HeytaUiProvider>
          <TaskDetailCard />
        </HeytaUiProvider>
      </I18nProvider>,
    );
  });
}

/** 让出到宏任务队列，等 fetch / fake-indexeddb / React 都落定。 */
async function settle(rounds = 40): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function addTask(title: string): Promise<string> {
  await act(async () => {
    await useTaskStore.getState().addTask(title);
  });
  const id = Object.keys(useTaskStore.getState().entities.tasks).find(
    (key) => useTaskStore.getState().entities.tasks[key]?.title === title,
  );
  if (id === undefined) throw new Error(`建不出任务 ${title} ⇒ 这一族判据在空转`);
  await settle();
  return id;
}

const pane = (): HTMLElement => {
  const box = document.querySelector<HTMLElement>('[data-testid="task-pane"]');
  if (box === null) throw new Error('详情面没画出来 ⇒ 这一族判据在空转');
  return box;
};

const attachmentRows = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('[data-testid^="attachment-row-"]'),
];

/** 把一份文件"填"进那个隐藏的 file input 并触发 change（用户选文件的等价物）。 */
async function chooseFile(name: string, body: string, type = 'application/pdf'): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('[data-testid="task-attachment-file-input"]');
  if (input === null) throw new Error('没找到选文件的入口 ⇒ 判据在空转');
  const file = new File([body], name, { type });
  // jsdom 不允许直接设置 `files`，用 defineProperty 造出"用户选了文件"这个状态。
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // 异步链（FileReader → fetch → op-log → 引擎通知）要在这个 act 里落定，
    // 否则 React 会在 act 之外收到状态更新，测试输出被一片 warning 糊住。
    await settle();
  });
}

/** 物化状态里这条任务下的附件（读的是 op-log 的事实源，不是界面的列表）。 */
function attachmentsOf(taskId: string): Array<{ id: string; fileName: string; sizeBytes?: number }> {
  return Object.values(currentState().attachments).filter(
    (row) => row.taskId === taskId && row.deletedAt === undefined,
  );
}

beforeEach(async () => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  (globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;
  localStorage.clear();
  selection.clear();
  __resetOpLogForTests();
  dbName = `task-attachments-${Math.random().toString(36).slice(2)}`;
  await initOpLog(dbName);
  useTaskStore.setState({ filter: { kind: 'all' } });
  // 服务端地址与令牌：`createAttachmentBlobPort` 两个都读，缺一个就直接回 rejected
  // 而一个请求都不发 —— 那种情况下判据 ① 量到的是"没配服务端"，不是"链路通"。
  useSyncStore.setState({ baseUrl: 'https://sync.example', token: 'test-token' });

  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET' });
    return {
      ok: true,
      status: 200,
      json: async () => ({ hash: SERVER_HASH, byteCount: SERVER_BYTE_COUNT, releasedBytes: SERVER_BYTE_COUNT }),
      // `sendJson` 只在 429 上读它；这里给一个最小形状，免得某天分支变化时崩在 undefined。
      headers: { get: () => null },
    } as unknown as Response;
  }) as typeof fetch;
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  selection.clear();
});

describe('附件区挂载在详情面上（判据 ②：去掉挂载点 ⇒ 这一族必须红）', () => {
  it('🔴 选中一条任务 ⇒ 栏里有「附件」区、空态与「添加附件」入口', async () => {
    const id = await addTask('附件挂载点');
    selection.select('task', id);
    mount();

    const box = pane();
    // 区域头借的是移动端那条词条（`packages/i18n` 是黑名单，不许新起 web 词条）。
    expect(box.querySelector('[data-testid="task-detail-attachments"]')?.textContent).toContain(
      zhCN['mobile.detail.attachments.title'],
    );
    expect(
      box.querySelector('[data-testid="task-attachments"]'),
      '附件区没画出来 —— 判据 ② 的形态：把 TaskDetailCard 里那行 <AttachmentField/> 删掉，这里会当场红',
    ).not.toBeNull();
    // 空态走的是**共享** EmptyState（`check:empty-state` 的唯一修法），它的 testID 由宿主传进去。
    expect(box.querySelector('[data-testid="task-attachments-empty"]')?.textContent).toBe(
      zhCN['mobile.detail.attachments.empty'],
    );
    expect(box.querySelector('[data-testid="attachment-add"]')?.textContent).toContain(
      zhCN['mobile.detail.attachments.add'],
    );
  });

  it('🔴 判据 ② 的源码钉子：面单里那一行挂载点还在（挪走/注释掉即红）', async () => {
    // ⚠️ 用 `process.cwd()` 而不是 `import.meta.url`：vitest 的 jsdom 环境给的是
    // `http://localhost/...` 那种 URL，`readFileSync` 会当场抛 "must be of scheme file"。
    const source = readFileSync(join(process.cwd(), 'src/features/tasks/TaskDetailCard.tsx'), 'utf8');
    /**
     * ⚠️ 这是**形状断言**，不是行为断言：它不能证明"挂对了位置"（那是上面那条用例），
     * 它防的是"挂载点被删掉而用例因为别的原因仍绿"那一类静默
     * —— 与 `apps/mobile/tests/attachment-entry.spec.ts` 同一条手法。
     */
    expect(source).toMatch(/<AttachmentField\b/u);
    expect(source).toMatch(/<AttachmentList\b/u);
  });

  it('🔴 区块头只说一次「附件」—— 不把 `{n} 个附件` 叠在它后面', async () => {
    const id = await addTask('附件区块头');
    selection.select('task', id);
    mount();
    await chooseFile('计数.pdf', 'abc');

    const heading = document.querySelector('[data-testid="task-detail-attachments"]');
    // `mobile.detail.attachments.count` 的模板是 `{n} 个附件`：叠在「附件」后面
    // 会连读成「附件 1 个附件」（真浏览器截图里就是这个）。移动端那一格是这个形状，
    // web 这一格刻意不跟 —— 列表本身已经说清了数量和内容。
    expect(heading?.textContent).toBe(zhCN['mobile.detail.attachments.title']);
    expect(document.querySelector('[data-testid="task-detail-attachments-count"]')).toBeNull();
  });
});

describe('判据 ①：加附件 → 刷新仍在 → 同一份数据（移动端读的也是它）', () => {
  it('🔴 加一个附件 ⇒ 列表出现 ⇒ 引擎从 IndexedDB 重新恢复后它还在，且大小是服务端回执的那个数', async () => {
    const taskId = await addTask('带附件的任务');
    selection.select('task', taskId);
    mount();

    await chooseFile('合同.pdf', 'abc');

    // a. 列表里出现，且体积来自**服务端回执**（2048 → 2 KB），不是按 base64 长度估的。
    const rows = attachmentRows();
    expect(rows, '加完附件后列表里没有它').toHaveLength(1);
    const rowText = rows[0]?.textContent ?? '';
    expect(rowText).toContain('合同.pdf');
    expect(rowText).toContain('2 KB');
    expect(calls.map((call) => call.method)).toEqual(['PUT']);
    expect(calls[0]?.url).toBe(new URL('/api/attachments/' + entityIdOf(taskId), 'https://sync.example').toString());

    // b/c. **刷新**：丢掉内存里的引擎，从同一份 IndexedDB 重新恢复。
    //         这一条正是"只活在本端 state 里"的实现的死因 —— 那种实现恢复之后列表会空。
    const beforeReload = attachmentsOf(taskId);
    expect(beforeReload, 'op 没进物化状态 ⇒ 它只活在界面里').toHaveLength(1);
    expect(beforeReload[0]?.sizeBytes).toBe(SERVER_BYTE_COUNT);

    act(() => {
      root?.unmount();
    });
    container?.remove();
    __resetOpLogForTests();
    await initOpLog(dbName);
    await settle();
    mount();
    await settle();

    const afterReload = attachmentRows();
    expect(afterReload, '刷新之后列表空了 ⇒ 它没有落进 op-log').toHaveLength(1);
    expect(afterReload[0]?.textContent ?? '').toContain('合同.pdf');
    expect(attachmentsOf(taskId)[0]?.sizeBytes).toBe(SERVER_BYTE_COUNT);

    /**
     * d. **另一端读得到**：移动端那一格调的就是这个函数
     *    （`TasksScreen.tsx` 建 `createAttachmentActions(host, {blobs})` 之后，
     *    `TaskDetailSheet` 里 `attachmentActions.attachmentsForTask(task.id)`）。
     *    这里用**不带 `blobs` 的**动作集调同一个方法 —— 与移动端"只读"那一半逐字相同，
     *    所以它读到的就是手机上将画出来的那几行。同一份 op-log，不是本端另存了一份。
     */
    const mobileReader = createAttachmentActions({
      dispatch: (intent) => dispatchIntent(intent),
      getState: currentState,
    });
    expect(mobileReader.attachmentsForTask(taskId).map((row) => row.fileName)).toEqual(['合同.pdf']);
    expect(mobileReader.attachmentBytesForTask(taskId)).toBe(SERVER_BYTE_COUNT);
  });

  it('上传被拒 ⇒ **一个字节都不进 op-log**，列表仍是空的，并说出那句该说的话', async () => {
    const taskId = await addTask('配额满了');
    selection.select('task', taskId);
    mount();
    // 服务端说额度满：`ATTACHMENT_ERROR_CODES.quotaExceeded` 那条机器码。
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET' });
      return {
        ok: false,
        status: 507,
        json: async () => ({ code: 'STORAGE_QUOTA_EXCEEDED' }),
        headers: { get: () => null },
      } as unknown as Response;
    }) as typeof fetch;

    await chooseFile('大文件.zip', 'abcdef');

    expect(attachmentRows(), '上传失败却出现了列表项 ⇒ 写了一条没有字节的 op').toHaveLength(0);
    expect(attachmentsOf(taskId)).toHaveLength(0);
    const alert = document.querySelector('[data-testid="task-attachment-error"]');
    expect(alert?.getAttribute('role')).toBe('alert');
    // 两种"不行"必须说两句话：额度满要用户去清理已有内容，文件太大要换一个文件。
    expect(alert?.textContent).toBe(zhCN['mobile.detail.attachments.error.quota-exceeded']);
  });
});

describe('删除：二次确认 + 真写 op', () => {
  it('🔴 点一次「移除」只打开确认框（**不删**），确认之后才真的移走', async () => {
    const taskId = await addTask('要删附件的任务');
    selection.select('task', taskId);
    mount();
    await chooseFile('待删.pdf', 'abc');
    const attachmentId = entityIdOf(taskId);
    expect(attachmentRows()).toHaveLength(1);

    // 第一下：确认框出现，列表**原样**（危险动作不许"点了就做"）。
    const removeButton = document.querySelector<HTMLElement>(`[data-testid="attachment-remove-${attachmentId}"]`);
    if (removeButton === null) throw new Error('没找到移除按钮 ⇒ 判据在空转');
    await act(async () => {
      removeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await settle();
    });

    const dialog = document.querySelector('[data-testid="task-attachment-remove-confirm"]');
    expect(dialog, '点移除没有二次确认 ⇒ 危险档没接上').not.toBeNull();
    // 确认框要**复述对象**（删的是哪一个），否则一列同款按钮问不出个所以然。
    expect(document.querySelector('[data-testid="task-attachment-remove-confirm-name"]')?.textContent).toBe('待删.pdf');
    expect(attachmentRows(), '确认框还没确认，附件已经被删了').toHaveLength(1);
    expect(attachmentsOf(taskId)).toHaveLength(1);

    // 取消 ⇒ 什么都不发生。
    const cancel = document.querySelector<HTMLElement>('[data-testid="task-attachment-remove-confirm-cancel"]');
    await act(async () => {
      cancel?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await settle();
    });
    expect(document.querySelector('[data-testid="task-attachment-remove-confirm"]')).toBeNull();
    expect(attachmentRows()).toHaveLength(1);

    // 再来一次，这回确认。
    await act(async () => {
      document
        .querySelector<HTMLElement>(`[data-testid="attachment-remove-${attachmentId}"]`)
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await settle();
      document
        .querySelector<HTMLElement>('[data-testid="task-attachment-remove-confirm-submit"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await settle();
    });

    expect(attachmentRows(), '确认之后列表里还有它').toHaveLength(0);
    // 删除是**软删 + 字节回收**两条腿：实体留在表里带墓碑，字节那条 DELETE 打出去了。
    expect(attachmentsOf(taskId), '删除没写进 op-log（只是界面上不见了）').toHaveLength(0);
    expect(currentState().attachments[attachmentId]?.deletedAt).toBeTypeOf('number');
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });
});

/** 这条任务下那唯一一条附件的实体 id（用例里每格只加一个）。 */
function entityIdOf(taskId: string): string {
  const rows = attachmentsOf(taskId);
  if (rows.length !== 1) throw new Error(`期望恰好一条附件，实际 ${String(rows.length)} 条 ⇒ 判据在空转`);
  return rows[0]!.id;
}
