/**
 * 下载面：一行 = 一端，能不能给按钮**只由清单决定**
 * ==================================================
 *
 * 🔴 **这一文件里没有任何一条 URL，也没有任何"已发布/未发布"的布尔值。**
 * 这不是洁癖，是这一页唯一可能说谎的那一处：
 *
 *   - 直链住在 `release-manifest.json`（发布脚本从分发桶的 `latest.json` 逐字抄回来的那份快照）；
 *   - "这一端现在能拿到什么"住在下面这张表（顺序、架构、说法、拿不到时的原因）。
 *
 * 两边各写一遍"能不能下"，就会出现**页面上有个按钮而点了是 404** —— 而它不会自己变红，
 * 只会红在访客身上。所以 `resolveRows()` 是纯函数：输入清单、输出每一行的状态，
 * 表里没有的端出不了按钮，清单里没有的端也一样。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 与 `/platforms` 的分界（这一条是本页存在与否的关键）
 *
 * `docs/research/site-ia-and-landing-audit.md` §3.2 第 3 行当年把"下载页"改成了
 * "平台状态页"，理由是那一轮**没有可发布的包**，而那两条判据（§4：不列不存在的安装包、
 * `platforms-install-claim.spec.ts`：没有载体的承诺不许上公页）现在仍然成立。
 * 本页不推翻它，只是把两件本来被挤在一起的事分开：
 *
 *   · `/download` 回答「**我现在这台机器怎么拿到它**」—— 只有行动，且只给真的点得动的行动；
 *   · `/platforms` 回答「**各端到哪一步了**」—— 只有进度，且**不出现下载链接**。
 *
 * 状态徽标因此**不在这里定义**：`sectionId` 指回 `/platforms` 那张表，
 * 档位与图例只有一份。下载面比状态面**更**保守是合法的（有包但没发布），
 * 反过来不行 —— 判据见 `scripts/check-downloads.mjs` 的臂 C 与测试里那条"不许比状态乐观"。
 */

import type { MessageKey } from '@heyta/i18n/provider';

import manifestJson from './release-manifest.json';

/** 分发桶清单里一个文件的样子 —— 字段与 `scripts/upload-dist.sh` 写出的 `latest.json` 逐字相同。 */
export interface ReleaseFile {
  readonly name: string;
  /**
   * 这一枚字节自己的版本号。
   *
   * 🔴 它挂在文件上而不是批次上，是因为五端**不会落在同一轮**（iOS 走 TestFlight、
   * 某一端晚一天验装）。合并后的清单里只有一个批次号的话，"这一端是不是正式发布通道"
   * 就没有答案了 —— 而那个答案决定页面上有没有一个能点的按钮。
   * 旧快照没有这个字段时回落到批次号（`upload-dist.sh` 从这一轮起会写它）。
   */
  readonly version?: string;
  readonly url: string;
  readonly versionedUrl: string;
  readonly sha256: string;
  readonly size: number;
}

/**
 * 商店/内测通道的入口（TestFlight、App Store、Google Play）。
 *
 * 🔴 它住在清单里而不是页面里，和文件同一个理由：**页面上不许出现第二条来源的 URL**。
 * 但它不是 `upload-dist.sh` 从桶里抄来的（那条链接是 App Store Connect 给的），
 * 所以它是 `release-manifest.json` 里唯一一处**手写**字段 —— 代价是必须有条闸门看着它：
 * `scripts/check-downloads.mjs` 的臂 D 要求每一枚 channels 的 host 落在官方域名白名单里，
 * 且 key 必须是注册表里 `via: 'store'` 的那一行。少一道这个，手写 URL 就会开始漂。
 */
export interface StoreChannel {
  readonly url: string;
  readonly name: string;
  readonly addedAt: string;
}

export interface ReleaseManifest {
  readonly version: string;
  readonly releasedAt: string;
  readonly files: Readonly<Record<string, ReleaseFile>>;
  readonly channels?: Readonly<Record<string, StoreChannel>>;
}

/**
 * 哪些端**可能**出现在清单里（= `upload-dist.sh` 认的产物类型）。
 * iOS 不在内：iOS 走 TestFlight，公页上不该有 ipa 直链。
 */
export type ManifestKey = 'macos' | 'windows' | 'linux' | 'android';

/** 这一行拿东西的方式。 */
export type DownloadVia =
  /** 不装任何东西：打开就用（网页版）。 */
  | 'open'
  /** 自己架一套：落点在首页那一节，不另建第二份说明。 */
  | 'guide'
  /** 装一个文件：只有清单里真有这一项时才给按钮。 */
  | 'file'
  /** 走商店/内测通道：只有清单 `channels` 里有这一行时才给入口。 */
  | 'store'
  /** 结构上就没有出口（还跑不起来）：永远只给原因。 */
  | 'none';

