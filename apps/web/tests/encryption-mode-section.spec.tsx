/**
 * ADR-0080 S6：**关掉加密**那一次危险确认。
 *
 * 这里唯一真正承重的判据是：**三条后果一条都不许少，也不许合并成一句**。
 * 合并之后用户只看到"会变得不加密"，而真正要他承担的是
 * "已经进备份的明文收不回来"—— 那是不可逆的部分。
 *
 * 渲染沿用本仓库既有的裸 `createRoot` + `act`（web 侧没有装 testing-library），
 * 与 `vault-settings-panel.spec.tsx` 同一套方式。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@heyta/i18n';

import { EncryptionModeSection } from '../src/features/sync/EncryptionModeSection.js';

let container: HTMLDivElement;
let root: Root;

const mount = (props: Partial<React.ComponentProps<typeof EncryptionModeSection>> = {}) => {
  const onDisable = vi.fn();
  act(() => {
    root.render(
      <I18nProvider locale="zh-CN">
        <EncryptionModeSection mode="e2ee" onDisable={onDisable} {...props} />
      </I18nProvider>,
    );
  });
  return { onDisable };
};

const q = (testId: string): HTMLElement | null =>
  container.querySelector(`[data-testid="${testId}"]`);

const click = (element: Element | null | undefined): void => {
  if (element === null || element === undefined) throw new Error('expected element to click');
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const buttonWithText = (text: string): HTMLElement | undefined =>
  Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes(text));

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe('同步加密开关（ADR-0080）', () => {
  it('加密=开时显示"服务器读不到"，按钮是"关闭"', () => {
    mount();

    expect(q('encryption-mode-section')?.getAttribute('data-mode')).toBe('e2ee');
    expect(q('encryption-mode-status')?.textContent).toContain('服务器读不到');
    expect(q('encryption-mode-disable')).not.toBeNull();
    expect(q('encryption-mode-enable')).toBeNull();
  });

  it('加密=关时只写"服务器能读到"，不写"更安全/更私密"这类比较', () => {
    mount({ mode: 'plain' });

    expect(q('encryption-mode-section')?.getAttribute('data-mode')).toBe('plain');
    const state = q('encryption-mode-status')?.textContent ?? '';
    expect(state).toContain('服务器');
    expect(state).toContain('能读到');
    expect(state).not.toContain('更安全');
    expect(state).not.toContain('更私密');
  });

  it('点"关闭"先弹确认，**没有**直接执行动作', () => {
    const { onDisable } = mount();

    click(q('encryption-mode-disable'));

    expect(q('encryption-mode-confirm')).not.toBeNull();
    expect(onDisable).not.toHaveBeenCalled();
  });

  it('🔴 确认浮层逐条列出三条后果（少了不可逆那条就是缺陷）', () => {
    mount();
    click(q('encryption-mode-disable'));

    const items = Array.from(q('encryption-mode-consequences')?.querySelectorAll('li') ?? []);
    expect(items).toHaveLength(3);

    const text = items.map((item) => item.textContent ?? '').join('\n');
    expect(text).toContain('能看到任务内容'); // ① 谁能读
    expect(text).toContain('找回');           // ② 好处也要说
    expect(text).toContain('收不回来');       // ③ 不可逆

    // 三条必须各说各的，不能是同一句重复三次。
    expect(new Set(items.map((item) => item.textContent)).size).toBe(3);
  });

  it('确认之后才执行关闭', () => {
    const { onDisable } = mount();
    click(q('encryption-mode-disable'));
    click(buttonWithText('确认关闭'));

    expect(onDisable).toHaveBeenCalledTimes(1);
  });

  it('取消不执行关闭，且确认层收起', () => {
    const { onDisable } = mount();
    click(q('encryption-mode-disable'));
    click(buttonWithText('取消'));

    expect(onDisable).not.toHaveBeenCalled();
    expect(q('encryption-mode-confirm')).toBeNull();
  });

  it('迁移进行中显示进度，且按钮禁用', () => {
    mount({ busy: true, progress: { completed: 2, total: 5 } });

    expect(q('encryption-mode-status-busy')?.textContent).toContain('2/5');
    expect((q('encryption-mode-disable') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('重新开启加密的两段（ADR-0080 §5.3）', () => {
  const mountPlain = (enable: Partial<NonNullable<React.ComponentProps<typeof EncryptionModeSection>['enable']>> | undefined) => {
    const begin = vi.fn(async () => ({ recoveryCode: 'ABCD-EFGH-IJKL' }));
    const confirm = vi.fn(async () => {});
    act(() => {
      root.render(
        <I18nProvider locale="zh-CN">
          <EncryptionModeSection
            mode="plain"
            onDisable={() => {}}
            {...(enable === undefined ? {} : { enable: { begin, confirm, ...enable } })}
          />
        </I18nProvider>,
      );
    });
    return { begin, confirm };
  };

  const typeInto = (testId: string, value: string): void => {
    const input = q(testId) as HTMLInputElement | null;
    if (input === null) throw new Error(`expected input ${testId}`);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    act(() => {
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };

  const flushAsync = async (): Promise<void> => {
    await act(async () => { await Promise.resolve(); });
  };

  it('不传 enable ⇒ 不画那个按钮（不做"按下去没反应"的按钮）', () => {
    mountPlain(undefined);
    expect(q('encryption-mode-enable')).toBeNull();
  });

  it('第一段只拿到恢复码，**不**开始迁移', async () => {
    const { begin, confirm } = mountPlain({});
    click(q('encryption-mode-enable'));
    typeInto('encryption-enable-passphrase', 'correct horse battery staple');
    click(q('encryption-enable-start'));
    await flushAsync();

    expect(begin).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    // 一次性恢复码必须显示出来，否则用户没有退路。
    expect(q('encryption-enable-recovery-code')?.textContent).toContain('ABCD-EFGH-IJKL');
  });

  it('回填恢复码之后才真的迁移', async () => {
    const { confirm } = mountPlain({});
    click(q('encryption-mode-enable'));
    typeInto('encryption-enable-passphrase', 'correct horse battery staple');
    click(q('encryption-enable-start'));
    await flushAsync();
    typeInto('encryption-enable-recovery', 'abcd efgh ijkl');
    click(q('encryption-enable-confirm'));
    await flushAsync();

    expect(confirm).toHaveBeenCalledWith('abcd efgh ijkl');
  });
});

describe('第二个轴：钥匙放在哪（ADR-0080 §5.5）', () => {
  const mountWithPlacement = (
    props: Partial<React.ComponentProps<typeof EncryptionModeSection>> = {},
    value: 'device' | 'ask' = 'device',
  ) => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <I18nProvider locale="zh-CN">
          <EncryptionModeSection
            mode="e2ee"
            onDisable={() => {}}
            keyPlacement={{ value, onChange }}
            {...props}
          />
        </I18nProvider>,
      );
    });
    return { onChange };
  };

  it('不传 keyPlacement ⇒ 不画那一行（不生效的开关不如不画）', () => {
    act(() => {
      root.render(
        <I18nProvider locale="zh-CN">
          <EncryptionModeSection mode="e2ee" onDisable={() => {}} />
        </I18nProvider>,
      );
    });
    expect(q('encryption-key-placement')).toBeNull();
  });

  it('加密=关时不画那一行（钥匙放哪只在加密开着时才有意义）', () => {
    act(() => {
      root.render(
        <I18nProvider locale="zh-CN">
          <EncryptionModeSection
            mode="plain"
            onDisable={() => {}}
            keyPlacement={{ value: 'device', onChange: () => {} }}
          />
        </I18nProvider>,
      );
    });
    expect(q('encryption-key-placement')).toBeNull();
  });

  it('两个选项的 aria-pressed 反映当前值，点击把选择交出去', () => {
    const { onChange } = mountWithPlacement({}, 'device');

    expect(q('encryption-placement-device')?.getAttribute('aria-pressed')).toBe('true');
    expect(q('encryption-placement-ask')?.getAttribute('aria-pressed')).toBe('false');

    click(q('encryption-placement-ask'));
    expect(onChange).toHaveBeenCalledWith('ask');
  });

  it('提示句明说"不改变谁能读"（这是两个轴不许混的理由）', () => {
    mountWithPlacement();
    const hint = q('encryption-key-placement')?.textContent ?? '';
    expect(hint).toContain('不改变');
    expect(hint).toContain('谁能读');
  });

  /* ───────── R15：真实取舍必须在设置页说出来（不藏、也不劝） ───────── */

  it('🔴 两种模式都说出「开加密 ⇒ 托管 AI 用不了」这条真实取舍，且**各说各的**', () => {
    /**
     * 🔴 为什么必须断言"两句话不同"：
     * 第一版只断言两边都含 `托管 AI` —— 而 `tradeoffOn` 自己也含这三个字，
     * 于是把三元的两支都写成 `tradeoffOn`（= 加密关着却显示"用不了"），
     * **测试照样全绿**。实测过：那条变异没红，说明这一格根本没被钉住。
     * 现在两支各有一个**只在那一支出现**的片段：关=「现在托管」/ 开=「开启后」。
     * ⚠️ 别用「用不了」当判据 —— `tradeoffOff` 里也有这四个字（"开启加密后它就用不了"），
     * 拿它断言等于没断言。这是第二次踩同一个坑（第一次是「托管 AI」）。
     */
    mount({ mode: 'plain' });
    const plain = q('encryption-mode-tradeoff')?.textContent ?? '';
    expect(plain).toContain('现在托管');

    act(() => {
      root.render(
        <I18nProvider locale="zh-CN">
          <EncryptionModeSection mode="e2ee" onDisable={vi.fn()} />
        </I18nProvider>,
      );
    });
    const e2ee = q('encryption-mode-tradeoff')?.textContent ?? '';
    expect(e2ee).toContain('开启后');
    // 第三重：两句不许是同一句（回潮时这一条最先红）
    expect(plain).not.toBe(e2ee);
  });

  it('取舍那一行只有一句 + 一个「了解更多」，详细机制归文档中心（J1）', () => {
    mount({ mode: 'e2ee' });
    const line = q('encryption-mode-tradeoff');
    expect(line).not.toBeNull();
    // 一个链接，且指向帮助中心（不是内部弹窗）
    const links = line!.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toContain('/docs');
    // 句子里不许出现第二段解释（"换行三次"就是说明文回来了）
    expect((line!.textContent ?? '').split('。').filter((x) => x.trim() !== '').length).toBeLessThanOrEqual(2);
  });

  it('🔴 披露句不是劝阻：不出现「为了安全/建议您/请勿」这类劝说词', () => {
    for (const mode of ['plain', 'e2ee'] as const) {
      act(() => {
        root.render(
          <I18nProvider locale="zh-CN">
            <EncryptionModeSection mode={mode} onDisable={vi.fn()} />
          </I18nProvider>,
        );
      });
      const text = q('encryption-mode-tradeoff')?.textContent ?? '';
      expect(text).not.toContain('为了安全');
      expect(text).not.toContain('建议您');
      expect(text).not.toContain('请勿');
    }
  });
});
