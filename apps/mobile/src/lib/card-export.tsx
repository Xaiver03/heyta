/**
 * 纪念卡片**成品图**的移动端栅格化（W7 · 设备出图那一半）
 * ==================================================================
 *
 * ## 这条路的四段，各自的事实源在哪
 *
 * | 段 | 谁做 | 单位 |
 * |---|---|---|
 * | 版面（坐标、排版角色、措辞、文件名、折行） | `packages/ui/src/countdown/card-export-layout.ts`（**唯一一份**，web 也用它） | — |
 * | 换算（倍率、该端 `toDataURL` 的那对数、每行的位置） | `./card-export-units.ts`（纯函数，node 判据直接跑） | ⚠️ 两端不同，见那里 |
 * | 绘制指令 → 位图 → base64 | `react-native-svg` 的原生 `toDataURL` | 同上 |
 * | base64 → 能被分享的文件 | 本壳的 `HeytaCardExport` 原生模块（Android：`cacheDir/card-export` + FileProvider；iOS：沙盒临时目录） | — |
 *
 * 🔴 **本文件只负责"把元素挂起来"**：不判断尺寸、不折行、不拼文件名。
 * 那些各写一遍就会漂，而且漂的样子是"屏幕上好看、导出的图不对"——门禁挡不住，
 * 只有人眼看得出（AGENTS §3.5 那两条抽取教训的同一种形状）。
 *
 * ## 为什么这里一个设计取值都不许多发明
 *
 * `EXPORT_CARD_*` 全部来自 `@heyta/shared-schema`（经由共享版面），
 * 字号/间距/颜色来自宿主交进来的那套 token（AGENTS §5 规则 1）。
 * 本文件唯一"新"的数是 `PixelRatio.get()` —— 那不是设计取值，是**这台设备的属性**。
 *
 * ## 🔴 失败必须说话
 *
 * 四种因各有各的一句（`countdown-display.ts` 的 `exportFailureText`）。
 * 用户点了"导出成品图"而界面什么都没变，是便签那条登记过的高危形状，不再复制一次。
 * 用户**主动取消**分享不算失败，所以单独一档，不与失败共用一句文案。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { PixelRatio, Platform, Share, View } from 'react-native';
import { Rect, Svg, Text as SvgText } from 'react-native-svg';
import { buildCardExportLayout, cardExportFileName, cardExportFileStem, type CardExportLayout, type CardExportRequest } from '@heyta/ui/node';
import { afterNextFrame, cardTextLinesFor, rasterRequestFor, rasterScaleFor, settleRasterize } from './card-export-units';
import { writeCardPng, type CardExportFailureCode } from './card-export-native';

export type { CardExportFailureCode as MobileCardExportFailure } from './card-export-native';

export type MobileCardExportResult =
  | { readonly ok: true; readonly fileName: string; readonly uri: string }
  /** 用户自己关掉了分享面板 —— 不是故障，界面不许说"导不出来"。 */
  | { readonly ok: false; readonly cancelled: true }
  | { readonly ok: false; readonly error: CardExportFailureCode; readonly detail?: string };

interface Pending {
  readonly request: CardExportRequest;
  readonly layout: CardExportLayout;
  readonly resolve: (result: MobileCardExportResult) => void;
}

/** 整张版面的元素树。判据与真机画的是**同一个**函数，不存在"看的那份不是画的那份"。 */
export function cardExportElements(layout: CardExportLayout): React.JSX.Element[] {
  const elements: React.JSX.Element[] = [];
  layout.ops.forEach((op, index) => {
    if (op.kind === 'rect') {
      elements.push(
        <Rect
          key={`r${String(index)}`}
          x={op.x}
          y={op.y}
          width={op.width}
          height={op.height}
          rx={Math.min(op.radius, op.width / 2, op.height / 2)}
          fill={op.color}
        />,
      );
      return;
    }
    cardTextLinesFor(op).forEach((line, lineIndex) => {
      elements.push(
        <SvgText
          key={`t${String(index)}-${String(lineIndex)}`}
          x={line.x}
          y={line.y}
          fill={op.color}
          fontSize={op.fontSize ?? 0}
          fontWeight={op.fontWeight}
          letterSpacing={op.letterSpacing}
          textAnchor="start"
          // 与 web 那一端同一条基线规则：每行在自己的行盒里垂直居中。
          // RNSVG 的列名是 `alignmentBaseline`（它没有 `dominantBaseline` 这一 prop，
          // 写错不会报错、只会静默按默认基线画 ⇒ 字整体偏高半行）。
          alignmentBaseline="central"
        >
          {line.line}
        </SvgText>,
      );
    });
  });
  return elements;
}

