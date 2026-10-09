import { describe, it, expect, beforeEach, vi } from 'vitest';

const { scheduleMock, stopMock, processMock } = vi.hoisted(() => ({
  scheduleMock: vi.fn(),
  stopMock: vi.fn(),
  processMock: vi.fn(),
}));

vi.mock('node-cron', () => ({ default: { schedule: scheduleMock } }));
vi.mock('./webhookDispatcher.js', () => ({ processWebhookRetries: processMock }));
vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { startWebhookRetryScheduler, stopWebhookRetryScheduler } from './webhookRetryScheduler.js';

type Tick = () => Promise<void>;

function lastTick(): Tick {
  return scheduleMock.mock.calls.at(-1)![1] as Tick;
}

beforeEach(() => {
  stopWebhookRetryScheduler();
  scheduleMock.mockReset();
  stopMock.mockReset();
  processMock.mockReset();
  scheduleMock.mockReturnValue({ stop: stopMock });
  processMock.mockResolvedValue(undefined);
});

describe('webhookRetryScheduler', () => {
  it('schedules a per-minute tick that runs processWebhookRetries', async () => {
    startWebhookRetryScheduler();
    expect(scheduleMock).toHaveBeenCalledWith('* * * * *', expect.any(Function));

    await lastTick()();
    expect(processMock).toHaveBeenCalledTimes(1);
  });

  it('does not schedule twice while running', () => {
    startWebhookRetryScheduler();
    startWebhookRetryScheduler();
    expect(scheduleMock).toHaveBeenCalledTimes(1);
  });

  it('skips a tick while the previous one is still running (reentrancy guard)', async () => {
    let release!: () => void;
    processMock.mockReturnValueOnce(new Promise<void>((resolve) => { release = resolve; }));
    startWebhookRetryScheduler();
    const tick = lastTick();

    const first = tick();
    await tick();
    expect(processMock).toHaveBeenCalledTimes(1);

    release();
    await first;
    await tick();
    expect(processMock).toHaveBeenCalledTimes(2);
  });

  it('survives an error in processWebhookRetries and keeps ticking', async () => {
    processMock.mockRejectedValueOnce(new Error('boom'));
    startWebhookRetryScheduler();
    const tick = lastTick();

    await expect(tick()).resolves.toBeUndefined();
    await tick();
    expect(processMock).toHaveBeenCalledTimes(2);
  });

  it('stop() stops the task and allows restarting', () => {
    startWebhookRetryScheduler();
    stopWebhookRetryScheduler();
    expect(stopMock).toHaveBeenCalledTimes(1);

    startWebhookRetryScheduler();
    expect(scheduleMock).toHaveBeenCalledTimes(2);
  });

  it('stop() without a running task is a no-op', () => {
    expect(() => stopWebhookRetryScheduler()).not.toThrow();
    expect(stopMock).not.toHaveBeenCalled();
  });
});
