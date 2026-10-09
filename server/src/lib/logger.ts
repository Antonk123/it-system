type LogLevel = 'info' | 'warn' | 'error' | 'debug';
type LogMeta = Record<string, unknown> | string;

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// Nycklar vars värden aldrig ska hamna i loggen (grunt, bara toppnivån i meta).
const REDACT_KEY = /password|token|authorization|cookie|secret/i;

// LOG_LEVEL läses vid varje anrop så att tester och driftändringar slår igenom.
// Default: info i produktion, debug annars.
function minLevel(): number {
  const configured = process.env.LOG_LEVEL?.toLowerCase();
  if (configured && configured in LEVEL_RANK) return LEVEL_RANK[configured as LogLevel];
  return process.env.NODE_ENV === 'production' ? LEVEL_RANK.info : LEVEL_RANK.debug;
}

function normalizeMeta(meta: LogMeta | undefined): Record<string, unknown> {
  if (meta === undefined) return {};
  // En sträng skulle annars spridas tecken för tecken ({0:'K',1:'B',...}).
  // Nyckeln är `detail` (inte `message`) så den inte krockar med loggradens meddelande.
  if (typeof meta === 'string') return { detail: meta };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    // meta.message skulle annars skriva över loggradens meddelande.
    out[key === 'message' ? 'detail' : key] = REDACT_KEY.test(key) ? '[REDACTED]' : value;
  }
  return out;
}

function log(level: LogLevel, message: string, meta?: LogMeta) {
  if (LEVEL_RANK[level] < minLevel()) return;
  const entry = {
    ...normalizeMeta(meta),
    timestamp: new Date().toISOString(),
    level,
    message,
  };
  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else if (level === 'warn') {
    console.warn(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

export const logger = {
  info: (msg: string, meta?: LogMeta) => log('info', msg, meta),
  warn: (msg: string, meta?: LogMeta) => log('warn', msg, meta),
  error: (msg: string, meta?: LogMeta) => log('error', msg, meta),
  debug: (msg: string, meta?: LogMeta) => log('debug', msg, meta),
};
