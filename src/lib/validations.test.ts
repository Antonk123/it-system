import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ticketInsertSchema,
  ticketUpdateSchema,
  contactSchema,
  contactUpdateSchema,
  companySchema,
  categorySchema,
  checklistItemSchema,
  templateSchema,
  templateUpdateSchema,
  fileUploadSchema,
  getValidationError,
} from './validations';

// ---------------------------------------------------------------------------
// ticketInsertSchema
// ---------------------------------------------------------------------------
describe('ticketInsertSchema', () => {
  const validTicket = {
    title: 'Nätverket är nere',
    status: 'open' as const,
    priority: 'high' as const,
  };

  it('godkänner minimalt giltigt ärende', () => {
    expect(() => ticketInsertSchema.parse(validTicket)).not.toThrow();
  });

  it('godkänner fullt utfyllt ärende', () => {
    const full = {
      ...validTicket,
      description: 'Detaljerad beskrivning',
      notes: 'Interna anteckningar',
      solution: 'Lösning beskrivs här',
      category: '550e8400-e29b-41d4-a716-446655440000',
      requesterId: 'usr-123',
    };
    expect(() => ticketInsertSchema.parse(full)).not.toThrow();
  });

  it('kräver att title inte är tom', () => {
    expect(() => ticketInsertSchema.parse({ ...validTicket, title: '' })).toThrow();
  });

  it('kräver att title inte är enbart blanksteg', () => {
    expect(() => ticketInsertSchema.parse({ ...validTicket, title: '   ' })).toThrow();
  });

  it('avvisar title längre än 200 tecken', () => {
    const long = 'a'.repeat(201);
    expect(() => ticketInsertSchema.parse({ ...validTicket, title: long })).toThrow();
  });

  it('accepterar title på exakt 200 tecken', () => {
    expect(() => ticketInsertSchema.parse({ ...validTicket, title: 'a'.repeat(200) })).not.toThrow();
  });

  it('avvisar ogiltigt status-värde', () => {
    expect(() => ticketInsertSchema.parse({ ...validTicket, status: 'unknown' })).toThrow();
  });

  it('accepterar alla giltiga status-värden', () => {
    const statuses = ['open', 'in-progress', 'waiting', 'resolved', 'closed'] as const;
    for (const status of statuses) {
      expect(() => ticketInsertSchema.parse({ ...validTicket, status })).not.toThrow();
    }
  });

  it('avvisar ogiltigt priority-värde', () => {
    expect(() => ticketInsertSchema.parse({ ...validTicket, priority: 'urgent' })).toThrow();
  });

  it('accepterar alla giltiga priority-värden', () => {
    const priorities = ['low', 'medium', 'high', 'critical'] as const;
    for (const priority of priorities) {
      expect(() => ticketInsertSchema.parse({ ...validTicket, priority })).not.toThrow();
    }
  });

  it('avvisar description längre än 5000 tecken', () => {
    expect(() =>
      ticketInsertSchema.parse({ ...validTicket, description: 'x'.repeat(5001) })
    ).toThrow();
  });

  it('avvisar category som inte är ett UUID', () => {
    expect(() => ticketInsertSchema.parse({ ...validTicket, category: 'not-a-uuid' })).toThrow();
  });

  it('trimmar title vid parsning', () => {
    const result = ticketInsertSchema.parse({ ...validTicket, title: '  Hej  ' });
    expect(result.title).toBe('Hej');
  });
});

