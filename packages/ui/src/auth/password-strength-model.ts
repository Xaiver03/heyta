import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as zxcvbnCommon from '@zxcvbn-ts/language-common';
import {
  AUTH_PASSWORD_MAX_CODE_POINTS,
  AUTH_PASSWORD_MIN_CODE_POINTS,
} from '@heyta/shared-schema';

/** The visual level is advisory; server policy remains the submit authority. */
export type PasswordStrengthLevel = 'too-short' | 'weak' | 'fair' | 'strong';

const estimator = new ZxcvbnFactory({
  dictionary: zxcvbnCommon.dictionary,
  graphs: zxcvbnCommon.adjacencyGraphs,
  maxLength: AUTH_PASSWORD_MAX_CODE_POINTS,
});

/** Count code points so emoji and CJK are measured as users perceive them. */
export const passwordCodePointLength = (password: string): number => Array.from(password).length;

export function passwordStrengthLevel(
  password: string,
  minimum = AUTH_PASSWORD_MIN_CODE_POINTS,
): PasswordStrengthLevel | undefined {
  if (password === '') return undefined;
  const length = passwordCodePointLength(password);
  if (length < minimum) return 'too-short';
  const score = estimator.check(password).score;
  if (score <= 1) return 'weak';
  if (score === 2) return 'fair';
  return 'strong';
}
