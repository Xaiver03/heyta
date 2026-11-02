/**
 * 捕获框里的"附一张图"—— **截图转任务**的入口
 * ================================================
 *
 * 这个文件活在 web 壳里，理由与 `image-encode.ts` 同一条：它要读 `DataTransfer`
 * 与 `<input type=file>`，而共享的 `CaptureComposer` 是 web 与 RN 的同一份实现。
 * 共享层只留一个插槽（`renderAssistant`），DOM 事件留在各端。
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
import { useI18n } from '@heyta/i18n';

import { encodeImageForEgress, imagesFromClipboard, type EncodedImage, type ImageFileError } from './image-encode.js';
import './capture-attach.css';

export interface CaptureImageAttachProps {
  readonly images: readonly EncodedImage[];
  readonly onChange: (next: readonly EncodedImage[]) => void;
  /** AI 面板正在发送时冻住入口，避免"发到一半又换了一张"。 */
  readonly disabled?: boolean;
}

/**
 * 失败原因 → 文案键。**每种各一句**，不合并（合并后用户只知道"不行"）。
 *
 * ⚠️ `as const` 不是风格：文案键是**字面量联合类型**，用 `Record<…, string>`
 * 会把键放宽成 `string`，于是 `t()` 不再校验它存在 —— 少一个键就变成运行时的空白。
 */
const ERROR_KEYS = {
  'bad-type': 'web.capture.attach.badType',
  'too-big': 'web.capture.attach.tooBig',
  undecodable: 'web.capture.attach.undecodable',
} as const satisfies Record<ImageFileError, string>;

export function CaptureImageAttach({
  images,
  onChange,
  disabled = false,
}: CaptureImageAttachProps): React.JSX.Element {
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
      const inCapture =
        active !== null && active.closest('[data-heyta-capture-root]') !== null;
      if (!inCapture) return;
      const files = imagesFromClipboard(event.clipboardData);
      if (files.length === 0) return;
      // 真的收到了图才拦 —— 只有文字时让粘贴照常落进输入框。
      event.preventDefault();
      void accept(files);
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [accept, disabled]);

  const totalBytes = images.reduce((sum, image) => sum + image.bytes, 0);

  return (
    <div className="ht-capture-attach" data-testid="capture-attach">
      <div className="ht-capture-attach__row">
        <button
          type="button"
          className="ht-btn ht-btn--ghost"
          data-testid="capture-attach-pick"
          aria-label={t('web.capture.attach.label')}
          disabled={disabled || busy || images.length >= IMAGE_BUDGET.maxImagesPerRequest}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? t('web.capture.attach.busy') : t('web.capture.attach.label')}
        </button>
        <span className="ht-capture-attach__hint">{t('web.capture.attach.hint')}</span>
        <input
          ref={inputRef}
          type="file"
          accept={IMAGE_BUDGET.mediaTypes.join(',')}
          multiple
          hidden
          data-testid="capture-attach-input"
          onChange={(event) => {
            void accept(Array.from(event.currentTarget.files ?? []));
          }}
        />
      </div>

      {images.length > 0 && (
        <>
          <ul className="ht-capture-attach__list" data-testid="capture-attach-list">
            {images.map((image, index) => (
              <li key={`${image.base64.slice(0, 16)}-${String(index)}`} className="ht-capture-attach__item">
                <img
                  className="ht-capture-attach__thumb"
                  alt=""
                  src={`data:${image.mediaType};base64,${image.base64}`}
                />
                <span className="ht-capture-attach__meta" data-testid="capture-attach-meta">
                  {t('web.capture.attach.meta', {
                    width: image.width,
                    height: image.height,
                    kb: Math.max(1, Math.round(image.bytes / 1024)),
                  })}
                </span>
                <button
                  type="button"
                  className="ht-btn ht-btn--ghost ht-capture-attach__remove"
                  data-testid={`capture-attach-remove-${String(index)}`}
                  aria-label={t('web.capture.attach.remove', { index: index + 1 })}
                  onClick={() => onChange(images.filter((_, i) => i !== index))}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <p className="ht-capture-attach__sum" data-testid="capture-attach-sum">
            {t('web.capture.attach.sum', {
              count: images.length,
              kb: Math.max(1, Math.round(totalBytes / 1024)),
            })}
          </p>
        </>
      )}

      {error !== undefined && (
        <p className="ht-capture-attach__error" role="alert" data-testid="capture-attach-error">
          {error === 'too-many'
            ? t('web.capture.attach.tooMany', { max: IMAGE_BUDGET.maxImagesPerRequest })
            : t(ERROR_KEYS[error])}
        </p>
      )}
    </div>
  );
}
