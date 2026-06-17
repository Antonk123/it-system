import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

// ─────────────────────────────────────────────────────────────────────────────
// Regression test for the @anthropic-ai/sdk bump (0.32 → 0.104).
//
// aiHelper.ts relies on exactly two pieces of the SDK response shape:
//   1. msg.content[0]  is a content block; for text it has { type: 'text', text }
//   2. msg.usage?.input_tokens / .output_tokens
//
// This test mocks the Anthropic SDK client so no network/API key is needed, and
// asserts those two contracts hold by driving suggestCategory() — the smallest
// function that does a full create() → parse → logUsage round-trip. It guards
// against a future SDK bump silently changing the content-block or usage shape.
//
// It also covers the pure exported helper buildKbSearchQuery() as a fast,
// dependency-free unit check.
// ─────────────────────────────────────────────────────────────────────────────

// The module builds its Anthropic client at import time, gated on this env var
// (const client = apiKey ? new Anthropic({ apiKey }) : null). vi.hoisted runs
// before the (hoisted) module imports below, so the key is in place when
// aiHelper.ts executes its top-level client construction → aiEnabled() === true.
const { createMock } = vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  // Captures the messages.create() call so we can assert it was invoked.
  return { createMock: vi.fn() };
});

// Mock the SDK: default export is the Anthropic class; instances expose
// messages.create(). vi.mock is hoisted above the imports below.
vi.mock('@anthropic-ai/sdk', () => {
  class FakeAnthropic {
    messages = { create: createMock };
    constructor(_opts: { apiKey?: string }) {
      // accept and ignore opts, like the real constructor
    }
  }
  return { default: FakeAnthropic };
});

// In-memory DB so logUsage() / category-existence checks don't touch real state.
let memDb: InstanceType<typeof Database>;

vi.mock('../db/connection.js', () => {
  const proxy = {
    prepare: (...args: Parameters<InstanceType<typeof Database>['prepare']>) =>
      memDb.prepare(...args),
    pragma: vi.fn(),
    exec: vi.fn(),
  };
  return { db: proxy };
});

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { suggestCategory, aiEnabled, buildKbSearchQuery } from './aiHelper.js';

// ─────────────────────────────────────────────────────────────────────────────

function createSchema(db: InstanceType<typeof Database>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      label TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_usage_log (
      id TEXT PRIMARY KEY,
      feature TEXT,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      ticket_id TEXT,
      duration_ms INTEGER,
      ok INTEGER,
      created_at TEXT
    )
  `);
}

/** Build a response object in the shape the real SDK returns for a text reply. */
function makeResponse(text: string, inputTokens: number, outputTokens: number) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

beforeEach(() => {
  memDb = new Database(':memory:');
  createSchema(memDb);
  createMock.mockReset();
});

afterEach(() => {
  memDb.close();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('aiHelper — SDK client gating', () => {
  it('aiEnabled() is true when ANTHROPIC_API_KEY is set at import time', () => {
    expect(aiEnabled()).toBe(true);
  });
});

describe('aiHelper — response parsing contract (SDK bump guard)', () => {
  it('extracts content[0].text and reads usage.input_tokens/output_tokens', async () => {
    memDb.prepare('INSERT INTO categories (id, label) VALUES (?, ?)').run('cat-1', 'Hårdvara');
    memDb.prepare('INSERT INTO categories (id, label) VALUES (?, ?)').run('cat-2', 'Mjukvara');

    // LLM returns JSON wrapped in surrounding text — exercises extractJson + content[0].text.
    createMock.mockResolvedValue(
      makeResponse('Här är svaret: {"categoryId": "cat-1", "confidence": 0.92}', 210, 18)
    );

    const result = await suggestCategory(
      'Datorn startar inte',
      'Min laptop ger ingen bild vid uppstart',
      [
        { id: 'cat-1', label: 'Hårdvara' },
        { id: 'cat-2', label: 'Mjukvara' },
      ],
      'ticket-42'
    );

    // content[0].text was parsed into a usable suggestion
    expect(result).not.toBeNull();
    expect(result!.categoryId).toBe('cat-1');
    expect(result!.confidence).toBeCloseTo(0.92);

    // usage.input_tokens / output_tokens were read and persisted to ai_usage_log
    const logRow = memDb
      .prepare('SELECT input_tokens, output_tokens, feature, ticket_id, ok FROM ai_usage_log')
      .get() as {
      input_tokens: number;
      output_tokens: number;
      feature: string;
      ticket_id: string;
      ok: number;
    };
    expect(logRow.input_tokens).toBe(210);
    expect(logRow.output_tokens).toBe(18);
    expect(logRow.feature).toBe('categorize');
    expect(logRow.ticket_id).toBe('ticket-42');
    expect(logRow.ok).toBe(1);

    // The client was actually invoked through messages.create()
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('returns null when the text block holds no parseable JSON', async () => {
    memDb.prepare('INSERT INTO categories (id, label) VALUES (?, ?)').run('cat-1', 'Hårdvara');
    createMock.mockResolvedValue(makeResponse('Jag vet inte vilken kategori.', 200, 9));

    const result = await suggestCategory('Vag fråga', 'Ingen tydlig beskrivning', [
      { id: 'cat-1', label: 'Hårdvara' },
    ]);

    expect(result).toBeNull();
    // usage is still read off the response shape even on the no-parse path
    const logRow = memDb
      .prepare('SELECT input_tokens, output_tokens, ok FROM ai_usage_log')
      .get() as { input_tokens: number; output_tokens: number; ok: number };
    expect(logRow.input_tokens).toBe(200);
    expect(logRow.output_tokens).toBe(9);
    expect(logRow.ok).toBe(0);
  });
});

describe('aiHelper — buildKbSearchQuery (pure helper)', () => {
  it('strips punctuation, drops short words, OR-joins prefix terms', () => {
    expect(buildKbSearchQuery('skrivaren fungerar inte!')).toBe(
      'skrivaren* OR fungerar* OR inte*'
    );
  });

  it('caps the number of terms via maxTerms', () => {
    const q = buildKbSearchQuery('ett två tre fyra fem sex', 3);
    expect(q).toBe('ett* OR två* OR tre*');
  });

  it('returns empty string when no qualifying words remain', () => {
    expect(buildKbSearchQuery('a , . !')).toBe('');
  });
});
