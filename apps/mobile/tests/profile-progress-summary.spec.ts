import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/screens/ProfileProgressSummary.tsx', import.meta.url), 'utf8');

describe('移动端个人中心的成长摘要', () => {
  it('三格横排，每格用 testID 作 key', () => {
    /**
     * 🔴 2026-11-15 结构变了：竖排三行 `SettingsRow` → 横排三格（照滴答的数据概览）。
     * 原来这两条断言钉的是 `settingsRowKey` 那条"稳定 key"规矩 ——
     * 那是**为了避免 value 行回落到重复的 kind**，而横排三格已经不用 `SettingsRow`，
     * 那个问题不存在了。现在钉的是"每格有唯一 testID 作 key"。
     */
    expect(source).toMatch(/cells\.map\(\(cell\) =>/u);
    expect(source).toMatch(/key=\{cell\.testID\}/u);
  });

  it('摘要只投影共享的本周回顾与里程碑事实源', () => {
    expect(source).toMatch(/weeklyReviewFromState\(tables, now\)/u);
    expect(source).toMatch(/milestonesFromState\(tables\)/u);
    /* 锚点全部保留（三条 `verify-mobile-*` 靠它们定位），只是从 `valueTestID` 改成 `testID`。 */
    expect(source).toContain("testID: 'profile-progress-tasks'");
    expect(source).toContain("testID: 'profile-progress-focus'");
    expect(source).toContain("testID: 'profile-progress-growth'");
  });

  it('常驻个人中心同时订阅同步修订与本地写入信号', () => {
    expect(source).toContain("import { onLocalWrite } from '../sync/write-signal';");
    expect(source).toContain('const [localWriteRevision, setLocalWriteRevision] = useState(0);');
    expect(source).toContain('useEffect(() => onLocalWrite(() => {');
    expect(source).toContain('}, [dataRevision, localWriteRevision, retryRevision]);');
  });

  it('读取过程有可见的 loading / error / retry / stale 状态', () => {
    expect(source).toContain("useState<'loading' | 'ready' | 'error'>('loading')");
    expect(source).toContain("setReadState('error')");
    expect(source).toContain("mobile.profile.progress.loading");
    expect(source).toContain("mobile.profile.progress.error");
    expect(source).toContain("mobile.profile.progress.stale");
    expect(source).toContain("mobile.profile.progress.retry");
    expect(source).toContain('setRetryRevision');
  });
});