export interface DownloadRow {
  readonly id: string;
  /** 归属 `/platforms` 的哪一张卡 —— 状态徽标只有那一处定义。 */
  readonly sectionId: 'web' | 'android' | 'ios' | 'desktop' | 'harmony' | 'selfhost';
  readonly labelKey: MessageKey;
  readonly bodyKey: MessageKey;
  /** 这一行的包是给哪种机器/架构的。`via !== 'file'` 的行不写。 */
  readonly archKey?: MessageKey;
  /** 拿不到时的原因（每端各自一条，不许共用一句"敬请期待"）。 */
  readonly gapKey: MessageKey;
  /** 拿到了**还要**提醒的一件事（例如 macOS 只有 Apple Silicon）。 */
  readonly caveatKey?: MessageKey;
  readonly via: DownloadVia;
  readonly manifestKey?: ManifestKey;
}

/**
 * 展示顺序 = 这张表的顺序（不做第二份排序）。
 *
 * 网页版排在最前不是凑数：heyta 现在是开发阶段，**唯一一个所有机器都立刻可用的载体**
 * 就是它。把"下载"排在一个打不开的按钮后面，才是这一页最不该犯的错。
 */
export const DOWNLOAD_ROWS: readonly DownloadRow[] = [
  {
    id: 'web',
    sectionId: 'web',
    labelKey: 'site.download.row.web.name',
    bodyKey: 'site.download.row.web.body',
    gapKey: 'site.download.row.web.body',
    via: 'open',
  },
  {
    id: 'macos',
    sectionId: 'desktop',
    labelKey: 'site.download.row.macos.name',
    bodyKey: 'site.download.row.macos.body',
    archKey: 'site.download.row.macos.arch',
    caveatKey: 'site.download.row.macos.caveat',
    gapKey: 'site.download.row.macos.gap',
    via: 'file',
    manifestKey: 'macos',
  },
  {
    id: 'ios',
    sectionId: 'ios',
    labelKey: 'site.download.row.ios.name',
    bodyKey: 'site.download.row.ios.body',
    gapKey: 'site.download.row.ios.gap',
    via: 'store',
  },
  {
    id: 'android',
    sectionId: 'android',
    labelKey: 'site.download.row.android.name',
    bodyKey: 'site.download.row.android.body',
    archKey: 'site.download.row.android.arch',
    caveatKey: 'site.download.row.android.caveat',
    gapKey: 'site.download.row.android.gap',
    via: 'file',
    manifestKey: 'android',
  },
  {
    id: 'windows',
    sectionId: 'desktop',
    labelKey: 'site.download.row.windows.name',
    bodyKey: 'site.download.row.windows.body',
    archKey: 'site.download.row.windows.arch',
    caveatKey: 'site.download.row.windows.caveat',
    gapKey: 'site.download.row.windows.gap',
    via: 'file',
    manifestKey: 'windows',
  },
  {
    id: 'linux',
    sectionId: 'desktop',
    labelKey: 'site.download.row.linux.name',
    bodyKey: 'site.download.row.linux.body',
    archKey: 'site.download.row.linux.arch',
    caveatKey: 'site.download.row.linux.caveat',
    gapKey: 'site.download.row.linux.gap',
    via: 'file',
    manifestKey: 'linux',
  },
  {
    id: 'harmony',
    sectionId: 'harmony',
    labelKey: 'site.download.row.harmony.name',
    bodyKey: 'site.download.row.harmony.body',
    gapKey: 'site.download.row.harmony.gap',
    via: 'none',
  },
  {
    id: 'selfhost',
    sectionId: 'selfhost',
    labelKey: 'site.download.row.selfhost.name',
    bodyKey: 'site.download.row.selfhost.body',
    gapKey: 'site.download.row.selfhost.body',
    via: 'guide',
  },
];

/**
 * 清单里出现的、**这张表没登记**的端 ⇒ 响亮报错。
 *
 * 这条判据存在的理由：发布脚本可以先传一个还没上页面的产物（比如哪天加了 `macos-arm64e`）。
 * 静默忽略的形态是"文件在桶里躺着、页面上一个字都没有"，那正好是访客最不可能发现的缺口。
 */
export function unknownManifestKeys(manifest: ReleaseManifest): readonly string[] {
  const known = new Set<string>(
    DOWNLOAD_ROWS.flatMap((row) => (row.manifestKey === undefined ? [] : [row.manifestKey])),
  );
  return Object.keys(manifest.files).filter((key) => !known.has(key));
}