// ---------------------------------------------------------------------------
// ticketUpdateSchema (partial)
// ---------------------------------------------------------------------------
describe('ticketUpdateSchema', () => {
  it('godkänner tomt objekt (alla fält valfria)', () => {
    expect(() => ticketUpdateSchema.parse({})).not.toThrow();
  });

  it('godkänner partiell uppdatering med bara status', () => {
    expect(() => ticketUpdateSchema.parse({ status: 'resolved' })).not.toThrow();
  });

  it('avvisar ogiltigt status även vid partiell uppdatering', () => {
    expect(() => ticketUpdateSchema.parse({ status: 'invalid' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// contactSchema
// ---------------------------------------------------------------------------
describe('contactSchema', () => {
  const validContact = { name: 'Anna Svensson', email: 'anna@example.com' };

  it('godkänner giltig kontakt', () => {
    expect(() => contactSchema.parse(validContact)).not.toThrow();
  });

  it('kräver att name inte är tom', () => {
    expect(() => contactSchema.parse({ ...validContact, name: '' })).toThrow();
  });

  it('avvisar name längre än 100 tecken', () => {
    expect(() => contactSchema.parse({ ...validContact, name: 'a'.repeat(101) })).toThrow();
  });

  it('avvisar ogiltig e-post', () => {
    expect(() => contactSchema.parse({ ...validContact, email: 'inte-en-epost' })).toThrow();
  });

  it('avvisar e-post längre än 255 tecken', () => {
    // max 255 — så 256 tecken ska avvisas
    const long = 'a'.repeat(251) + '@x.se';
    expect(long.length).toBe(256);
    expect(() => contactSchema.parse({ ...validContact, email: long })).toThrow();
  });

  it('avvisar department längre än 100 tecken', () => {
    expect(() =>
      contactSchema.parse({ ...validContact, department: 'd'.repeat(101) })
    ).toThrow();
  });

  it('godkänner kontakt utan department (valfritt fält)', () => {
    expect(() => contactSchema.parse(validContact)).not.toThrow();
  });

  it('trimmar namn vid parsning', () => {
    const result = contactSchema.parse({ ...validContact, name: '  Bo  ' });
    expect(result.name).toBe('Bo');
  });
});

// ---------------------------------------------------------------------------
// contactUpdateSchema (partial)
// ---------------------------------------------------------------------------
describe('contactUpdateSchema', () => {
  it('godkänner tomt objekt', () => {
    expect(() => contactUpdateSchema.parse({})).not.toThrow();
  });

  it('avvisar ogiltig e-post även vid partiell uppdatering', () => {
    expect(() => contactUpdateSchema.parse({ email: 'XXXXXX' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// companySchema
// ---------------------------------------------------------------------------
describe('companySchema', () => {
  const validCompany = { name: 'Prefabmästarna AB' };

  it('godkänner minimalt giltigt företag', () => {
    expect(() => companySchema.parse(validCompany)).not.toThrow();
  });

  it('kräver att name inte är tom', () => {
    expect(() => companySchema.parse({ ...validCompany, name: '' })).toThrow();
  });

  it('avvisar name längre än 200 tecken', () => {
    expect(() => companySchema.parse({ ...validCompany, name: 'n'.repeat(201) })).toThrow();
  });

  it('godkänner tom sträng som email (allowlisted via .or(z.literal("")))', () => {
    expect(() => companySchema.parse({ ...validCompany, email: '' })).not.toThrow();
  });

  it('avvisar ogiltig e-post som inte är tom sträng', () => {
    expect(() => companySchema.parse({ ...validCompany, email: 'ej-epost' })).toThrow();
  });

  it('godkänner giltig e-post för företag', () => {
    expect(() =>
      companySchema.parse({ ...validCompany, email: 'info@prefabmastarna.se' })
    ).not.toThrow();
  });

  it('godkänner null-värden för nullable fält', () => {
    expect(() =>
      companySchema.parse({
        ...validCompany,
        org_number: null,
        email: null,
        phone: null,
        address: null,
      })
    ).not.toThrow();
  });

  it('avvisar address längre än 500 tecken', () => {
    expect(() =>
      companySchema.parse({ ...validCompany, address: 'x'.repeat(501) })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// categorySchema
// ---------------------------------------------------------------------------
describe('categorySchema', () => {
  it('godkänner giltig kategori', () => {
    expect(() => categorySchema.parse({ label: 'Nätverk' })).not.toThrow();
  });

  it('kräver att label inte är tom', () => {
    expect(() => categorySchema.parse({ label: '' })).toThrow();
  });

  it('kräver att label inte är enbart blanksteg', () => {
    expect(() => categorySchema.parse({ label: '   ' })).toThrow();
  });

  it('avvisar label längre än 50 tecken', () => {
    expect(() => categorySchema.parse({ label: 'k'.repeat(51) })).toThrow();
  });

  it('accepterar label på exakt 50 tecken', () => {
    expect(() => categorySchema.parse({ label: 'k'.repeat(50) })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// checklistItemSchema
// ---------------------------------------------------------------------------
describe('checklistItemSchema', () => {
  it('godkänner giltig checklistpunkt', () => {
    expect(() => checklistItemSchema.parse({ label: 'Kontrollera router' })).not.toThrow();
  });

  it('kräver att label inte är tom', () => {
    expect(() => checklistItemSchema.parse({ label: '' })).toThrow();
  });

  it('avvisar label längre än 200 tecken', () => {
    expect(() => checklistItemSchema.parse({ label: 'c'.repeat(201) })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// templateSchema
// ---------------------------------------------------------------------------
describe('templateSchema', () => {
  const validStandard = {
    name: 'Mall för driftstopp',
    titleTemplate: 'Driftstopp: {system}',
    type: 'standard' as const,
    descriptionTemplate: 'Beskriv problemet här.',
  };

  const validDynamic = {
    name: 'Dynamisk mall',
    titleTemplate: 'Ärende: {typ}',
    type: 'dynamic' as const,
  };

  it('godkänner giltig standard-mall med descriptionTemplate', () => {
    expect(() => templateSchema.parse(validStandard)).not.toThrow();
  });

  it('kräver descriptionTemplate för standard-mallar', () => {
    expect(() =>
      templateSchema.parse({ ...validStandard, descriptionTemplate: '' })
    ).toThrow();
  });

  it('kräver descriptionTemplate för standard-mallar (undefined)', () => {
    const { descriptionTemplate: _dt, ...rest } = validStandard;
    expect(() => templateSchema.parse(rest)).toThrow();
  });

  it('godkänner dynamic-mall utan descriptionTemplate', () => {
    expect(() => templateSchema.parse(validDynamic)).not.toThrow();
  });

  it('kräver att name inte är tom', () => {
    expect(() => templateSchema.parse({ ...validStandard, name: '' })).toThrow();
  });

  it('avvisar name längre än 100 tecken', () => {
    expect(() =>
      templateSchema.parse({ ...validStandard, name: 'n'.repeat(101) })
    ).toThrow();
  });

  it('avvisar titleTemplate längre än 200 tecken', () => {
    expect(() =>
      templateSchema.parse({ ...validStandard, titleTemplate: 't'.repeat(201) })
    ).toThrow();
  });

  it('avvisar ogiltigt type-värde', () => {
    expect(() =>
      templateSchema.parse({ ...validStandard, type: 'invalid' })
    ).toThrow();
  });

  it('godkänner giltig category som UUID', () => {
    expect(() =>
      templateSchema.parse({ ...validStandard, category: '550e8400-e29b-41d4-a716-446655440000' })
    ).not.toThrow();
  });

  it('avvisar category som inte är UUID', () => {
    expect(() =>
      templateSchema.parse({ ...validStandard, category: 'inte-uuid' })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// templateUpdateSchema (partial)
// ---------------------------------------------------------------------------
describe('templateUpdateSchema', () => {
  it('godkänner tomt objekt', () => {
    expect(() => templateUpdateSchema.parse({})).not.toThrow();
  });

  it('avvisar ogiltigt priority-värde', () => {
    expect(() => templateUpdateSchema.parse({ priority: 'emergency' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// fileUploadSchema
// ---------------------------------------------------------------------------
describe('fileUploadSchema', () => {
  const makeFile = (name: string, type: string, sizeBytes = 100) =>
    new File([new ArrayBuffer(sizeBytes)], name, { type });

  it('godkänner JPEG-bild', () => {
    const f = makeFile('foto.jpg', 'image/jpeg');
    expect(() => fileUploadSchema.parse({ file: f })).not.toThrow();
  });

  it('godkänner PNG-bild', () => {
    expect(() => fileUploadSchema.parse({ file: makeFile('bild.png', 'image/png') })).not.toThrow();
  });

  it('godkänner PDF-fil', () => {
    expect(() => fileUploadSchema.parse({ file: makeFile('dok.pdf', 'application/pdf') })).not.toThrow();
  });

  it('godkänner .eml via filändelse (MIME kan saknas)', () => {
    expect(() => fileUploadSchema.parse({ file: makeFile('mail.eml', '') })).not.toThrow();
  });

  it('godkänner .msg via filändelse', () => {
    expect(() => fileUploadSchema.parse({ file: makeFile('outlook.msg', '') })).not.toThrow();
  });

  it('godkänner .csv via filändelse', () => {
    expect(() => fileUploadSchema.parse({ file: makeFile('data.csv', '') })).not.toThrow();
  });

  it('avvisar otillåten filtyp utan känd extension', () => {
    expect(() =>
      fileUploadSchema.parse({ file: makeFile('skript.sh', 'application/x-sh') })
    ).toThrow();
  });

  it('avvisar fil som är exakt 10 MB + 1 byte', () => {
    const tooBig = makeFile('stor.pdf', 'application/pdf', 10 * 1024 * 1024 + 1);
    expect(() => fileUploadSchema.parse({ file: tooBig })).toThrow();
  });

  it('godkänner fil på exakt 10 MB', () => {
    const exactly10mb = makeFile('grans.pdf', 'application/pdf', 10 * 1024 * 1024);
    expect(() => fileUploadSchema.parse({ file: exactly10mb })).not.toThrow();
  });

  it('avvisar när file saknas', () => {
    expect(() => fileUploadSchema.parse({ file: null })).toThrow();
  });

  it('avvisar .exe-fil', () => {
    expect(() =>
      fileUploadSchema.parse({ file: makeFile('virus.exe', 'application/octet-stream') })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// getValidationError
// ---------------------------------------------------------------------------
describe('getValidationError', () => {
  it('returnerar felmeddelande från ZodError', () => {
    let error: unknown;
    try {
      contactSchema.parse({ name: '', email: 'ogiltig' });
    } catch (e) {
      error = e;
    }
    const msg = getValidationError(error);
    expect(msg).not.toBeNull();
    expect(typeof msg).toBe('string');
    expect(msg!.length).toBeGreaterThan(0);
  });

  it('returnerar null för vanligt Error-objekt', () => {
    expect(getValidationError(new Error('fel'))).toBeNull();
  });

  it('returnerar null för null', () => {
    expect(getValidationError(null)).toBeNull();
  });

  it('returnerar null för sträng', () => {
    expect(getValidationError('ett fel')).toBeNull();
  });

  it('sammanfogar flera felmeddelanden med komma', () => {
    let error: unknown;
    try {
      ticketInsertSchema.parse({ title: '', status: 'bad', priority: 'bad' });
    } catch (e) {
      error = e;
    }
    const msg = getValidationError(error);
    expect(msg).not.toBeNull();
    // Flera fel separerade med ", "
    expect(msg).toContain(', ');
  });

  it('returnerar enstaka felmeddelande för ett fält', () => {
    let error: unknown;
    try {
      z.string().min(1).parse('');
    } catch (e) {
      error = e;
    }
    const msg = getValidationError(error);
    expect(typeof msg).toBe('string');
  });
});
