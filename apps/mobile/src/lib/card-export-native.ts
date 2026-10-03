/**
 * 成品图落盘的那条原生通道（W7 · 移动端）。
 *
 * 这一层只做三件事：找到原生模块、调用、**把失败分码报回去**。
 * 图像内容它不看、尺寸它不判、文件名它不拼 —— 那些都在 `card-export.tsx` 与共享版面里。
 *
 * ## 🔴 为什么"没有原生模块"必须是一种会显示的失败
 *
 * `NativeModules.HeytaCardExport` 为 `undefined` 有两种原因，而且它们在日志里长得一模一样：
 * ① 这台设备的包里没有那个模块（忘了在 `MainApplication.kt` 里 `add(CardExportPackage())`，
 *    或 iOS 的那两个文件没进 Xcode target）；② 设备本身不支持（理论上不存在这一档，
 *    两端都编进去了）。
 * 本仓在小组件那条路上栽过同一个坑：降级成"没有小组件支持"之后，
 * **接线忘了**和**这台设备真的不支持**就成了同一句话（`src/widgets/widget-bridge.ts` 文件头）。
 * 所以这里不猜原因，只把码带上去，由界面说话。
 */

/** 与 `CardExportModule.kt` 的 `NAME`、iOS 侧 `moduleName()` **必须逐字一致**。 */
export const CARD_EXPORT_MODULE_NAME = 'HeytaCardExport';

/**
 * 导出能失败的四种因。
 *
 * 🔴 这个联合类型住在本文件而不是 `card-export.tsx`：后者顶层 import 了
 * `react-native`，而词条层（`countdown-display.ts`）要在 node 的判据里引用这个类型。
 * 让它去 import 那个文件就等于让 node 去要一个 RN 运行时。
 */
export type CardExportFailureCode =
  | 'no-module'
  | 'rasterize-empty'
  | 'write-failed'
  | 'share-failed';

interface CardExportNative {
  writePngBase64(fileName: string, base64: String): Promise<string>;
}

/** 落盘这一步能失败的几种方式，每一种都对应界面上一句不同的话。 */
export type CardWriteFailure = 'no-module' | 'empty' | 'write-failed';

export type CardWriteResult =
  | { readonly ok: true; readonly uri: string }
  | { readonly ok: false; readonly error: CardWriteFailure; readonly detail?: string };

/**
 * 取原生模块。**不在顶层 require `react-native`**：这条路上还有 node 侧的判据
 * （版面是纯函数，判据在 node 里跑），顶层 import 会让那些判据在没有 RN 运行时的
 * 环境里直接炸。与 `local-file-read.ts` 同一做法。
 */
function native(): CardExportNative | undefined {
  try {
    const rn = require('react-native') as { NativeModules?: Record<string, unknown> };
    return rn.NativeModules?.[CARD_EXPORT_MODULE_NAME] as CardExportNative | undefined;
  } catch {
    return undefined;
  }
}

/**
 * 把 base64 PNG 写进应用自己的缓存目录，回一个可以交给 `Share` 的 `content://` / `file://` URI。
 *
 * ⚠️ 空字符串**不是**成功。原生侧 `toDataURL` 在视图还没量出尺寸时会回一个空回调
 * （`RNSVGSvgViewModule.mm` 里那条 `callback(@[])` 的路径），
 * 而"写了个零字节文件"在分享面板里长得和成功一模一样。
 */
export async function writeCardPng(
  fileName: string,
  base64: string,
): Promise<CardWriteResult> {
  const module = native();
  if (module === undefined || typeof module.writePngBase64 !== 'function') {
    return { ok: false, error: 'no-module' };
  }
  if (base64 === '') {
    return { ok: false, error: 'empty' };
  }
  try {
    const uri = await module.writePngBase64(fileName, base64);
    if (typeof uri !== 'string' || uri === '') {
      return { ok: false, error: 'empty' };
    }
    return { ok: true, uri };
  } catch (e: unknown) {
    return {
      ok: false,
      error: 'write-failed',
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
