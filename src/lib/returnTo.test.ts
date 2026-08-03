import { describe, it, expect } from 'vitest';
import { sanitizeReturnTo } from './returnTo';

describe('sanitizeReturnTo', () => {
  it('släpper igenom en giltig intern path med query', () => {
    expect(sanitizeReturnTo('/tickets/abc?tab=2')).toBe('/tickets/abc?tab=2');
  });

  it('släpper igenom en enkel root-relativ path', () => {
    expect(sanitizeReturnTo('/kb')).toBe('/kb');
  });

  it('protocol-relative "//evil.com" → /', () => {
    expect(sanitizeReturnTo('//evil.com')).toBe('/');
  });

  it('absolut extern URL "https://evil.com" → /', () => {
    expect(sanitizeReturnTo('https://evil.com')).toBe('/');
  });

  it('backslash-variant "/\\evil.com" → /', () => {
    expect(sanitizeReturnTo('/\\evil.com')).toBe('/');
  });

  it('javascript:-URI → /', () => {
    expect(sanitizeReturnTo('javascript:alert(1)')).toBe('/');
  });

  it('tom sträng → /', () => {
    expect(sanitizeReturnTo('')).toBe('/');
  });

  it('null → /', () => {
    expect(sanitizeReturnTo(null)).toBe('/');
  });

  it('undefined → /', () => {
    expect(sanitizeReturnTo(undefined)).toBe('/');
  });

  it('objekt (icke-sträng) → /', () => {
    expect(sanitizeReturnTo({ from: '/tickets' })).toBe('/');
  });

  it('/login (self) → / (loop-skydd)', () => {
    expect(sanitizeReturnTo('/login')).toBe('/');
  });

  it('/login?returnTo=/x (nästlad param) → / (loop-skydd)', () => {
    expect(sanitizeReturnTo('/login?returnTo=/x')).toBe('/');
  });

  it('/login/ (sub-path) → / (loop-skydd)', () => {
    expect(sanitizeReturnTo('/login/foo')).toBe('/');
  });
});