/** 同上，管的是 `channels`：登记为商店行的那一端才许有入口。 */
export function unknownChannelKeys(manifest: ReleaseManifest): readonly string[] {
  const known = new Set(
    DOWNLOAD_ROWS.flatMap((row) => (row.via === 'store' ? [row.id] : [])),
  );
  return Object.keys(manifest.channels ?? {}).filter((key) => !known.has(key));
}

/**
 * `channels` 里唯一可接受的 host。
 *
 * 🔴 这一枚白名单是 `channels` 能**手写**的代价。没有它，"清单里写一条链接"与
 * "组件里手写一条链接"就没有区别了，而后者正是这一页最不该变成的东西。
 * 加一枚域名要走一次评审：它等于宣布"公页可以为那个域名背书"。
 */
export const OFFICIAL_STORE_HOSTS: readonly string[] = [
  'testflight.apple.com',
  'apps.apple.com',
  'play.google.com',
];

export function illegalChannelUrls(manifest: ReleaseManifest): readonly string[] {
  const bad: string[] = [];
  for (const [key, channel] of Object.entries(manifest.channels ?? {})) {
    let host = '';
    try {
      const url = new URL(channel.url);
      host = url.host;
      if (url.protocol !== 'https:') bad.push(`${key}: 不是 https`);
    } catch {
      bad.push(`${key}: url 读不出地址`);
      continue;
    }
    if (!OFFICIAL_STORE_HOSTS.includes(host)) bad.push(`${key}: ${host} 不在官方域名白名单`);
  }
  return bad;
}

/**
 * 一行的最终状态。**只有 `file-ready` 与 `open`/`guide` 允许出现可点的出口**，
 * 而 `file-ready` 只有一个来源（清单里真的有这一项，且是正式通道）。
 *
 * ⚠️ `pending` 与 `none` 在界面上都读起来像"现在还拿不到"，区别是**谁挡着**：
 * `pending` = 产物已经能构建出来，只差发布这一步（每端 `gapKey` 写清差的是什么）；
 * `none` = 结构上就不给直链（TestFlight、或应用还跑不起来）。
 */
export type ResolvedRow =
  | { readonly row: DownloadRow; readonly state: 'file-ready'; readonly file: ReleaseFile }
  | { readonly row: DownloadRow; readonly state: 'store'; readonly channel: StoreChannel }
  | { readonly row: DownloadRow; readonly state: 'open' }
  | { readonly row: DownloadRow; readonly state: 'guide' }
  | { readonly row: DownloadRow; readonly state: 'pending' }
  | { readonly row: DownloadRow; readonly state: 'none' };

/**
 * 正式发布通道的版本号形状：**只允许 `主.次.修订`**。
 *
 * 🔴 这一条不是装饰。分发桶从 2026-09-30 起一直挂着一批 `0.0.0-dev` 的试传产物
 * （`docs/runbooks/app-distribution.md` §4），而那个 macOS 的 zip 是**那次试传**的字节 ——
 * 里面没有共享 UI 产物，装上也起不来（AGENTS §7 第 82 条那一族）。
 * 如果"清单里有就算能下"，这一页今天就会对访客给出一个坏包。
 * 所以版本号带预发布后缀（`-dev` / `-alpha` / `-rc.1` …）时，**整批清单都不算对外发布**，
 * 每一行退回 `pending`。
 */
const STABLE_VERSION = /^\d+\.\d+\.\d+$/;

export function isStableChannel(version: string): boolean {
  return STABLE_VERSION.test(version);
}

export function resolveRows(manifest: ReleaseManifest): readonly ResolvedRow[] {
  return DOWNLOAD_ROWS.map((row) => {
    if (row.via === 'none') return { row, state: 'none' as const };
    if (row.via === 'open') return { row, state: 'open' as const };
    if (row.via === 'guide') return { row, state: 'guide' as const };
    if (row.via === 'store') {
      const channel = manifest.channels?.[row.id];
      return channel === undefined
        ? { row, state: 'none' as const }
        : { row, state: 'store' as const, channel };
    }
    const file = row.manifestKey === undefined ? undefined : manifest.files[row.manifestKey];
    // 🔴 非正式通道的字节**不算有产物**：那一轮的包不是给人装的（理由见 STABLE_VERSION）。
    //    判据按**这一枚文件**的版本，而不是整批 —— 合并清单里各端来自不同轮。
    if (file === undefined || !isStableChannel(file.version ?? manifest.version)) {
      return { row, state: 'pending' as const };
    }
    return { row, state: 'file-ready' as const, file };
  });
}

/**
 * 发布时刻的展示形式。
 *
 * ⚠️ 纯函数 + 显式 locale 参数，而不是在组件里直接 `toLocaleDateString()`：
 * 同一个 `releasedAt` 在测试环境（jsdom 的 ICU）与真浏览器里格式化结果不同，
 * 把格式化放进组件会让"这一页有没有日期"这条判据取决于跑它的那台机器。
 */
