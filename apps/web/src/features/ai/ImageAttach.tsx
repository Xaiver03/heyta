/**
 * 助手输入框里的"附一张图"—— **截图转任务**的入口
 * ================================================
 *
 * ⚠️ 2026-11 之前它同时服务捕获框；随「一句话解析」搬进右侧助手之后，
 * 它只服务助手（`data-heyta-chat-root` / `chat-attach`）。
 *
 * 这个文件活在 web 壳里，理由与 `image-encode.ts` 同一条：它要读 `DataTransfer`
 * 与 `<input type=file>`，而共享的 `CaptureComposer` 是 web 与 RN 的同一份实现。
 * 它**现在只服务右侧助手**（`data-heyta-chat-root`）—— 捕获框那条贴图入口
 * 随「一句话解析」一起搬走了（2026-11），共享层原来的 `renderAssistant` 插槽也已删除。
 * DOM 事件留在各端。
 *
 * ## 🔴 为什么粘贴要监听 `document`
 *
 * 贴图的真实动作是"在别的窗口截个图 → 切回来 → ⌘V"，而**焦点在输入框里**，
 * 那个输入框由共享 composer 渲染，本组件碰不到它的 `onPaste`。
 * 于是这里挂一个文档级监听 —— 但必须能准确判断"这次粘贴是冲我来的"：
 *
 * 判据是 `activeElement` 落在 `[data-heyta-capture-root]` 之内（那个标记由
 * `features/capture/CaptureComposer.tsx` 打在共享 composer 外面）。
 * **没有这个判据的版本会在搜索框里粘贴时吃掉用户的图** —— 那比不做还糟。
 *
 * ## 剪贴板里同时有文字和图片
 *
 * 优先**图片**，且不阻止默认行为：用户按一次粘贴，图被收下、文字照常落进输入框。
 * 只有真的取到了图片时才 `preventDefault()`（否则会往输入框里粘一串无意义的内存地址）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { IMAGE_BUDGET } from '@heyta/ai';
import { ICON_SIZE } from '@heyta/design-system';
import { ImagePlus } from 'lucide-react';
import { useI18n } from '@heyta/i18n';

import { encodeImageForEgress, imagesFromClipboard, type EncodedImage, type ImageFileError } from './image-encode.js';
import './image-attach.css';

export interface ImageAttachProps {
  readonly images: readonly EncodedImage[];
  readonly onChange: (next: readonly EncodedImage[]) => void;
  /** AI 面板正在发送时冻住入口，避免"发到一半又换了一张"。 */
  readonly disabled?: boolean;
  /**
   * 粘贴归属判据的**选择器**。
   *
   * 捕获框用 `[data-heyta-capture-root]`，对话面板用 `[data-heyta-chat-root]`。
   * 定成一个参数是因为它决定"这次粘贴是不是冲我来的"——
   * 写死一个会让另一个界面**要么抢粘贴、要么完全不响应**，而两者都不会报错。
   */
  readonly pasteScope?: string;
  /** 测试前缀。捕获与对话用不同前缀，避免两处同时挂载时选择器撞车。 */
  readonly testIdPrefix?: string;
}

/**
 * 失败原因 → 文案键。**每种各一句**，不合并（合并后用户只知道"不行"）。
 *
 * ⚠️ `as const` 不是风格：文案键是**字面量联合类型**，用 `Record<…, string>`
 * 会把键放宽成 `string`，于是 `t()` 不再校验它存在 —— 少一个键就变成运行时的空白。
 */
const ERROR_KEYS = {
  'bad-type': 'web.ai.attach.badType',
  'too-big': 'web.ai.attach.tooBig',
  undecodable: 'web.ai.attach.undecodable',
} as const satisfies Record<ImageFileError, string>;

/**
 * 附件能力的**一次性装配**：`picker` 进输入框内部左下角，`thumbs` 落在字段下方。
 *
 * 🔴 为什么拆成两半（2026-11-02，产品负责人第四次为同一个地方发火）：
 * 上一版是一个"独立的附件区"—— 一枚方框按钮，**浮在输入框上方单独一行**。
 * 原话：「这个框简直是方方正正的，也太丑了……把那个框放到对话框里面不就好了吗？
 * 就是那个添加的框，放到对话框左下角有什么不行？」
 *
 * 所以取景变成：**输入框是唯一的框**，附件按钮是它内部左下角的一枚图标；
 * 图片缩略图（那是**数据**，不是 chrome）落在字段下方。
 * 拆成 hook 是因为两半必须共享同一份 `busy`/`error`/`accept` ——
 * 写两个组件就会各自持有一份状态，而 `too-many` 恰恰发生在"一张都没收下"的时候。
 */
