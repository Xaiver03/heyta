/**
 * 附件共享模型的测试
 * ====================
 *
 * 挑的同样是**不报错、只会画错**的边界（与 `empty-state-model.spec.ts` 同一个取舍）：
 *
 *   · 缺 `sizeBytes` 的老数据 —— 兜成 `0` 会画出「0 字节」，而"不知道多大"
 *     与"零字节"是两句话；
 *   · `999_999` —— 四舍五入之后是 `1000 KB`，那句话技术上没错，但没人会写
 *     "1000 KB"（领域层的档位规则专门升了一级）；
 *   · `（quota-exceeded）` / `（too-large）` —— 这条链上两个最要紧的失败原因
 *     **带连字符**，而共享层另一枚 `rejectionReasonOf` 的正则只认 `[a-z_]`，
 *     用它读这两个词会一起静默降级成统称。下面那两条用例喂的是
 *     `attachment-actions.ts` 真的抛出来的消息形状。
 *
 * ⚠️ 这里**不渲染组件**（RN 是 Flow 源码，node 环境加载不了它，
 * `vitest.config.ts` 文件头记了理由）—— 所以判据只落在 `./model.ts` 里那三枚纯函数上，
 * 而 `AttachmentList.tsx` 剩下的部分刻意没有分支。
 */
import { describe, expect, it } from 'vitest';

import {
  attachmentFailureReasonOf,
  attachmentSizeLabelOf,
  formatAttachmentSize,
} from '../src/attachments/model.js';

/** 三档模板的长相与词条一致（`{n} KB` 那种）；具体语言由宿主决定。 */
const SIZE = {
  bytes: (n: number) => `${String(n)} bytes`,
  kb: (n: number) => `${String(n)} KB`,
  mb: (n: number) => `${String(n)} MB`,
};

describe('formatAttachmentSize（档位判断在领域层，这里只翻模板）', () => {
  it('三档各自落在对的那一档上', () => {
    expect(formatAttachmentSize(0, SIZE)).toBe('0 bytes');
    expect(formatAttachmentSize(999, SIZE)).toBe('999 bytes');
    expect(formatAttachmentSize(1_000, SIZE)).toBe('1 KB');
    expect(formatAttachmentSize(1_500_000, SIZE)).toBe('1.5 MB');
  });

  it('🔴 999_999 显示成 1 MB，不是 1000 KB（那一句没人会写）', () => {
    // 判据在 `@heyta/domain` 的 `attachmentSizeIn`（它专门为这一格升了一级）；
    // 这一条钉的是"共享层没有在它上面再套一层自己的舍入"。
    expect(formatAttachmentSize(999_999, SIZE)).toBe('1 MB');
  });

  it('负数 / NaN / Infinity 按 0 处理（领域层归零，这里不复判）', () => {
    expect(formatAttachmentSize(-5, SIZE)).toBe('0 bytes');
    expect(formatAttachmentSize(Number.NaN, SIZE)).toBe('0 bytes');
    expect(formatAttachmentSize(Number.POSITIVE_INFINITY, SIZE)).toBe('0 bytes');
  });
});

describe('attachmentSizeLabelOf（缺体积的老数据 ⇒ 整行不画）', () => {
  it('有大小 ⇒ 那句话', () => {
    expect(attachmentSizeLabelOf({ id: 'att-1', fileName: 'a.pdf', sizeBytes: 2_048 }, SIZE)).toBe('2 KB');
  });

  it('🔴 没有 sizeBytes ⇒ undefined（不是 "0 bytes"）', () => {
    // 兜成 0 的表现是：一条老数据在电脑上写「0 字节」、在手机上什么都不写
    // —— 同一份附件在两个端上是两句话，而没有任何测试会为它变红。
    expect(attachmentSizeLabelOf({ id: 'att-1', fileName: 'a.pdf' }, SIZE)).toBeUndefined();
    expect(attachmentSizeLabelOf({ id: 'att-1', fileName: 'a.pdf', sizeBytes: undefined }, SIZE)).toBeUndefined();
  });
});

describe('attachmentFailureReasonOf（带连字符的原因必须读得出来）', () => {
  /** 动作层真的抛出来的那两句（`attachment-actions.ts`）。 */
  const quota = new Error('上传失败（quota-exceeded）');
  const tooLarge = new Error('附件太大（too-large）：约 41943040 字节');

  it('🔴 quota-exceeded / too-large 都要读出来（`[a-z_]+` 那一版正则读不出，会一起降级成统称）', () => {
    expect(attachmentFailureReasonOf(quota)).toBe('quota-exceeded');
    expect(attachmentFailureReasonOf(tooLarge)).toBe('too-large');
  });

  it('其余三档也认得', () => {
    expect(attachmentFailureReasonOf(new Error('上传失败（network）'))).toBe('network');
    expect(attachmentFailureReasonOf(new Error('这台设备没有可用的上传通道（no-channel）'))).toBe('no-channel');
    expect(attachmentFailureReasonOf(new Error('（read-failed）'))).toBe('read-failed');
  });

  it('认不出来就回 undefined —— 不猜（猜错方向比一句统称更害人）', () => {
    expect(attachmentFailureReasonOf(new Error('上传失败（something-else）'))).toBeUndefined();
    expect(attachmentFailureReasonOf(new Error('找不到任务「t-1」（附件必须挂在一条活着的任务上）'))).toBeUndefined();
    expect(attachmentFailureReasonOf(new Error('附件名不合法（empty-name）'))).toBeUndefined();
    // 非 Error 的抛出行（`throw 'oops'`）不许崩。
    expect(attachmentFailureReasonOf('oops')).toBeUndefined();
    expect(attachmentFailureReasonOf(undefined)).toBeUndefined();
  });
});
