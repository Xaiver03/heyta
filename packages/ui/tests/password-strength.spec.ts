import { describe, expect, it } from 'vitest';

import {
  passwordCodePointLength,
  passwordStrengthLevel,
} from '../src/auth/password-strength-model.js';

describe('password strength feedback', () => {
  it('counts Unicode code points instead of UTF-16 units', () => {
    expect(passwordCodePointLength('😀😀😀')).toBe(3);
    expect(passwordCodePointLength('你好')).toBe(2);
  });

  it('reports a password below the shared minimum as too short', () => {
    expect(passwordStrengthLevel('😀'.repeat(7), 8)).toBe('too-short');
  });

  it('is advisory and recognises a long passphrase as strong', () => {
    expect(passwordStrengthLevel('correct horse battery staple', 8)).toBe('strong');
  });

  it('does not classify an empty field as weak', () => {
    expect(passwordStrengthLevel('')).toBeUndefined();
  });
});
