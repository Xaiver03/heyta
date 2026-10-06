/**
 * 账号资料（昵称 + 头像）的线协议契约 —— **唯一一份**。R10。
 *
 * ## 为什么常量住在这里，而不是 app-host 或 server
 *
 * `server` 只依赖 `@heyta/domain` / `@heyta/shared-schema` / `@heyta/sync-core`
 *（实测 `server/package.json`），而 `@heyta/app-host` 与 `apps/web` 都依赖本包。
 * 放 app-host ⇒ 服务端 import 不到；放 server ⇒ 客户端 import 不到。
 * 两边各写一份的结局已有先例：`HOSTED_PASSKEY_NAME_MAX_LENGTH = 60` 住在 app-host，
 * 而 `server/src` 里**一处都没有 import 它**（grep 零命中）—— 那个"两端共用一个常量"的
 * 纪律在 passkey 那条上其实**没有成立**，只是注释里写着。这一包不再犯第二次。
 *
 * 🔴 服务端是**唯一裁决者**：客户端的 `maxLength` 只是让人少打几个字，
 * 真正的拒绝必须发生在 `PUT /account/profile` 里。判据据此写，不据此**期望**。
 *
 * ## 为什么昵称明文、头像密文
 *
 * 见 `server/prisma/schema.prisma` 里 `UserAvatar` 那段（表 E 的结构性依据），
 * 以及 `docs/plans/ui-review-fill-zh-timeline.md` §8.6。这里只落一件事：
 * **头像的线上传的是密文字符串**，所以 `avatar` 那条 PUT 的 body 与 op 上传同形
 *（JSON + base64），服务端不需要 multipart、不需要新依赖。
 */

import { z } from 'zod';

/** 相对服务端根的路径。与 `AUTH_PASSWORD_PATHS` 同一形状（不带 `/api` 前缀的在这里）。 */
export const ACCOUNT_PROFILE_PATHS = {
  /** `PUT` 改昵称 / `GET` 读自己的资料。Bearer 归属。 */
  profile: 'account/profile',
  /**
   * `PUT` 上传密文头像 / `DELETE` 移除 / `GET` 取密文。Bearer 归属。
   *
   * 🔴 **没有**"按 userId 或 email 查别人资料"的形态 —— heyta 今天无协作，
   * 开公开可读是一次独立的产品决定（§8.6 那条边界），不在本次实现里顺手做。
   */
  avatar: 'account/avatar',
} as const;

/**
 * 昵称上限：**32 个码点**。
 *
 * 为什么是 32 而不是 passkey 名字那个 60：昵称要出现在**窄处**
 *（头像菜单的身份区、行内徽章、日历侧栏），60 个汉字能排满一整屏。
 * 32 是"够写一个中文全名 + 一个 emoji 后缀"的上限。
 *
 * ⚠️ **不照抄竞品**：滴答的昵称"无字符限制"、飞书的图片"大小无限制"。
 * 无上限与 §3.3 的持久化纪律和 §5 的排版纪律都冲突（超长名字会把行挤成多行）。
 * 这是我们**自己**的规格，写清楚比"业界都这样"重要。
 *
 * 🔴 单位是**码点**，不是 UTF-16 长度：`'邓'.length === 1` 而 `'👍'.length === 2`。
 * 用 `.length` 会让 emoji 昵称凭空少一半额度 —— 计数必须走下面的 helper，两端同一个。
 */
export const ACCOUNT_DISPLAY_NAME_MAX_CODE_POINTS = 32;

/**
 * 数**码点**的唯一实现。两端都必须用它，不许各自写 `[...s].length`。
 *
 * ⚠️ 这是一个**近似**：一个家庭 emoji「👨‍👩‍👧」是 3 个码点加 2 个 ZWJ，
 * 视觉上是一个字符却占 5 个额度。要精确就得引字素簇分词（新依赖，过不了 §3.1/§3.2）。
 * 我们选"近似 + 写清近似"，而不是"精确 + 多一个依赖"。
 * 今天多算只会让上限**略紧**（用户少打两个 emoji），不会让坏数据进库。
 */
export const displayNameCodePoints = (value: string): number => Array.from(value).length;

