import { describe, it, expect } from 'vitest';
import { buildReplyHeaders, generateMessageId } from './emailThreading.js';

describe('buildReplyHeaders', () => {
  it('sets In-Reply-To and References to the thread anchor when present', () => {
    const headers = buildReplyHeaders({
      anchorMessageId: '<orig-123@customer.example>',
      generatedMessageId: '<reply-abc@itticket.local>',
    });
    expect(headers).toEqual({
      messageId: '<reply-abc@itticket.local>',
      inReplyTo: '<orig-123@customer.example>',
      references: '<orig-123@customer.example>',
    });
  });

  it('omits In-Reply-To/References when there is no thread anchor (web-origin first reply)', () => {
    const headers = buildReplyHeaders({
      anchorMessageId: null,
      generatedMessageId: '<reply-xyz@itticket.local>',
    });
    expect(headers).toEqual({ messageId: '<reply-xyz@itticket.local>' });
    expect(headers.inReplyTo).toBeUndefined();
    expect(headers.references).toBeUndefined();
  });
});

describe('generateMessageId', () => {
  it('produces an RFC 5322 angle-addr with the given domain', () => {
    const id = generateMessageId('mail.example.com');
    expect(id).toMatch(/^<reply-[0-9a-f-]{36}@mail\.example\.com>$/);
  });

  it('falls back to a default domain when none is given', () => {
    const id = generateMessageId();
    expect(id).toMatch(/^<reply-[0-9a-f-]{36}@itticket\.local>$/);
  });

  it('is unique across calls', () => {
    expect(generateMessageId('x.test')).not.toBe(generateMessageId('x.test'));
  });
});
