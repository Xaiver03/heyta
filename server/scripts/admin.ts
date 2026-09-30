/**
 * 管理员的授予 / 撤销 / 列表（CLI）。
 * =====================================
 *
 * ```sh
 * pnpm --filter @heyta/server admin:grant  someone@example.com
 * pnpm --filter @heyta/server admin:revoke someone@example.com
 * pnpm --filter @heyta/server admin:list
 * ```
 *
 * 逻辑在 `src/admin/admins.ts`（那里有**不能撤销最后一个管理员**这条不变量，
 * 以及它为什么必须可测）。这个文件只是**参数解析 + 打印 + 退出码**。
 *
 * ## 退出码是判据的一部分
 *
 * 部署脚本与人都会看退出码。所以"用户不存在""这是最后一个管理员"必须
 * **非零退出** —— 一个打印了警告却 exit 0 的脚本会让人以为授权成功了。
 */

import { disconnectDb } from '../src/db';
import { Logger } from '../src/logger';
import {
  grantAdmin,
  listAdmins,
  revokeAdmin,
  type AdminSummary,
} from '../src/admin/admins';

const USAGE = `用法：
  admin:grant  <email>   授予管理员
  admin:revoke <email>   撤销管理员（拒绝撤销最后一个）
  admin:list             列出全部管理员`;

function printAdmin(admin: AdminSummary): void {
  const created = admin.createdAt === null ? '未知' : new Date(admin.createdAt).toISOString();
  console.log(
    `  #${String(admin.id)}  ${admin.email}  已验证=${admin.isVerified ? '是' : '否'}  注册于 ${created}`,
  );
}

async function main(): Promise<number> {
  const [command, email] = process.argv.slice(2);

  if (command === 'list') {
    const admins = await listAdmins();
    if (admins.length === 0) {
      console.log('当前没有任何管理员 —— 后台对所有人关闭。');
      console.log('用 `admin:grant <email>` 授权第一个（那个人必须已经注册过）。');
      return 0;
    }
    console.log(`共 ${String(admins.length)} 位管理员：`);
    for (const admin of admins) printAdmin(admin);
    return 0;
  }

  if (command !== 'grant' && command !== 'revoke') {
    console.error(USAGE);
    return command === undefined ? 0 : 1;
  }

  if (email === undefined || email.trim() === '') {
    console.error(`缺少 <email>。\n\n${USAGE}`);
    // 参数写错**必须**非零：否则 `admin:grant` 空跑会被当成成功。
    return 1;
  }

  if (command === 'grant') {
    const result = await grantAdmin(email);
    if (!result.ok) {
      // "用户不存在"是预期结果，但**对调用方是失败**：人以为授权了，其实没有。
      console.error(
        `找不到邮箱为 ${email} 的用户。管理员必须是**已注册**的账号 —— 让本人先注册，再跑这条命令。`,
      );
      return 1;
    }
    console.log(`✅ 已授予管理员：${result.admin.email}`);
    return 0;
  }

  const result = await revokeAdmin(email);
  if (result.ok) {
    console.log(`✅ 已撤销管理员：${result.admin.email}`);
    return 0;
  }

  switch (result.reason) {
    case 'user-not-found':
      console.error(`找不到邮箱为 ${email} 的用户。`);
      return 1;
    case 'not-an-admin':
      console.error(`${email} 本来就不是管理员 —— 没有改动。`);
      return 1;
    case 'last-admin':
      console.error(
        `拒绝执行：${email} 是**最后一个**管理员，撤销它会让后台对所有人关闭，\n` +
          '而恢复需要直连数据库改一行。请先授权另一个管理员，再撤销这一个。',
      );
      return 1;
  }
}

main()
  .then(async (code) => {
    await disconnectDb();
    process.exit(code);
  })
  .catch(async (error: unknown) => {
    Logger.error('admin 命令失败：', error);
    await disconnectDb();
    process.exit(1);
  });