/** 昵称的**服务端**校验规则。trim 后非空、码点数不超上限。 */
export const accountDisplayNameSchema = z
  .string()
  .transform((v) => v.trim())
  .pipe(
    z
      .string()
      .min(1, 'displayName 不能是空白')
      .refine(
        (v) => displayNameCodePoints(v) <= ACCOUNT_DISPLAY_NAME_MAX_CODE_POINTS,
        `displayName 超过 ${ACCOUNT_DISPLAY_NAME_MAX_CODE_POINTS} 个码点`,
      ),
  );

/** `PUT account/profile` 的请求体。 */
export const accountProfileUpdateSchema = z.object({
  /**
   * 🔴 `null` 与 `''` 是**两件不同的事**，必须都能表达：
   * - `null` = "我要清除昵称"（回到邮箱派生的显示名）；
   * - `''`（或全空白）= 一次**无效输入**，服务端拒。
   *
   * 不分成两个值的后果不是报错，是**功能缺失**：把空串当"清除"，用户删掉所有
   * 字母直接点保存就成功了 —— 可他刚才是不是在"输入昵称"？没人知道。
   * 而只允许非空字符串（此前的形状），界面上那句"留空则显示邮箱"就兑不了现，
   * 用户清空昵称点保存会得到一次 `invalid-input`：一个按下去没反应的按钮，
   * 和一个承诺了自己不履行的文案。所以增删改查里的"删"必须是一个显式的值。
   */
  displayName: accountDisplayNameSchema.nullable(),
});

/**
 * 头像密文的上限：**2 MiB**（base64 字符串的字节数）。
 *
 * 推导链（不是随手取的数）：客户端把原图压到 ≤ `ACCOUNT_AVATAR_MAX_SOURCE_BYTES`
 * → 装进 `{contentType, dataBase64}` 的 JSON 时**又** base64 一次（×1.34）
 * → `encrypt()` 输出再 base64（×1.34）⇒ 80 KB 的原图约 144 KB 密文，
 * 512 KB 的原图约 920 KB 密文。2 MiB 是"最大原图 + 三倍余量"，
 * 留余量是因为 Argon2 密文头（salt 16 + IV 12）与 JSON 包裹也在里面。
 */
export const ACCOUNT_AVATAR_MAX_CIPHER_BASE64_BYTES = 2 * 1024 * 1024;

/**
 * 原图上限：**512 KB**，由**客户端**在压缩后执行。
 *
 * 🔴 服务端**看不到**这个数（它只看到密文，解不开 ⇒ 无从判断原图多大）。
 * 所以这一条是**客户端纪律**，不是契约的强制项 —— 服务端能强制的只有上一条。
 * 写在这里是为了让两端引用同一个数，而不是 UI 里写一个、文档里另一个。
 */
export const ACCOUNT_AVATAR_MAX_SOURCE_BYTES = 512 * 1024;

/**
 * 压缩后的边长：**512 px 方形**（短边居中裁切后缩放）。
 *
 * 与上面那条同为**客户端纪律**，因此也住在契约层而不是 UI 里：
 * 界面文件里写一个裸 `512`，下次有人改 UI 时不会知道它是"规格"还是"随手试的数"。
 * 为什么是 512：显示侧最大只到 `--ht-size-avatar-lg`（40 px）的 2× 视网膜密度 = 80 px，
 * 512 留了 6 倍余量给"将来头像出现在更大的位置"，同时把密文压在
 * `ACCOUNT_AVATAR_MAX_CIPHER_BASE64_BYTES` 推导链假设的那个量级里。
 */
export const ACCOUNT_AVATAR_EDGE_PX = 512;

/** 头像允许的格式。**客户端**编码前校验；服务端只看密文，不看格式。 */
export const ACCOUNT_AVATAR_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type AccountAvatarContentType = (typeof ACCOUNT_AVATAR_CONTENT_TYPES)[number];

/**
 * 头像的**加密载荷**形状：`{ contentType, dataBase64 }`。
 *
 * 🔴 为什么校验函数住在这里而不是 app-host：`@heyta/app-host` **没有** zod 依赖
 *（实测 `packages/app-host/package.json`），而它必须校验一段从远端拿回来、
 * 刚解密的 JSON。两个选项：给 app-host 加一个依赖，或者把校验搬到本包导出一个函数。
 * 选后者 —— 白名单与形状因此只有一份，加 `image/avif` 时不会出现"契约改了、
 * 客户端还拒收"的那种漂移。
 */
export const avatarPayloadSchema = z.object({
  contentType: z.enum(ACCOUNT_AVATAR_CONTENT_TYPES),
  dataBase64: z.string().min(1),
});

