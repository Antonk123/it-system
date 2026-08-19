import { describe, it, expect } from 'vitest';
import { stripQuotedReply } from './emailQuote.js';

describe('stripQuotedReply', () => {
  it('cuts the Outlook Swedish header block (the reported case)', () => {
    const body = [
      'Ja, jag har kollat med min chef. Vi har slut på licenser..',
      '',
      'Från: Prefabmästarna Sverige AB noreply@prefabmastarna.se',
      'Datum: onsdag, 19 augusti 2026 08:36',
      'Till: Anton Kaarle anton.kaarle@prefabmastarna.se',
      'Ämne: [#4D684770] Beställning av licens - Bluebeam Revu',
      '',
      'Svar från supporten',
      '#4D684770',
      '',
      'Hej Anton Kaarle,',
      '',
      'Är detta godkänt? Kolla om blabla godkänner inköp först',
    ].join('\n');

    expect(stripQuotedReply(body)).toBe('Ja, jag har kollat med min chef. Vi har slut på licenser..');
  });

  it('cuts an English Outlook header block', () => {
    const body = 'Sounds good, go ahead.\n\nFrom: Support <help@example.com>\nSent: Wednesday, 19 August 2026 08:36\nTo: Jane Doe\nSubject: [#ABCD1234] Licence\n\nQuoted body';
    expect(stripQuotedReply(body)).toBe('Sounds good, go ahead.');
  });

  it('cuts at -----Ursprungligt meddelande-----', () => {
    const body = 'Nej, avvakta.\n\n-----Ursprungligt meddelande-----\nFrån: Support\nGammal text';
    expect(stripQuotedReply(body)).toBe('Nej, avvakta.');
  });

  it('cuts at "Den ... skrev:"', () => {
    const body = 'Tack!\n\nDen tis 19 aug. 2026 kl 08:36 skrev Support <help@example.com>:\n> gammalt';
    expect(stripQuotedReply(body)).toBe('Tack!');
  });

  it('cuts at "On ... wrote:"', () => {
    const body = 'Thanks!\n\nOn Tue, Aug 19, 2026 at 8:36 AM Support <help@example.com> wrote:\nold text';
    expect(stripQuotedReply(body)).toBe('Thanks!');
  });

  it('cuts at the first >-quoted line (html-to-text blockquote rendering)', () => {
    const body = 'Här är svaret.\n\n> Är detta godkänt?\n> Kolla först.';
    expect(stripQuotedReply(body)).toBe('Här är svaret.');
  });

  it('cuts at the Outlook underscore separator', () => {
    const body = 'Kör på.\n\n________________________________\nFrån: Support';
    expect(stripQuotedReply(body)).toBe('Kör på.');
  });

  it('cuts at our own template heading when the client omits the header block', () => {
    const body = 'Ja tack.\n\nSvar från supporten\n#4D684770\nHej Anton,';
    expect(stripQuotedReply(body)).toBe('Ja tack.');
  });

  it('does NOT cut a sentence that merely starts with "From:" without following headers', () => {
    const body = 'From: the CEO down, everyone needs a licence.\n\nCan you order five?';
    expect(stripQuotedReply(body)).toBe(body);
  });

  it('does NOT cut a dateless sentence like "On Monday I wrote the following:"', () => {
    const body = 'Hi there.\n\nOn Monday I wrote the following:\n\nPlease order two licences.';
    expect(stripQuotedReply(body)).toBe(body);
  });

  it('leaves a message without any quote untouched', () => {
    const body = 'Hej!\n\nVi har slut på licenser. Kan du beställa två till?\n\n/Anton';
    expect(stripQuotedReply(body)).toBe(body);
  });

  it('keeps the original when the quote starts on line 0 (bottom-posted reply)', () => {
    const body = '> Är detta godkänt?\n\nJa, det är godkänt.';
    expect(stripQuotedReply(body)).toBe(body);
  });

  it('drops a trailing separator line so it does not become the whole comment', () => {
    const body = 'Ja tack.\n\n----------------------------------------\n\nFrån: Support\nSkickat: torsdag\nGammal text';
    expect(stripQuotedReply(body)).toBe('Ja tack.');
  });

  it('keeps the original when the reply is nothing but a separator and the quote', () => {
    // Verkligt fall ur prod: kunden svarade utan att skriva något. Hellre hela
    // citatet än en kommentar som bara innehåller "----------".
    const body = '----------------------------------------\n\nFrån: Support\nSkickat: torsdag\nGammal text';
    expect(stripQuotedReply(body)).toBe(body);
  });

  it('keeps the original when everything above the quote is whitespace', () => {
    const body = '   \n\n> Är detta godkänt?\nJa.';
    expect(stripQuotedReply(body)).toBe(body);
  });

  it('handles CRLF line endings', () => {
    const body = 'Ja, kör på.\r\n\r\nFrån: Support\r\nDatum: onsdag\r\nGammal text';
    expect(stripQuotedReply(body)).toBe('Ja, kör på.');
  });

  it('returns empty input unchanged', () => {
    expect(stripQuotedReply('')).toBe('');
  });
});
