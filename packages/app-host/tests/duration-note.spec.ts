import { describe, expect, it } from 'vitest';

import {
  readDurationFromNote,
  removeDurationFromNote,
  renderDurationLine,
  writeDurationIntoNote,
} from '../src/duration-note.js';

describe('工时写进备注（而不是新增持久化字段）', () => {
  describe('renderDurationLine', () => {
    it('格式固定为「预计耗时：N 分钟」', () => {
      expect(renderDurationLine(90)).toBe('预计耗时：90 分钟');
    });
  });

  describe('写入', () => {
    it('空备注 → 只有这一行，**不产生前导空行**', () => {
      expect(writeDurationIntoNote(undefined, 30)).toBe('预计耗时：30 分钟');
      expect(writeDurationIntoNote('', 30)).toBe('预计耗时：30 分钟');
      expect(writeDurationIntoNote('   \n  ', 30)).toBe('预计耗时：30 分钟');
    });

    it('已有内容的备注 → 追加到末尾，原有内容一字不动', () => {
      expect(writeDurationIntoNote('## 拆解\n- [ ] 甲', 45)).toBe(
        '## 拆解\n- [ ] 甲\n预计耗时：45 分钟',
      );
    });

    it('🔴 已有估时 → **覆盖**，不是追加（反复估时不堆历史）', () => {
      const once = writeDurationIntoNote('## 拆解\n- [ ] 甲', 45);
      const twice = writeDurationIntoNote(once, 60);
      expect(twice).toBe('## 拆解\n- [ ] 甲\n预计耗时：60 分钟');
      expect(twice.match(/预计耗时/g)).toHaveLength(1);
    });

    it('🔴 覆盖时**位置不变**（不会把那一行挪到末尾）', () => {
      const note = '预计耗时：45 分钟\n## 拆解\n- [ ] 甲';
      expect(writeDurationIntoNote(note, 60)).toBe('预计耗时：60 分钟\n## 拆解\n- [ ] 甲');
    });

    it('已有估时在中间 → 仍然只留一行', () => {
      const note = '第一行\n预计耗时：45 分钟\n第三行';
      const out = writeDurationIntoNote(note, 60);
      expect(out).toBe('第一行\n预计耗时：60 分钟\n第三行');
      expect(out.match(/预计耗时/g)).toHaveLength(1);
    });
  });

  describe('读回', () => {
    it('备注未定义 / 没有那一行 → `undefined`', () => {
      expect(readDurationFromNote(undefined)).toBeUndefined();
      expect(readDurationFromNote('')).toBeUndefined();
      expect(readDurationFromNote('## 拆解\n- [ ] 甲')).toBeUndefined();
    });

    it('读得出写入的值（往返一致）', () => {
      for (const minutes of [5, 30, 90, 480]) {
        const note = writeDurationIntoNote('原有内容', minutes);
        expect(readDurationFromNote(note)).toBe(minutes);
      }
    });

    it('🔴 `0` 分钟与「没估过」必须分得开', () => {
      // `undefined` 是"没估过"，`0` 是"估了 0 分钟"。混在一起会让
      // 时间线把没估过的当成估了零。
      expect(readDurationFromNote('预计耗时：0 分钟')).toBe(0);
      expect(readDurationFromNote('没有这一行')).toBeUndefined();
    });

    it('🔴 不误伤正文里出现的相似说法', () => {
      // 逐行 + 全行锚定，所以散文里的"预计耗时"不会被当成数据。
      expect(readDurationFromNote('我预计耗时大概 3 天才能做完')).toBeUndefined();
      expect(readDurationFromNote('预计耗时：大约两小时')).toBeUndefined();
      expect(readDurationFromNote('预计耗时：abc 分钟')).toBeUndefined();
    });
  });

  describe('移除', () => {
    it('只移除那一行，其余原样保留', () => {
      const note = '第一行\n预计耗时：45 分钟\n第三行';
      expect(removeDurationFromNote(note)).toBe('第一行\n第三行');
    });

    it('没写过 → 原样返回（**不重新格式化备注**）', () => {
      const note = '  保留  我的   空格  ';
      expect(removeDurationFromNote(note)).toBe(note);
    });

    it('未定义 → 空字符串', () => {
      expect(removeDurationFromNote(undefined)).toBe('');
    });

    it('写入 → 移除 是往返一致的', () => {
      const original = '## 拆解\n- [ ] 甲';
      const written = writeDurationIntoNote(original, 45);
      expect(removeDurationFromNote(written)).toBe(original);
    });
  });
});
