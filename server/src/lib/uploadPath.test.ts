import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { resolveUploadPath } from './uploadPath.js';

describe('resolveUploadPath', () => {
  const dir = join('/srv', 'uploads');

  it('resolves a plain stored name inside the upload dir', () => {
    expect(resolveUploadPath(dir, 'abc.pdf')).toBe(join(dir, 'abc.pdf'));
  });

  it('rejects traversal and absolute paths', () => {
    expect(resolveUploadPath(dir, '../secret.txt')).toBeNull();
    expect(resolveUploadPath(dir, 'sub/../../secret.txt')).toBeNull();
    expect(resolveUploadPath(dir, '/etc/passwd')).toBeNull();
  });

  it('rejects the directory itself and a sibling sharing the prefix', () => {
    expect(resolveUploadPath(dir, '.')).toBeNull();
    expect(resolveUploadPath(dir, '../uploads-evil/x')).toBeNull();
  });
});
