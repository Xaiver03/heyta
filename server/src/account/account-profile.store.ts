/**
 * 账号资料（R10）的**读取层**。只依赖 `db`，不碰中间件。
 *
 * 🔴 为什么不放在 `account-profile.routes.ts` 里给 `auth.ts` import：
 * 路由文件 import 了 `../middleware`，而 `middleware` 又回头 import `auth.ts` 的
 * 令牌校验 —— 让 `auth.ts` 去 import 路由文件会**成环**，
 * ESM 的环表现为"某个导出在初始化前被读到"，症状是偶发的 `undefined is not a function`。
 * ⇒ 读取层单独一个文件，两端各自 import 它，谁都不 import 谁。
 */
import { prisma } from '../db';

/**
 * 资料的读取形状。**登录响应也用它**（`auth.ts` 里那三处），
 * 所以 `select` 只有一个实现 —— 三处各写一遍的话，
 * 迟早有一处会把 `cipher` 一起拖进登录路径。
 */
export const readAccountProfile = async (userId: number): Promise<{
  displayName: string | null;
  avatarHash: string | null;
}> => {
  // 🔴 `select` 里**只有** `hash`，没有 `cipher`：头像密文是 100 KB 量级，
  // 而这段读的是登录与鉴权路径 —— 每次建立会话都要跑。要图是另一条 GET。
  // 判据：`server/tests` 里那条"登录响应的字节数必须很小"就是钉这一行的。
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { displayName: true, avatar: { select: { hash: true } } },
  });
  return {
    displayName: user?.displayName ?? null,
    avatarHash: user?.avatar?.hash ?? null,
  };
};

/**
 * 把资料两个字段并进登录响应的 `user` 里。
 *
 * 🔴 三条认证路（魔法链接 / 邮箱链接确认 / 口令登录）**都必须**过这一个函数。
 * 加 R10 之前实测到的现状是：`user: { id, email, locale }` 这个形状在
 * `auth.ts:492`、`auth.ts:552`、`api.ts:931` **各写了一遍**，
 * 而 `api.ts:1545` 的注释还写着"客户端不需要为这条路演第二套接线"——
 * 意图是统一，实现是三份抄件。再往这三处各加两个字段，就是三份**新**的漂移源。
 * ⇒ 现在资料这一族只有一个住处。
 *
 * ⚠️ `replaceToken`（`auth.ts:242`）的 `{ id, email }` **不在**这一族里 ——
 * 它是"会话已刷新"的响应，不是登录，别顺手统一它。
 */
export const withAccountProfile = async (
  user: { id: number; email: string; locale: string | null },
  extra?: Record<string, unknown>,
): Promise<AccountSessionUser> => {
  const profile = await readAccountProfile(user.id);
  // 🔴 **显式列举**输出，不写 `{ ...user }`。
  // 调用方传进来的 `user` 常常是一条查询的**整行**结果 ——
  // `auth.ts` 魔法链接那条就是（它取的是全列）。用 spread 就等于
  // 把 `passwordHash` / `tokenVersion` / 各种一次性令牌一起塞进登录响应，
  // 而且**不会有任何一层报错**：TypeScript 允许对象字面量之外的多余属性，
  // 而返回类型上少写一个字段也不影响运行时。
  // 与运营后台那条"响应里 `passwordHash` 一个都不许出现"是同一类判据（ADR-0038 的白名单投影）。
  // ⚠️ `extra` 是给"这条响应还要带别的**已审过**字段"留的口子，
  // 传什么由调用方负责 —— 默认仍然是白名单，不是整行。
  return {
    id: user.id,
    email: user.email,
    locale: user.locale,
    displayName: profile.displayName,
    avatarHash: profile.avatarHash,
    ...(extra ?? {}),
  };
};

export type AccountSessionUser = {
  id: number;
  email: string;
  locale: string | null;
  displayName: string | null;
  avatarHash: string | null;
};
