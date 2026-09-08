// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { requiredTemplateFieldErrors } from './templateValidation';
const field = (field_type: string, required = 1) => ({ field_name: 'answer', field_label: 'Svar', field_type, required });
const value = (fieldValue: string) => [{ fieldName: 'answer', fieldLabel: 'Svar', fieldValue }];
describe('Obligatoriska mallfält', () => {
  it.each(['', '  ', '<p></p>', '<p><br></p>', '<p>&nbsp; &#160;</p>'])('avvisar tom rich text %s', input => {
    expect(requiredTemplateFieldErrors([field('textarea')], value(input))).toEqual({ answer: 'Svar krävs' });
  });
  it('accepterar faktiskt textinnehåll, noll och ett uttryckligt Nej', () => {
    expect(requiredTemplateFieldErrors([field('textarea')], value('<p>Åtkomst behövs</p>'))).toEqual({});
    expect(requiredTemplateFieldErrors([field('number')], value('0'))).toEqual({});
    expect(requiredTemplateFieldErrors([field('checkbox')], value('Nej'))).toEqual({});
  });
  it('kräver saknade obligatoriska fält men lämnar frivilliga fält tomma', () => {
    expect(requiredTemplateFieldErrors([field('text')], [])).toEqual({ answer: 'Svar krävs' });
    expect(requiredTemplateFieldErrors([field('text', 0)], [])).toEqual({});
  });
});