/**
 * 挂一次，得到 `{ exportCard, surface }`。宿主把 `surface` 渲染在界面里任意一处
 * （1×1、`opacity: 0`、不吃触摸，**不占版面**），把 `exportCard` 接到卡片那个动作上。
 *
 * 🔴 为什么必须"真的挂载一张 Svg"而不是命令式造一个：`toDataURL` 是原生对着
 * 视图树里那个 `RNSVGSvgView` 做的（JS 侧走 `findNodeHandle(this.root)`），
 * 没有挂载就没有 tag，也就没有图。两端都是这样。
 */
export function useCardExporter(): {
  exportCard: (request: CardExportRequest) => Promise<MobileCardExportResult>;
  surface: React.JSX.Element | null;
} {
  const svgRef = useRef<Svg | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const exportCard = useCallback((request: CardExportRequest) => {
    return new Promise<MobileCardExportResult>((resolve) => {
      // `PixelRatio.get()` 在这里取，不在模块顶层：顶层取值让这个文件在 node
      //（判据环境）里一 import 就炸，而版面的判据跑在 node 里。
      const layout = buildCardExportLayout(request, rasterScaleFor(PixelRatio.get()));
      setPending({ request, layout, resolve });
    });
  }, []);

  useEffect(() => {
    const current = pending;
    if (current === null) return;
    const mountedAtCommit = svgRef.current;
    if (mountedAtCommit === null) {
      // React 的 commit 在 effect 之前完成 ⇒ 走到这里就是真的没有视图。
      // **不静默重试**：重试会表现为"卡几秒后突然出图"，那种形状最像成功。
      current.resolve({ ok: false, error: 'rasterize-empty', detail: 'svg-not-mounted' });
      setPending(null);
      return;
    }
    const options = rasterRequestFor(Platform.OS, current.layout.width, current.layout.height);
    // 🔴 先让出一帧再问原生要图（为什么，见 `afterNextFrame` 的注释：不让这一帧，
    //    iOS 上原生的 tag 查找拿到 nil，而那条分支不回调 ⇒ 只能等到超时）。
    // 🔴 不直接 `svg.toDataURL(...)`：那条回调**可以永远不来**（见 `settleRasterize` 的注释），
    //    而"点了没反应"是本文件文件头登记过的高危形状。等不到也要出一句话。
    void afterNextFrame((run) => requestAnimationFrame(run)).then(() => {
      // 这一帧里界面可能已经被卸载（用户切走了屏）—— 那要出一句话，不许静默。
      const svg = svgRef.current;
      if (svg === null) {
        current.resolve({ ok: false, error: 'rasterize-empty', detail: 'svg-unmounted-in-frame' });
        setPending(null);
        return;
      }
      return settleRasterize((cb) => {
        svg.toDataURL(cb, options);
      }).then((raster) => {
        if (!raster.fired) {
          current.resolve({
            ok: false,
            error: 'rasterize-empty',
            detail: `rasterize-${raster.reason}`,
          });
          setPending(null);
          return;
        }
        void complete(current.request, raster.base64).then((result) => {
          current.resolve(result);
          setPending(null);
        });
      });
    });
  }, [pending]);

  const surface =
    pending === null ? null : (
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }}
      >
        <Svg ref={svgRef} width={pending.layout.width} height={pending.layout.height}>
          {cardExportElements(pending.layout)}
        </Svg>
      </View>
    );

  return { exportCard, surface };
}

/** base64 → 文件 → 分享面板。每一步的失败都带码回来。 */
async function complete(
  request: CardExportRequest,
  base64: string,
): Promise<MobileCardExportResult> {
  if (base64 === '') return { ok: false, error: 'rasterize-empty' };
  const stem = cardExportFileStem(request.texts.title);
  const fileName = cardExportFileName(stem, request.dateStem);
  const written = await writeCardPng(fileName, base64);
  if (!written.ok) {
    if (written.error === 'no-module') return { ok: false, error: 'no-module' };
    if (written.error === 'empty') return { ok: false, error: 'rasterize-empty' };
    return { ok: false, error: 'write-failed', detail: written.detail };
  }
  try {
    const share = await Share.share({ title: stem, url: written.uri });
    if (share.action === Share.dismissedAction) return { ok: false, cancelled: true };
    return { ok: true, fileName, uri: written.uri };
  } catch (e: unknown) {
    return {
      ok: false,
      error: 'share-failed',
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
