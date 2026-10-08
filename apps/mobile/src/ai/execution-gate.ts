/**
 * 一次性执行闸门：同步占位，异步完成后释放。
 *
 * React Native 的 Pressable 在同一轮状态提交前可能收到两次 onPress；
 * 单靠 phase state 会让两个 handler 都看到旧值。这个无 UI 的小对象给发送、
 * 应用和确认共用同一条可测试语义。
 */
export interface ExecutionGate {
  tryEnter(): boolean;
  leave(): void;
  isActive(): boolean;
}

export function createExecutionGate(): ExecutionGate {
  let active = false;
  return {
    tryEnter(): boolean {
      if (active) return false;
      active = true;
      return true;
    },
    leave(): void {
      active = false;
    },
    isActive(): boolean {
      return active;
    },
  };
}

/** AssistantScreen 的硬件返回策略：busy 时消费事件，空闲时委托页面返回。 */
export function createAssistantBackHandler(
  isBusy: () => boolean,
  onBack: () => void,
): () => boolean {
  return () => {
    if (isBusy()) return true;
    onBack();
    return true;
  };
}
