/**
 * 读一个本机 URI 的文本（备份还原的"选文件"这条路用）。
 *
 * ## 为什么不是 `fetch(uri)` 或 `XHR(responseType: 'text')`
 *
 * 实测：RN 0.84.1 / Android 上 `content://` 与 `file://` **一律读不出来** ——
 * `fetch` 回 `Network request failed`，`responseType: 'blob'` 回 XHR onerror。
 * 真因在原生侧：`NetworkingModule.sendRequestInternalReal` 处理本机 URI 时为了
 * 造一个假的 `okhttp3.Response` 而调 `Request.Builder().url(...)`，OkHttp 只接受
 * http/https，于是在 `NetworkingModule.kt:318` 抛异常（logcat 里失败栈顶就是它）。
 * 也就是说 RN 自己的"blob 通道"在这个版本这条路上是**坏的**，与我们的代码无关。
 *
 * ## 两条通道，按平台分
 *
 * | 通道 | 谁 | 状态 |
 * |---|---|---|
 * | `HeytaLocalFs.readTextUri`（`ContentResolver.openInputStream`） | Android 原生模块 | ✅ 真机判据覆盖 |
 * | RN 的 `responseType: 'blob'` + `FileReaderModule.readAsText` | iOS 的退路 | ⚠️ **未实测**（iOS 侧没有原生模块：本工程的 Xcode 工程是经典分组，加 `.m/.swift` 要改 pbxproj） |
 *
 * 🔴 取不到通道时**抛错**，不返回空串：界面上"读不到"与"读出来是空的"是两件事
 * —— 合成一条就等于永久藏起后者（这一轮被判据② 逼出来的原话）。
 */

/** 与 `LocalFsModule.kt` 的 `LocalFsModule.NAME` **必须一致**。 */
const MODULE_NAME = 'HeytaLocalFs';

/** RN 核心 `FileReaderModule` 的字节→文本方法（注册名来自它的 spec）。 */
interface CoreFileReader {
  readAsText(blob: { blobId: string; offset: number; size: number }, encoding: string): Promise<string>;
}

interface LocalFsNative {
  readTextUri(uri: string): Promise<string>;
  /**
   * 把一张本机图压成头像契约要的那张方形图，回 base64。
   * 为什么它挂在**同一个模块**上而不是再建一个：读 URI 的字节是同一个平台能力，
   * 两个 `NativeModules` 入口 = 两处各自处理"这台设备上有没有这个模块"。
   * ⚠️ 可选的：iOS 侧目前没有这个原生模块，调用方必须自己判缺。
   */
  prepareAvatarBase64?(uri: string, edgePx: number, format: string): Promise<string>;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 取那个原生模块（没有就回 `undefined`）。
 *
 * 🔴 **导出是为了只有一个入口**：头像那条路（`lib/avatar-prepare.ts`）问的是
 * 同一个"这台设备上有没有 `HeytaLocalFs`"。两处各写一遍 `require('react-native')`
 * 的话，"缺模块"这件事在两条路上可以有两种表现 —— 而它应当只有一种。
 */
export function nativeModule(): LocalFsNative | undefined {
  try {
    const rn = require('react-native') as {
      NativeModules?: Record<string, unknown>;
      TurboModuleRegistry?: unknown;
    };
    // TurboModule-backed NativeModules returns null for an unregistered module.
    return (rn.NativeModules?.[MODULE_NAME] ?? undefined) as LocalFsNative | undefined;
  } catch {
    // 测试环境（node）里没有 react-native —— 这里是"没有原生模块"，不是错误。
    return undefined;
  }
}

/**
 * `XMLHttpRequest` + `responseType: 'blob'` → RN 的字节缓存句柄。
 *
 * ⚠️ 在 Android / RN 0.84.1 上这条路**实测必失败**（见文件头），留着是因为
 * iOS 的 NSURLSession 能处理 `file://`；它是否真的走得通尚未在模拟器上验过。
 */
function xhrBlobHandle(uri: string): Promise<{ blobId: string; offset: number; size: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', uri, true);
    xhr.responseType = 'blob';
    xhr.onload = () => {
      const data = (xhr.response as { data?: Record<string, unknown> } | null | undefined)?.data;
      const blobId = data?.blobId;
      if (typeof blobId !== 'string') {
        reject(new Error('blob 响应里没有 blobId'));
        return;
      }
      const offset = typeof data?.offset === 'number' ? data.offset : 0;
      const size = typeof data?.size === 'number' ? data.size : 0;
      resolve({ blobId, offset, size });
    };
    xhr.onerror = () => {
      reject(new Error('XHR 读取失败'));
    };
    xhr.send();
  });
}

async function readViaRnBlob(uri: string): Promise<string> {
  const rn = require('react-native') as {
    TurboModuleRegistry?: { get(name: string): unknown };
  };
  const reader = rn.TurboModuleRegistry?.get('FileReaderModule') as CoreFileReader | undefined;
  if (reader == null || typeof reader.readAsText !== 'function') {
    throw new Error('本机没有 FileReaderModule');
  }
  return await reader.readAsText(await xhrBlobHandle(uri), 'UTF-8');
}

/** 读一个本机 URI 的 UTF-8 文本。失败一定抛错，且错误里带着试过哪条通道。 */
export async function readLocalTextUri(uri: string): Promise<string> {
  const mod = nativeModule();
  if (mod !== undefined && typeof mod.readTextUri === 'function') {
    try {
      return await mod.readTextUri(uri);
    } catch (e: unknown) {
      throw new Error(`${MODULE_NAME} ${errText(e)}`);
    }
  }
  try {
    return await readViaRnBlob(uri);
  } catch (e: unknown) {
    throw new Error(`没有 ${MODULE_NAME} 模块，blob 退路也失败：${errText(e)}`);
  }
}
