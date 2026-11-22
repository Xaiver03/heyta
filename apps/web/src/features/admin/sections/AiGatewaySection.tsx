import { useEffect, useState } from 'react';

import { useI18n } from '@heyta/i18n/provider';
import type { AdminAiUpstreamInput } from '@heyta/app-host';

import type { AdminStoreState } from '../store.js';

/**
 * AI 接入网关（管理后台）：编辑上游列表 → 保存 → 试连。
 *
 * 🔴 这里**不判**任何合法性：https 校验、选择/脱敏、密钥合并全在服务端
 * （`server/src/ai/ai-gateway.ts` / `gateway-store.ts`）。本组件只做"收集输入 + 回显"。
 */
interface DraftRow {
  id: string;
  label: string;
  baseUrl: string;
  modelId: string;
  apiKey: string;
  enabled: boolean;
  priority: string;
  weight: string;
  hasApiKey: boolean;
}

export function AiGatewaySection({ store }: { store: AdminStoreState }): React.JSX.Element {
  const { t } = useI18n();
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [notice, setNotice] = useState<'saved' | 'failed' | null>(null);
  const [tested, setTested] = useState<Record<string, 'ok' | 'fail'>>({});

  useEffect(() => {
    const view = store.aiGateway;
    if (view === null) return;
    setRows(
      view.upstreams.map((u) => ({
        id: u.id,
        label: u.label,
        baseUrl: u.baseUrl,
        modelId: u.modelId,
        apiKey: '',
        enabled: u.enabled,
        priority: String(u.priority),
        weight: String(u.weight),
        hasApiKey: u.hasApiKey,
      })),
    );
  }, [store.aiGateway]);

  const patch = (i: number, p: Partial<DraftRow>): void =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...p } : r)));

  const addRow = (): void =>
    setRows((prev) => [
      ...prev,
      { id: '', label: '', baseUrl: '', modelId: '', apiKey: '', enabled: true, priority: '0', weight: '1', hasApiKey: false },
    ]);

  const removeRow = (i: number): void => setRows((prev) => prev.filter((_, idx) => idx !== i));

  const save = async (): Promise<void> => {
    const payload: AdminAiUpstreamInput[] = rows.map((r) => ({
      id: r.id.trim(),
      label: r.label.trim() === '' ? undefined : r.label.trim(),
      baseUrl: r.baseUrl.trim(),
      modelId: r.modelId.trim(),
      ...(r.apiKey.trim() === '' ? {} : { apiKey: r.apiKey.trim() }),
      enabled: r.enabled,
      priority: Number(r.priority) || 0,
      weight: Number(r.weight) || 1,
    }));
    const res = await store.saveAiGateway(payload);
    setNotice(res.ok ? 'saved' : 'failed');
  };

  const test = async (id: string): Promise<void> => {
    const r = await store.testAiUpstream(id);
    setTested((prev) => ({ ...prev, [id]: r.ok ? 'ok' : 'fail' }));
  };

  const view = store.aiGateway;
  const sourceKey = view?.source === 'file' ? 'web.admin.aiGateway.source.file' : 'web.admin.aiGateway.source.env';

  return (
    <div className="ht-admin-section">
      <h2>{t('web.admin.aiGateway.title')}</h2>
      <p className="ht-ai__note">{t('web.admin.aiGateway.hint')}</p>
      {view !== null ? (
        <p className="ht-ai__note">
          {t('web.admin.aiGateway.source')}：{t(sourceKey)}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="ht-ai__note">{t('web.admin.aiGateway.empty')}</p>
      ) : (
        <table className="ht-admin-table">
          <thead>
            <tr>
              <th>{t('web.admin.aiGateway.id')}</th>
              <th>{t('web.admin.aiGateway.label')}</th>
              <th>{t('web.admin.aiGateway.baseUrl')}</th>
              <th>{t('web.admin.aiGateway.model')}</th>
              <th>{t('web.admin.aiGateway.apiKey')}</th>
              <th>{t('web.admin.aiGateway.priority')}</th>
              <th>{t('web.admin.aiGateway.weight')}</th>
              <th>{t('web.admin.aiGateway.enabled')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id === '' ? `new-${String(i)}` : r.id}>
                <td><input value={r.id} onChange={(e) => patch(i, { id: e.target.value })} /></td>
                <td><input value={r.label} onChange={(e) => patch(i, { label: e.target.value })} /></td>
                <td><input value={r.baseUrl} onChange={(e) => patch(i, { baseUrl: e.target.value })} /></td>
                <td><input value={r.modelId} onChange={(e) => patch(i, { modelId: e.target.value })} /></td>
                <td>
                  <input
                    value={r.apiKey}
                    type="password"
                    onChange={(e) => patch(i, { apiKey: e.target.value })}
                    placeholder={r.hasApiKey ? t('web.admin.aiGateway.apiKeyHint') : ''}
                  />
                </td>
                <td><input value={r.priority} onChange={(e) => patch(i, { priority: e.target.value })} /></td>
                <td><input value={r.weight} onChange={(e) => patch(i, { weight: e.target.value })} /></td>
                <td><input type="checkbox" checked={r.enabled} onChange={(e) => patch(i, { enabled: e.target.checked })} /></td>
                <td>
                  <button type="button" onClick={() => void test(r.id)} disabled={r.id === ''}>
                    {t('web.admin.aiGateway.test')}
                  </button>
                  {tested[r.id] === 'ok' ? <span> ✓</span> : tested[r.id] === 'fail' ? <span> ✗</span> : null}
                  <button type="button" onClick={() => removeRow(i)}>
                    {t('web.admin.aiGateway.remove')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="ht-admin-actions">
        <button type="button" onClick={addRow}>{t('web.admin.aiGateway.add')}</button>
        <button type="button" onClick={() => void save()}>{t('web.admin.aiGateway.save')}</button>
        {notice === 'saved' ? <span>{t('web.admin.aiGateway.saved')}</span> : null}
      </div>
    </div>
  );
}
