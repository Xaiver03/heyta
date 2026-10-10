import React, { useMemo } from 'react';
import { StyleSheet, Text as NativeText, View } from 'react-native';
import {
  AUTH_PASSWORD_MAX_CODE_POINTS,
  AUTH_PASSWORD_MIN_CODE_POINTS,
} from '@heyta/shared-schema';

import { useHeytaText, useHeytaTokens } from '../theme.js';
import {
  passwordCodePointLength,
  passwordStrengthLevel,
} from './password-strength-model.js';

export { passwordCodePointLength, passwordStrengthLevel } from './password-strength-model.js';
export type { PasswordStrengthLevel } from './password-strength-model.js';

/**
 * A local password estimate. It is deliberately presentation-only: it never
 * decides whether a password may be submitted and it never sends the password
 * anywhere. The server remains the authority for length, common-password and
 * breach policy.
 */
export interface PasswordStrengthLabels {
  readonly tooShort: (current: number, minimum: number) => string;
  readonly tooLong: (current: number, maximum: number) => string;
  readonly weak: string;
  readonly fair: string;
  readonly strong: string;
}

export interface PasswordStrengthProps {
  readonly password: string;
  readonly labels: PasswordStrengthLabels;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly testID?: string;
}

export function PasswordStrength({
  password,
  labels,
  minimum = AUTH_PASSWORD_MIN_CODE_POINTS,
  maximum = AUTH_PASSWORD_MAX_CODE_POINTS,
  testID = 'password-strength',
}: PasswordStrengthProps): React.JSX.Element | null {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const level = passwordStrengthLevel(password, minimum);

  if (level === undefined) return null;

  const length = passwordCodePointLength(password);
  const tooLong = length > maximum;
  const label =
    tooLong
      ? labels.tooLong(length, maximum)
      : level === 'too-short'
      ? labels.tooShort(length, minimum)
      : level === 'weak'
        ? labels.weak
        : level === 'fair'
          ? labels.fair
          : labels.strong;
  const filled = tooLong || level === 'too-short' || level === 'weak' ? 1 : level === 'fair' ? 2 : 4;
  const tone = tooLong ? 'danger' : level === 'strong' ? 'success' : level === 'fair' ? 'warning' : 'danger';
  const toneColor =
    tone === 'success'
      ? tokens['color.success-strong']
      : tone === 'warning'
        ? tokens['color.warning-strong']
        : tokens['color.danger'];

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      testID={testID}
      style={styles.root}
    >
      <View style={styles.meter} aria-hidden={true}>
        {Array.from({ length: 4 }, (_, index) => (
          <View
            key={index}
            style={[styles.segment, index < filled ? { backgroundColor: toneColor } : null]}
          />
        ))}
      </View>
      <NativeText
        style={[
          text['caption'],
          tone === 'success'
            ? { color: tokens['color.success-strong'] }
            : tone === 'warning'
              ? { color: tokens['color.warning-strong'] }
              : { color: tokens['color.danger'] },
        ]}
      >
        {label}
      </NativeText>
      {tooLong ? (
        <NativeText style={[text['caption'], { color: tokens['color.foreground-muted'] }]}>
          {length} / {maximum}
        </NativeText>
      ) : null}
    </View>
  );
}

function makeStyles(tokens: ReturnType<typeof useHeytaTokens>) {
  return StyleSheet.create({
    root: {
      gap: tokens['space.1'],
    },
    meter: {
      flexDirection: 'row',
      gap: tokens['space.1'],
      width: '100%',
    },
    segment: {
      flex: 1,
      height: tokens['border-width.thick'],
      borderRadius: tokens['radius.full'],
      backgroundColor: tokens['color.surface-sunken'],
    },
  });
}
