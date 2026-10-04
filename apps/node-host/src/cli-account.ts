/**
 * `account` 子命令 —— 注销账号（批次 E3 的 CLI 面）
 * ==================================================
 *
 * 存在的理由：**这条路径以前不存在**。服务端那个 `DELETE /api/account`
 * 写出来很久了，而三个宿主里没有任何一个调用过它；"注销"在产品的承诺里
 * 是一个动作，在代码里却只是"等哪次同步撞上 ACCOUNT_CLOSED"。E2 修好的
 * 那条本机销毁反应因此也没有主动触发点。
 *
 * 为什么要单独成文件（而不是写在 `cli.ts` 的 `case` 里）：
 * 判据必须能**注入网络**并跑**真 SQLite 文件**。`auth` 那条也是同样的理由
 * 被拆成 `cli-auth.ts` 的 —— 命令的解析与打印留在 `cli.ts`，需要依赖注入的
 * 那一段单独导出。抄它的形状，不另发明一套。
 *
 * 🔴 三层闸门，顺序不能换（每一层挡的是不同的事故）：
 *   1. **默认是预览**：不发请求、不碰磁盘，只报数并退 1。
 *      挡的是"手滑敲了命令"。
 *   2. `--confirm` 但本机还有**未上传的 op** ⇒ 照样拒绝，且**没有逃生门**。
 *      挡的是"用户以为自己注销的是云端那份，实际上把只存在于这台设备上的
 *      数据一起清了"。第二层确认的全部价值就在这条上 —— 只重复第一句话的
 *      勾选框，用户在真有未上传数据时会照原样敲第二次。
 *      唯一出口是先把它们送上去（`sync`）或先导出一份（`export`）。
 *   3. 服务端**没确认删除 ⇒ 本机一个字节都不动**（顺序在
 *      `@heyta/app-host` 的 `closeAccountAndEraseLocal` 里，`account-closure.spec.ts`
 *      钉着；这里只负责在它之后如实转述四种结局）。
 *
 * ⚠️ 句子不说"彻底销毁"：这次动作清的是**这个账号在服务端的那份**和
 * **这台设备上的明文库**。别的设备上的副本、以及运维备份不在作用域里
 * （ADR-0048 与批次 E 的诚实条款）。终端上把话说满，等于让用户以为别处也干净了。
 */

import {
  closeAccountAndEraseLocal,
  type ClosureResult,
  type ExportDocument,
} from '@heyta/app-host';
import { reasonText, type AuthCommandResult } from './cli-auth.js';

export interface AccountCommandDeps {
  /** 网络实现，默认 `globalThis.fetch`。测试一律注入，绝不真发请求。 */
  fetchImpl?: typeof fetch;
}

/**
 * 这条命令能对本机做的读与那一次不可逆的写。
 *
 * ⚠️ `pendingUploadCount` / `exportDocument` 都是**本地读**（不发请求、不改状态）。
 * 真正的销毁只走 `closeAccountAndEraseLocal`，而它自己保证"服务端先删成"。
 */
export interface AccountCommandTarget {
  readonly serverUrl: string;
  readonly token: string;
  pendingUploadCount(): Promise<number>;
  exportDocument(): Promise<ExportDocument>;
}

export interface AccountCommandArgs {
  /** 只认识 `close`。其它子命令一律报错而不是忽略。 */
  action: string | undefined;
  confirm: boolean;
  json: boolean;
}

/**
 * 预览/拒绝那一档的收尾句。
 *
 * 🔴 措辞是"没有发出删除请求，也没有清除任何本机数据"，**不是**"没有改动任何文件"。
 * 后者在这一条路径上是假的：命令要读"本机有多少条记录"，就得先打开那个 SQLite 文件，
 * 而文件不存在时打开会**创建**它（还会写 clientId）。要说"什么都没动"，
 * 就得把预览做成不打开库的版本 —— 那时它报不出数，也就没用了。
 * 句子只承诺得住得了的那部分。
 */
const NOT_EXECUTED = '这次运行没有发出删除请求，也没有清除任何本机数据。';


/** 本机现状的四个数。`export` 报的是同一组数，所以"先导出"那句才是可核对的。 */
interface Preview {
  records: number;
  deletedRecords: number;
  ops: number;
  pendingUploads: number;
}