export function useImageAttach({
  images,
  onChange,
  disabled = false,
  pasteScope = '[data-heyta-capture-root]',
  testIdPrefix = 'capture-attach',
}: ImageAttachProps): {
  readonly picker: React.JSX.Element;
  readonly thumbs: React.JSX.Element | null;
} {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ImageFileError | 'too-many' | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * 收下一批文件。
   *
   * ⚠️ 张数闸门在**这里**判（而不是只信出境层）：出境层抛错时请求已经构造到一半，
   * 而这里能在用户放手的瞬间就说"最多 2 张"。两处用的是同一个 `IMAGE_BUDGET`。
   */
  const accept = useCallback(
    async (files: readonly File[]): Promise<void> => {
      if (files.length === 0) return;
      setError(undefined);

      const room = IMAGE_BUDGET.maxImagesPerRequest - images.length;
      if (room <= 0) {
        setError('too-many');
        return;
      }

      setBusy(true);
      try {
        const accepted: EncodedImage[] = [];
        for (const file of files.slice(0, room)) {
          const result = await encodeImageForEgress(file);
          if (!result.ok) {
            // 一张失败就停：继续收后面的会让用户以为"只成功了一部分"，
            // 而界面上一句话说不清是哪一张失败了。
            setError(result.error);
            break;
          }
          accepted.push(result.image);
        }
        if (accepted.length > 0) onChange([...images, ...accepted]);
        // 溢出（选了 3 张但只收 2 张）也要说一声，否则用户以为第三张进去了。
        if (files.length > room) setError('too-many');
      } finally {
        setBusy(false);
        // 允许再次选同一个文件（否则 input 的 value 不变，onChange 不再触发）
        if (inputRef.current !== null) inputRef.current.value = '';
      }
    },
    [images, onChange],
  );

  useEffect(() => {
    if (disabled) return;
    function onPaste(event: ClipboardEvent): void {
      const active = document.activeElement;
      const inScope = active !== null && active.closest(pasteScope) !== null;
      if (!inScope) return;
      const files = imagesFromClipboard(event.clipboardData);
      if (files.length === 0) return;
      // 真的收到了图才拦 —— 只有文字时让粘贴照常落进输入框。
      event.preventDefault();
      void accept(files);
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [accept, disabled, pasteScope]);

  const totalBytes = images.reduce((sum, image) => sum + image.bytes, 0);

  const picker = (
    <span className="ht-capture-attach__picker" data-testid={testIdPrefix}>
      {/*
        🔴 **一枚纯图标，没有自己的框**（2026-11-02）。
        它住在**输入框内部**的左下角（助手自己摆位；捕获框那个兄弟槽位已随搬家删除）——
        "输入框是唯一的框"，附件按钮只是它里面的一枚图标。

        两条禁令都在这一块上：不写说明文字（上一版是「也可以直接粘贴截图」，
        而它在任务列与助手里各出现一遍），也不给自己再画一个方框
        （那是"面板套面板"在控件尺度上的重演）。
      */}
      <button
        type="button"
        className="ht-capture-attach__pick"
        data-testid={`${testIdPrefix}-pick`}
        aria-label={busy ? t('web.ai.attach.busy') : t('web.ai.attach.label')}
        title={t('web.ai.attach.label')}
        disabled={disabled || busy || images.length >= IMAGE_BUDGET.maxImagesPerRequest}
        onClick={() => inputRef.current?.click()}
      >
        <ImagePlus size={ICON_SIZE.sm} aria-hidden="true" />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_BUDGET.mediaTypes.join(',')}
        multiple
        hidden
        data-testid={`${testIdPrefix}-input`}
        onChange={(event) => {
          void accept(Array.from(event.currentTarget.files ?? []));
        }}
      />
    </span>
  );

  const thumbs = images.length === 0 && error === undefined ? null : (
    <div className="ht-capture-attach__below">
      {images.length > 0 && (
        <>
          <ul className="ht-capture-attach__list" data-testid={`${testIdPrefix}-list`}>
            {images.map((image, index) => (
              <li key={`${image.base64.slice(0, 16)}-${String(index)}`} className="ht-capture-attach__item">
                <img
                  className="ht-capture-attach__thumb"
                  alt=""
                  src={`data:${image.mediaType};base64,${image.base64}`}
                />
                <span className="ht-capture-attach__meta" data-testid={`${testIdPrefix}-meta`}>
                  {t('web.ai.attach.meta', {
                    width: image.width,
                    height: image.height,
                    kb: Math.max(1, Math.round(image.bytes / 1024)),
                  })}
                </span>
                <button
                  type="button"
                  className="ht-btn ht-btn--ghost ht-capture-attach__remove"
                  data-testid={`${testIdPrefix}-remove-${String(index)}`}
                  aria-label={t('web.ai.attach.remove', { index: index + 1 })}
                  onClick={() => onChange(images.filter((_, i) => i !== index))}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <p className="ht-capture-attach__sum" data-testid={`${testIdPrefix}-sum`}>
            {t('web.ai.attach.sum', {
              count: images.length,
              kb: Math.max(1, Math.round(totalBytes / 1024)),
            })}
          </p>
        </>
      )}

      {error !== undefined && (
        <p className="ht-capture-attach__error" role="alert" data-testid={`${testIdPrefix}-error`}>
          {error === 'too-many'
            ? t('web.ai.attach.tooMany', { max: IMAGE_BUDGET.maxImagesPerRequest })
            : t(ERROR_KEYS[error])}
        </p>
      )}
    </div>
  );

  return { picker, thumbs };
}
