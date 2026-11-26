/**
 * 教务系统「应用内浏览器」导入（WebView）
 * ======================================
 *
 * 用户在应用内浏览器里自己登录教务系统（密码不经过我们、不落库、不代过验证码），
 * 登录后点「识别」，把当前页面 DOM 交给 `parseCourseHTML` 解析成课程行，再走与
 * ICS/CSV 同一条导入管线（稳定去重、守恒律）。解析结果为空则如实提示，不瞎填。
 */

import React, { useMemo, useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import type { HabitActions } from '@heyta/app-host';
import { parseCourseHTML, planCourseImport } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';

import { Button, Text, TextField } from '../ui/kit';
import { useTokens } from '../theme';

export function WebTimetableImport({
  actions,
  onImported,
  onClose,
}: {
  readonly actions: HabitActions;
  readonly onImported: () => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const tk = useTokens();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webRef = useRef<any>(null);
  const [entry, setEntry] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  /** 识别结果（成功/为空）—— 就地一行，不弹系统框。 */
  const [notice, setNotice] = useState<string | null>(null);

  // 样式集中在 StyleSheet（L4 门禁：视图里不写内联样式字面量）。
  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, backgroundColor: tk['color.surface'], paddingTop: tk['space.6'] },
        header: {
          flexDirection: 'row',
          gap: tk['space.2'],
          paddingHorizontal: tk['space.3'],
          alignItems: 'flex-end',
        },
        headerText: { flex: 1 },
        notice: { paddingHorizontal: tk['space.3'], paddingTop: tk['space.2'] },
        web: { flex: 1, marginTop: tk['space.2'] },
      }),
    [tk],
  );

  const runIdentify = (): void => {
    if (busy) return;
    // 还没加载出页面时，先把输入框里的地址载入；加载出来后再点才会真正抓 DOM。
    if (url === '' && entry.trim() !== '') {
      setUrl(entry.trim());
      return;
    }
    webRef.current?.injectJavaScript(
      "(function(){try{window.ReactNativeWebView.postMessage(document.documentElement.outerHTML);}catch(e){window.ReactNativeWebView.postMessage('');}})();true;",
    );
  };

  const handleMessage = (data: string): void => {
    setBusy(true);
    void (async () => {
      try {
        const rows = parseCourseHTML(data);
        const plan = planCourseImport(rows);
        if (plan.rows.length === 0) {
          setNotice(t('mobile.habits.importEmpty'));
          return;
        }
        const res = await actions.importCourses(plan.rows);
        onImported();
        setNotice(
          plan.report.skipped > 0
            ? t('mobile.habits.importResultSkipped', { created: res.created.length, skipped: plan.report.skipped })
            : t('mobile.habits.importResult', { created: res.created.length }),
        );
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <Modal animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <TextField
              label={t('mobile.habits.webUrlLabel')}
              value={entry}
              placeholder={t('mobile.habits.webUrlPlaceholder')}
              autoCapitalize="none"
              keyboard="url"
              onChangeText={(v) => {
                setEntry(v);
                if (/^https?:\/\/\S+$/.test(v)) setUrl(v.trim());
              }}
            />
          </View>
          <Button label={t('mobile.habits.identify')} tone="primary" onPress={runIdentify} />
        </View>
        {notice === null ? null : (
          <View style={styles.notice}>
            <Text variant="caption" tone="subtle" testID="web-timetable-notice">
              {notice}
            </Text>
          </View>
        )}
        <View style={styles.web}>
          {url !== '' ? (
            <WebView
              ref={webRef}
              source={{ uri: url }}
              onMessage={(e: { nativeEvent: { data: string } }) => handleMessage(e.nativeEvent.data)}
              setJavaScriptEnabled
              originWhitelist={['*']}
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