export type AvatarPayload = z.infer<typeof avatarPayloadSchema>;

/**
 * 把解密的文本变成 `AvatarPayload`，**任何一步不对都回 null**。
 *
 * ⚠️ 口令错的时候 `decrypt()` 不保证抛异常 —— 它可能"成功"并吐出一堆乱码
 *（GCM 校验失败会抛，但 legacy 分支与兜底路径不一定）。所以这里
 * **JSON.parse 也要包起来**：不包的话症状是界面抛 `Unexpected token`，
 * 而不是干净地显示"这台设备解不开头像"。
 */
export const parseAvatarPayload = (plaintext: string): AvatarPayload | null => {
  let raw: unknown;
  try {
    raw = JSON.parse(plaintext);
  } catch {
    return null;
  }
  const parsed = avatarPayloadSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

/**
 * base64 字符串**解码后**的字节数（不真的解码：尾部 `=` 是唯一需要小心的地方）。
 *
 * 为什么住在契约层而不是各壳里：它是 `ACCOUNT_AVATAR_MAX_SOURCE_BYTES`
 * 那条上限的**量法**。上限本身写在这里，量法写在 web 的 `avatar-encode.ts` 里，
 * 结局就是"同一个产品规格两端各判一遍" —— 而 AGENTS §3.5 说得很直接：
 * 两份实现 = 两套裁决标准。移动端要接头像时，它必须引用这一个。
 */
export const base64DecodedBytes = (base64: string): number => {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
};

/** 拒绝原因。🔴 **每种对应界面上一句不同的话**，所以不许合并成一句"头像不行"。 */
export type AvatarRejectReason =
  /** 不在 `ACCOUNT_AVATAR_CONTENT_TYPES` 白名单里（服务端看不到明文 ⇒ 只有客户端能拦）。 */
  | 'bad-type'
  /** 编码结果为空串：平台那条路"成功了但什么都没产出"。 */
  | 'empty'
  /** 压缩**之后**仍然超过 `ACCOUNT_AVATAR_MAX_SOURCE_BYTES`。 */
  | 'too-big';

/**
 * 格式白名单的**唯一**判法。
 *
 * 单独导出是为了让壳能在**动手编码之前**就问一句（浏览器解一张 20 MB 的奇怪
 * 文件是要花时间的，而"格式不支持"这句话不该等到画布跑完才说）。
 * `planAvatarUpload` 内部用的也是它 —— 两处两个判法就是那条门禁要防的漂移。
 */
export const isAvatarContentType = (contentType: string): contentType is AccountAvatarContentType =>
  (ACCOUNT_AVATAR_CONTENT_TYPES as readonly string[]).includes(contentType);

/**
 * 编码**输出**用哪一种格式。
 *
 * 规则：源图是 PNG 就继续输出 PNG（转 JPEG 会把透明铺成黑底），其余（含 webp）
 * 统一转 JPEG。判的是**有没有透明通道**，而 PNG 是白名单里唯一保证带 alpha 的那一种。
 *
 * 为什么单独成一个函数：两个壳都要在同一处决定这件事（web 的 canvas、Android 的
 * `Bitmap.compress`）。写成 `file.type === 'image/png' ? … : …` 的第三遍时，
 * 结局是"同一张 webp 在网页上变 JPEG、在手机上还是 webp"，
 * 而 `planAvatarUpload` 收不收它是按**输出**的 contentType 判的。
 */
export const avatarOutputContentType = (sourceType: string): AccountAvatarContentType =>
  sourceType === 'image/png' ? 'image/png' : 'image/jpeg';

export type AvatarUploadPlan =
  | { readonly action: 'accept'; readonly payload: AvatarPayload }
  | { readonly action: 'reject'; readonly reason: AvatarRejectReason };

/**
 * 「这张压好的图能不能当头像」的**唯一**裁决（客户端纪律那一半）。
 *
 * 只管**已编码**的载荷：怎么把一张原图变成方形 base64 是平台调用
 *（浏览器 `<canvas>` / Android `Bitmap` / iOS `ImageEditor`），住在各自的壳里；
 * 边长与字节上限是产品规格，住在本文件。这条分界与
 * `apps/web/src/features/settings/avatar-encode.ts` 文件头写的是同一条。
 *
 * ⚠️ 判的是**压缩后**的字节 —— 原图多大不是我们能选的（一张 4 MB 的手机截图
 * 压完可能 60 KB），拿原图大小去拒会把绝大多数相册照片挡在门外。
 */
export const planAvatarUpload = (input: {
  readonly contentType: string;
  readonly dataBase64: string;
}): AvatarUploadPlan => {
  if (!isAvatarContentType(input.contentType)) {
    return { action: 'reject', reason: 'bad-type' };
  }
  if (input.dataBase64 === '') {
    return { action: 'reject', reason: 'empty' };
  }
  if (base64DecodedBytes(input.dataBase64) > ACCOUNT_AVATAR_MAX_SOURCE_BYTES) {
    return { action: 'reject', reason: 'too-big' };
  }
  return {
    action: 'accept',
    payload: { contentType: input.contentType as AccountAvatarContentType, dataBase64: input.dataBase64 },
  };
};

/**
 * 没有头像时那个圈里显示的**首字母**（取 `@` 之前第一段的第一个字符，转大写）。
 *
 * 🔴 为什么要抽进共享层：这条规则此前有**两份** ——
 * `AccountMenu.tsx` 返回 `undefined`（于是那里渲染**空圈**），
 * 而 `ProfilePanel.tsx` 返回 `''`（渲染一个空 `<span>`）。
 * 两处的注释都写着"拿不到邮箱时不许编一个字母"，但实现各写了一遍。
 * 症状不会是报错，而是"同一个账号在侧栏里是空圈、在设置页里是别的形状"，
 * 以及移动端接第三份时又要重新决定一次"到底返回什么"。
 *
 * ⚠️ 返回 `string | undefined` 而不是 `''`：**空串与没有是两件事**。
 * `''` 会让调用方写成 `{initial}`（渲染一个空文本节点），
 * 而真正该问的是"这里到底有没有字母可显示"。用 `undefined` 才能把
 * "没邮箱"与"邮箱本地部分为空"都收敛成一个调用方必须显式分支的状态。
 */
export const avatarInitialFromEmail = (email: string | undefined): string | undefined => {
  if (email === undefined) return undefined;
  const first = Array.from((email.split('@')[0] ?? '').trim())[0];
  return first === undefined ? undefined : first.toUpperCase();
};

/**
 * 把头像 payload 拼成 `<img src>` / RN `<Image source={{uri}}>` 直接能吃的 data URI。
 *
 * 🔴 抽出来的理由不是"少写一行模板字符串"，是**格式串里有两个必须一致的部分**：
 * `contentType` 与 `base64`。各端各拼一遍时，拼错哪一半都不会报错 ——
 * 浏览器只会把图渲染成坏图（RN 更糟：什么都不画）。
 * web 此前在同一文件里拼了两次（读回来一次、上传成功后一次），
 * 而"上传后立刻显示的那张图"与"刷新后显示的那张图"必须是同一个字节形状。
 */
export const avatarDataUri = (image: AvatarPayload): string =>
  `data:${image.contentType};base64,${image.dataBase64}`;

/**
 * `GET account/profile` 的响应，也是登录响应里 `user` 带的那两个字段。
 *
 * ⚠️ 只有 `avatarHash`，**没有**头像字节 —— 取图是另一条 `GET account/avatar`。
 * 这条区分是承重的：登录与鉴权路径每次都跑，把密文塞进登录响应就等于
 * 把 144 KB 挂到最热的那条读路径上（`schema.prisma` 里 `UserAvatar` 那段讲的是同一件事）。
 */
export const accountProfileResponseSchema = z.object({
  displayName: z.string().nullable(),
  /** 密文的 SHA-256（hex）。`null` = 没有头像。同时充当缓存键。 */
  avatarHash: z.string().nullable(),
});

export type AccountProfileUpdate = z.infer<typeof accountProfileUpdateSchema>;
export type AccountProfileResponse = z.infer<typeof accountProfileResponseSchema>;

/** `PUT account/avatar` 的请求体：base64 密文（`encrypt()` 的原样输出）。 */
export const accountAvatarUpdateSchema = z.object({
  cipherBase64: z
    .string()
    .min(1)
    .refine(
      (v) => v.length <= ACCOUNT_AVATAR_MAX_CIPHER_BASE64_BYTES,
      `头像密文超过 ${ACCOUNT_AVATAR_MAX_CIPHER_BASE64_BYTES} 字节上限`,
    ),
});

export type AccountAvatarUpdate = z.infer<typeof accountAvatarUpdateSchema>;
