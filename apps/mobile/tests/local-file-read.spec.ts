import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

// Load the platform boundary with RN's actual missing-module shape (null).
// Vitest's ESM mocks do not intercept this module's native CommonJS require.
function load(rn: unknown) {
  const code = ts.transpileModule(readFileSync(new URL('../src/lib/local-file-read.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, (...args: any[]) => any> = {};
  class Xhr {
    response = { data: { blobId: 'backup', offset: 0, size: 12 } };
    onload?: () => void;
    open = vi.fn();
    send() { this.onload?.(); }
  }
  vm.runInNewContext(code, { exports, require: () => rn, XMLHttpRequest: Xhr });
  return exports;
}

describe('native file reading channel selection', () => {
  it('reads an iOS selected file through the blob reader when the native module is null', async () => {
    const readAsText = vi.fn().mockResolvedValue('{"tasks":[]}');
    const api = load({ NativeModules: { HeytaLocalFs: null }, TurboModuleRegistry: { get: () => ({ readAsText }) } });
    expect(api.nativeModule!()).toBeUndefined();
    await expect(api.readLocalTextUri!('file:///backup.json')).resolves.toBe('{"tasks":[]}');
    expect(readAsText).toHaveBeenCalledWith({ blobId: 'backup', offset: 0, size: 12 }, 'UTF-8');
  });
  it('reports an unavailable channel when both registries return null', async () => {
    const api = load({ NativeModules: { HeytaLocalFs: null }, TurboModuleRegistry: { get: () => null } });
    await expect(api.readLocalTextUri!('file:///backup.json')).rejects.toThrow('本机没有 FileReaderModule');
  });
  it('uses the registered Android reader and preserves a permission failure', async () => {
    const readTextUri = vi.fn().mockRejectedValue(new Error('READ_DENIED'));
    const api = load({ NativeModules: { HeytaLocalFs: { readTextUri } } });
    await expect(api.readLocalTextUri!('content://backup')).rejects.toThrow('READ_DENIED');
    expect(readTextUri).toHaveBeenCalledWith('content://backup');
  });
});