export function formatReleaseDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`发布清单里的 releasedAt 读不出日期：${iso}`);
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * 读清单并校验形状。
 *
 * 🔴 校验**放在这里而不是靠 TS**：`release-manifest.json` 是脚本从远端抄回来的，
 * 而 JSON import 的形状是"看起来像"，不是"验证过"。一条缺 sha256 的清单会让
 * 页面上出现一个没有校验值的按钮，而它照样能构建、照样能下载 —— 那正是最难归因的那种缺陷。
 * 出错就抛：宁可构建当场响，也不让一个说不清来路的按钮上公页。
 */
export function releaseManifest(raw: unknown = manifestJson): ReleaseManifest {
  const problems: string[] = [];
  const manifest = raw as Partial<ReleaseManifest>;
  if (typeof manifest.version !== 'string' || manifest.version === '') problems.push('缺 version');
  if (typeof manifest.releasedAt !== 'string') problems.push('缺 releasedAt');
  const files = manifest.files ?? {};
  for (const [key, file] of Object.entries(files)) {
    if (typeof file?.name !== 'string' || file.name === '') problems.push(`${key}: 缺 name`);
    if (typeof file?.url !== 'string' || !/^https:\/\//.test(file.url ?? '')) {
      problems.push(`${key}: url 必须是 https 直链`);
    }
    if (typeof file?.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(file.sha256 ?? '')) {
      problems.push(`${key}: sha256 必须是 64 位十六进制`);
    }
    if (typeof file?.size !== 'number' || !(file.size > 0)) problems.push(`${key}: size 必须是正数`);
    // 文件名必须真的属于它声称的那个版本：`latest/` 是个会被反复覆盖的目录，
    // 混进上一轮的字节的形状是"URL 与版本号都好看，但那是别的构建"。
    if (typeof file?.name === 'string' && typeof manifest.version === 'string') {
      const own = file.version ?? manifest.version;
      if (!file.name.startsWith(`heyta-${own}-`) || !file.url?.endsWith(`/${file.name}`)) {
        problems.push(`${key}: name/url 与 version 对不上（${file.name}）`);
      }
    }
  }
  for (const key of unknownManifestKeys(manifest as ReleaseManifest)) {
    problems.push(`清单里的 ${key} 没有登记在下载面注册表`);
  }
  for (const key of unknownChannelKeys(manifest as ReleaseManifest)) {
    problems.push(`清单里的通道 ${key} 不是注册表中标成商店的一行`);
  }
  problems.push(...illegalChannelUrls(manifest as ReleaseManifest));
  if (problems.length > 0) {
    throw new Error(`发布清单不合法：\n  ${problems.join('\n  ')}`);
  }
  return manifest as ReleaseManifest;
}

/**
 * 「访客在哪台机器上」—— 纯函数，输入是 `navigator.userAgent` 那一串。
 *
 * 🔴 **识别只用来挑一个推荐位，永远不用来隐藏别的行。**
 * 自动挑选错了的代价，不能让访客付出"找不到手动入口"。
 * 这也是 OBS 与 VS Code 的下载页共同的形状：推荐在最前，全表照旧在下面。
 *
 * ⚠️ `confident: false` 的两种真实成因（都不是"暂时没做好"）：
 *   1. Mac：UA 里读不出芯片，而当前只有 Apple Silicon 版 —— Intel 机器装了打不开；
 *   2. iPadOS 13+：UA 自称是 Macintosh。这一条没有任何纯 UA 的解法。
 * 两种都退回"请你确认一下"，而不是替访客拍板。
 */
export interface DetectedRow {
  readonly id: string;
  readonly confident: boolean;
}

export function detectRow(userAgent: string): DetectedRow | null {
  const ua = userAgent;
  // 鸿蒙必须在 Android 之前判：兼容模式下的鸿蒙 UA 同时含 "Android"。
  if (/HarmonyOS|OpenHarmony/i.test(ua)) return { id: 'harmony', confident: true };
  if (/iPhone|iPad|iPod/i.test(ua)) return { id: 'ios', confident: true };
  if (/Android/i.test(ua)) return { id: 'android', confident: true };
  if (/Mac OS X|Macintosh/i.test(ua)) return { id: 'macos', confident: false };
  if (/Windows/i.test(ua)) return { id: 'windows', confident: true };
  if (/Linux|X11/i.test(ua)) return { id: 'linux', confident: true };
  return null;
}

/** 字节的可读形式。**精确字节数照样渲染在旁边**：舍入过的数字不能用来核对文件。 */
export function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}
