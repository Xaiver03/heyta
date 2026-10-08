import { describe, expect, it } from 'vitest';

import { createAssistantBackHandler, createExecutionGate } from '../src/ai/execution-gate';

/**
 * 旧版本在这里数 AssistantScreen 里的五个表单、十个 gate 和五次请求调用；
 * 那种断言只会证明源码长得像旧实现。单一 Chatbot 的关键约束是行为：同一
 * 轮连点只允许一次、请求结束后能重试、忙时 Android 返回键必须被消费。
 * 这些都通过可注入的纯对象测试，不依赖 React Native render 栈。
 */
describe('移动端 Chatbot 运行期间的同步闸门', () => {
  it('快速连点只有第一次进入，异步完成后可以再次进入', () => {
    const gate = createExecutionGate();
    const submits: string[] = [];
    const submit = (value: string): void => {
      if (!gate.tryEnter()) return;
      submits.push(value);
    };

    submit('第一次');
    submit('重复点击');
    expect(submits).toEqual(['第一次']);
    expect(gate.isActive()).toBe(true);

    gate.leave();
    submit('失败后重试');
    expect(submits).toEqual(['第一次', '失败后重试']);
  });

  it('busy 时消费 Android 返回，释放后委托页面返回', () => {
    let busy = true;
    let backs = 0;
    const handler = createAssistantBackHandler(
      () => busy,
      () => {
        backs += 1;
      },
    );

    expect(handler()).toBe(true);
    expect(backs).toBe(0);
    busy = false;
    expect(handler()).toBe(true);
    expect(backs).toBe(1);
  });
});
