/**
 * 作息表节次编辑器（设备本地，Modal）。
 *
 * 只编辑"第N节 起-止"这层外观配置，不碰任何课程/任务数据。每行一个 `HH:mm-HH:mm`，
 * 保存时解析校验；非法行丢弃（不乱写）。文案全部复用既有词条，不新增说明文字。
 */

import React, { useState } from 'react';
import { Modal, View } from 'react-native';

import { useI18n } from '@heyta/i18n';

import { Button, Text, TextField } from '../ui/kit';
import { useTokens } from '../theme';
import type { Period } from '../prefs/timetable-periods';

const HM = /^([01]?\d|2[0-3]):[0-5]\d$/;

export function TimetablePeriodsEditor({
  periods,
  onSave,
  onClose,
}: {
  readonly periods: readonly Period[];
  readonly onSave: (periods: Period[]) => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const tk = useTokens();
  const [rows, setRows] = useState<string[]>(() => periods.map((p) => `${p.start}-${p.end}`));

  const parseRows = (): Period[] => {
    const out: Period[] = [];
    for (const row of rows) {
      const m = /^\s*([0-2]?\d:[0-5]\d)\s*[-~]\s*([0-2]?\d:[0-5]\d)\s*$/.exec(row);
      if (m && HM.test(m[1]!) && HM.test(m[2]!)) out.push({ start: m[1]!, end: m[2]! });
    }
    return out;
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center' }}>
        <View
          style={{
            marginHorizontal: tk['space.4'],
            padding: tk['space.4'],
            borderRadius: tk['radius.md'],
            backgroundColor: tk['color.surface'],
            maxHeight: '80%',
          }}
        >
          <View style={{ flexDirection: 'row', gap: tk['space.2'], marginBottom: tk['space.2'] }}>
            <Button label={t('mobile.common.add')} onPress={() => setRows((r) => [...r, ''])} />
          </View>
          <View style={{ gap: tk['space.2'] }}>
            {rows.map((row, i) => (
              <TextField
                key={`p-${i}`}
                label={`${i + 1}`}
                value={row}
                placeholder="08:00-08:45"
                onChangeText={(next) => setRows((r) => r.map((v, idx) => (idx === i ? next : v)))}
              />
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: tk['space.2'], marginTop: tk['space.4'] }}>
            <Button label={t('mobile.common.cancel')} onPress={onClose} />
            <Button label={t('web.passkeys.save')} tone="primary" onPress={() => onSave(parseRows())} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
