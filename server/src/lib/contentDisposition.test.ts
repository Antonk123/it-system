import { describe, it, expect } from 'vitest';
import { attachmentDisposition } from './contentDisposition.js';

describe('attachmentDisposition', () => {
  it('emits an ASCII fallback and an RFC 5987 encoded name for åäö', () => {
    const header = attachmentDisposition('rapport åäö.pdf');
    expect(header).toBe(`attachment; filename="rapport ___.pdf"; filename*=UTF-8''rapport%20%C3%A5%C3%A4%C3%B6.pdf`);
  });

  it('neutralises quotes, semicolons, backslashes and CR/LF in the fallback', () => {
    const header = attachmentDisposition('a";b\\c\r\nSet-Cookie: x=1.txt');
    const fallback = header.match(/filename="([^"]*)"/)![1];
    expect(fallback).not.toMatch(/[";\r\n]/);
    expect(header).not.toMatch(/[\r\n]/);
  });

  it('percent-encodes the characters encodeURIComponent leaves alone', () => {
    expect(attachmentDisposition("it's (a) *file*.txt")).toContain("filename*=UTF-8''it%27s%20%28a%29%20%2Afile%2A.txt");
  });

  it('truncates to 200 code points without splitting a surrogate pair', () => {
    const name = `${'a'.repeat(199)}😀.txt`;
    const header = attachmentDisposition(name);
    expect(header).toContain(`filename*=UTF-8''${'a'.repeat(199)}%F0%9F%98%80`);
    expect(header).not.toContain('.txt');
  });
});