export async function runAccountCommand(
  args: AccountCommandArgs,
  target: AccountCommandTarget,
  deps: AccountCommandDeps = {},
): Promise<AuthCommandResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];

  if (args.action !== 'close') {
    stderr.push(
      `account 只认识子命令 close，收到「${args.action ?? ''}」（空着也算没给）。\n` +
        '这一步不可逆：没有子命令时不许把它猜成"注销"。',
    );
    return { code: 1, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
  }

  const pendingUploads = await target.pendingUploadCount();
  const doc = await target.exportDocument();
  const preview: Preview = {
    records: doc.counts.totalEntities,
    deletedRecords: doc.counts.totalDeleted,
    ops: doc.counts.totalOps,
    pendingUploads,
  };

  if (!args.confirm) {
    if (args.json) {
      stdout.push(
        JSON.stringify({
          ok: false,
          command: 'account',
          action: 'close',
          preview: true,
          reason: 'needs-confirm',
          ...preview,
        }),
      );
    } else {
      stderr.push(
        `这一步不可逆。本机现在有 ${preview.records} 条记录（另 ${preview.deletedRecords} 条已删除）` +
          `和 ${preview.ops} 条操作日志，其中 ${pendingUploads} 条**还没上传**。\n` +
          (pendingUploads > 0
            ? '🔴 未上传的那些只在这台设备上：注销会把它们连同本机明文存储一起清掉，云端没有它们。\n'
            : '') +
        '先留一份（这是唯一能把数据带走、再导回别的账号或别的设备的通道）：\n' +
        '  … export --out ./heyta-backup.json\n' +
        `确认无误后重跑并加 --confirm。${NOT_EXECUTED}`,
      );
    }
    return { code: 1, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
  }

  if (pendingUploads > 0) {
    if (args.json) {
      stdout.push(
        JSON.stringify({
          ok: false,
          command: 'account',
          action: 'close',
          reason: 'pending-uploads',
          pendingUploads,
        }),
      );
    } else {
      stderr.push(
        `❌ 拒绝注销：本机还有 ${pendingUploads} 条操作没有上传。\n` +
          '先跑 … sync 把它们送出去（跑完用 pending 确认是 0），\n' +
          '或者先 … export --out ./heyta-backup.json 留一份。\n' +
          `带了 --confirm 也照样拒绝 —— 这一层没有逃生门。${NOT_EXECUTED}`,
      );
    }
    return { code: 1, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
  }

  const result = await closeAccountAndEraseLocal(
    {
      baseUrl: target.serverUrl,
      ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
    },
    target.token,
  );

  const reports = (result.reports ?? []).map((report) => ({
    target: report.target,
    containerRemoved: report.containerRemoved,
    reason: report.reason ?? null,
  }));

  if (args.json) {
    stdout.push(
      JSON.stringify({
        ok: result.disposition === 'closed-and-erased',
        command: 'account',
        action: 'close',
        disposition: result.disposition,
        failure: result.failure ?? null,
        erasureError: result.erasureError ?? null,
        reports,
      }),
    );
  } else {
    stdout.push(describeClosureText(result));
    for (const report of reports) {
      stdout.push(
        `  · ${report.target}：${report.containerRemoved ? '容器已删除' : '容器仍在'}` +
          `${report.reason === null ? '' : `（${report.reason}）`}`,
      );
    }
  }

  return {
    code: result.disposition === 'closed-and-erased' ? 0 : 1,
    stdout: stdout.join('\n'),
    stderr: stderr.join('\n'),
  };
}

/**
 * 四种结局 → 四种句子。词表在 `@heyta/app-host`，这里只做终端转述。
 *
 * 🔴 `closed-erase-failed` 那一档单独成句，不许并进"已注销"：服务端确实删掉了，
 * 用户的主张成立，而**这台设备上的明文还在**。把它说得像成功，
 * 就是让用户带着一个还能读出明文的库继续用这台机器。
 */
function describeClosureText(result: ClosureResult): string {
  switch (result.disposition) {
    case 'closed-and-erased':
      return '账号已注销：服务端那份已删除，本机明文库已销毁（别的设备上的副本与备份不在这次动作里）';
    case 'closed-erase-partial': {
      const kept = (result.reports ?? []).filter((report) => !report.containerRemoved);
      return (
        `账号已注销，但本机有 ${kept.length} 处没能删干净：` +
        kept.map((report) => `${report.target} —— ${report.reason ?? '未给出原因'}`).join('；') +
        '（表已 DROP、内容已 VACUUM，文件容器还在 —— 这台设备上还留着这个文件）'
      );
    }
    case 'closed-erase-failed':
      return `账号已注销，但本机数据没有销毁：${result.erasureError ?? '未给出原因'}`;
    case 'not-closed':
      return `没有注销：${closureFailureText(result.failure)} —— 服务端没删成，本机一个字节都没动`;
  }
}

/** 服务端那一侧的原因：句子抄自 `cli-auth.ts` 那张编译期穷尽的表，不另抄一份。 */
function closureFailureText(reason: ClosureResult['failure']): string {
  return reason === undefined ? '未给出原因' : reasonText(reason);
}
