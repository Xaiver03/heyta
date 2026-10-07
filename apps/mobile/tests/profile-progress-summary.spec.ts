import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/screens/ProfileProgressSummary.tsx', import.meta.url), 'utf8');

describe('移动端个人中心的成长摘要', () => {
  it('数值行使用共享的稳定 key，避免 value 行回落到重复的 kind', () => {
    expect(source).toContain('settingsRowKey');
    expect(source).toMatch(/rows\.map\(\(row, index\) =>/u);
    expect(source).toMatch(/key=\{settingsRowKey\(row, index\)\}/u);
    expect(source).not.toContain('key={row.testID ?? row.kind}');
  });

  it('摘要只投影共享的本周回顾与里程碑事实源', () => {
    expect(source).toMatch(/weeklyReviewFromState\(tables, now\)/u);
    expect(source).toMatch(/milestonesFromState\(tables\)/u);
    expect(source).toContain("valueTestID: 'profile-progress-tasks'");
    expect(source).toContain("valueTestID: 'profile-progress-focus'");
    expect(source).toContain("valueTestID: 'profile-progress-achievements'");
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
