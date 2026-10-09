import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Fynd M26: offsiteBackup var helt otestad. Kommandokörningen (execFile via
 * child_process) mockas så inga verkliga shell-kommandon körs. Verifierar:
 *   - okonfigurerad (ingen OFFSITE_BACKUP_CMD) → no-op
 *   - lyckad körning → ingen throw, säker {file}→"$BACKUP_FILE"-substitution
 *   - misslyckad + REQUIRED=false → loggas men kastar inte
 *   - misslyckad + OFFSITE_BACKUP_REQUIRED=true → kastar
 *   - konsekutiv-räknaren ökar vid fel och nollställs vid lyckad uppladdning
 *   - kommandot körs med timeout + SIGKILL så ett hängande rclone inte blockerar för evigt
 *   - uppstartsvarning i produktion när ingen off-site-backup är konfigurerad
 */

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));

vi.mock('child_process', () => ({
  execFile: execFileMock,
}));

// Förväntade fel ("Off-site backup failed") ska inte spamma testutskriften.
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { uploadBackupOffsite, getOffsiteFailureCount, warnIfOffsiteMissing } from './offsiteBackup.js';
import { logger } from './logger.js';

const backupFile = join(mkdtempSync(join(tmpdir(), 'offsite-test-')), 'backup.zip');

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

const mockExecSuccess = () =>
  execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: ExecCallback) => {
    cb(null, '', '');
  });

const mockExecFailure = () =>
  execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: ExecCallback) => {
    cb(new Error('Command failed: exit 1'), '', 'rclone: connection refused');
  });

const ENV_KEYS = ['OFFSITE_BACKUP_CMD', 'OFFSITE_BACKUP_REQUIRED', 'NODE_ENV'] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  delete process.env.OFFSITE_BACKUP_CMD;
  delete process.env.OFFSITE_BACKUP_REQUIRED;
  execFileMock.mockReset();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('uploadBackupOffsite', () => {
  it('is a no-op when OFFSITE_BACKUP_CMD is not set', async () => {
    const before = getOffsiteFailureCount();
    await expect(uploadBackupOffsite(backupFile)).resolves.toBeUndefined();
    expect(execFileMock).not.toHaveBeenCalled();
    expect(getOffsiteFailureCount()).toBe(before);
  });

  it('runs the template via sh -c with {file} replaced by "$BACKUP_FILE" (never the raw path)', async () => {
    process.env.OFFSITE_BACKUP_CMD = 'rclone copy {file} remote:itticket/';
    mockExecSuccess();

    const filePath = join(mkdtempSync(join(tmpdir(), 'offsite-test-')), 'backup med mellanslag (1).zip');
    await expect(uploadBackupOffsite(filePath)).resolves.toBeUndefined();

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = execFileMock.mock.calls[0] as [string, string[], { env: Record<string, string> }, ExecCallback];
    expect(cmd).toBe('sh');
    expect(args).toEqual(['-c', 'rclone copy "$BACKUP_FILE" remote:itticket/']);
    // Sökvägen får ALDRIG interpoleras i shell-strängen — bara via env-varen.
    expect(args[1]).not.toContain(filePath);
    expect(opts.env.BACKUP_FILE).toBe(filePath);
  });

  it('runs the command with a timeout and SIGKILL so a hung upload cannot block forever', async () => {
    process.env.OFFSITE_BACKUP_CMD = 'rclone copy {file} remote:itticket/';
    mockExecSuccess();

    await uploadBackupOffsite(backupFile);

    const opts = execFileMock.mock.calls[0][2] as { timeout: number; killSignal: string };
    expect(opts.timeout).toBe(15 * 60 * 1000);
    expect(opts.killSignal).toBe('SIGKILL');
  });

  it('does not throw on failure when OFFSITE_BACKUP_REQUIRED is unset, but increments the counter', async () => {
    process.env.OFFSITE_BACKUP_CMD = 'rclone copy {file} remote:itticket/';
    mockExecFailure();

    const before = getOffsiteFailureCount();
    await expect(uploadBackupOffsite(backupFile)).resolves.toBeUndefined();
    expect(getOffsiteFailureCount()).toBe(before + 1);

    // Konsekutiva fel fortsätter räknas upp.
    await expect(uploadBackupOffsite(backupFile)).resolves.toBeUndefined();
    expect(getOffsiteFailureCount()).toBe(before + 2);
  });

  it('throws on failure when OFFSITE_BACKUP_REQUIRED=true and increments the counter', async () => {
    process.env.OFFSITE_BACKUP_CMD = 'rclone copy {file} remote:itticket/';
    process.env.OFFSITE_BACKUP_REQUIRED = 'true';
    mockExecFailure();

    const before = getOffsiteFailureCount();
    await expect(uploadBackupOffsite(backupFile)).rejects.toThrow(/exit 1/);
    expect(getOffsiteFailureCount()).toBe(before + 1);
  });

  it('resets the consecutive failure counter on a successful upload', async () => {
    process.env.OFFSITE_BACKUP_CMD = 'rclone copy {file} remote:itticket/';

    mockExecFailure();
    await uploadBackupOffsite(backupFile);
    expect(getOffsiteFailureCount()).toBeGreaterThan(0);

    mockExecSuccess();
    await uploadBackupOffsite(backupFile);
    expect(getOffsiteFailureCount()).toBe(0);
  });
});

describe('warnIfOffsiteMissing', () => {
  beforeEach(() => vi.mocked(logger.warn).mockClear());

  it('warns in production when OFFSITE_BACKUP_CMD is empty', () => {
    process.env.NODE_ENV = 'production';
    warnIfOffsiteMissing();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Ingen off-site-backup konfigurerad'));
  });

  it('stays silent in production when a command is configured', () => {
    process.env.NODE_ENV = 'production';
    process.env.OFFSITE_BACKUP_CMD = 'rclone copy {file} remote:itticket/';
    warnIfOffsiteMissing();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('stays silent outside production', () => {
    process.env.NODE_ENV = 'development';
    warnIfOffsiteMissing();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
