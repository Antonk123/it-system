// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { BackupScheduleSection } from './BackupScheduleSection';

// Mocka hookarna så att komponenten testas isolerat (ingen react-query/nät).
const updateMutate = vi.fn();
const runMutate = vi.fn();

let configValue: {
  config: unknown;
  isLoading: boolean;
  isError: boolean;
  updateConfig: { mutate: typeof updateMutate; isPending: boolean };
};
let runValue: { mutate: typeof runMutate; isPending: boolean };

vi.mock('@/hooks/useBackupConfig', () => ({
  useBackupConfig: () => configValue,
  useRunBackupNow: () => runValue,
}));

const baseConfig = {
  enabled: true,
  time: '02:00',
  retentionDays: 7,
  lastRunAt: null,
  lastStatus: null,
  lastSizeBytes: null,
  nextRunAt: null,
};

beforeEach(() => {
  updateMutate.mockReset();
  runMutate.mockReset();
  configValue = {
    config: baseConfig,
    isLoading: false,
    isError: false,
    updateConfig: { mutate: updateMutate, isPending: false },
  };
  runValue = { mutate: runMutate, isPending: false };
});

afterEach(cleanup);

describe('BackupScheduleSection', () => {
  it('renderar switch + (när enabled) tid, retention och "Kör backup nu"', () => {
    render(<BackupScheduleSection />);
    expect(screen.getByRole('switch')).toBeTruthy();
    expect(screen.getByLabelText('Tid (HH:MM)')).toBeTruthy();
    expect(screen.getByLabelText('Lagringstid (dagar)')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Kör backup nu/i })).toBeTruthy();
  });

  it('döljer tid och retention när automatisk backup är av', () => {
    configValue = {
      ...configValue,
      config: { ...baseConfig, enabled: false },
    };
    render(<BackupScheduleSection />);
    expect(screen.queryByLabelText('Tid (HH:MM)')).toBeNull();
    expect(screen.queryByLabelText('Lagringstid (dagar)')).toBeNull();
  });

  it('statusraden visar senaste körning när lastRunAt finns', () => {
    configValue = {
      ...configValue,
      config: {
        ...baseConfig,
        lastRunAt: '2026-06-19 02:00:00',
        lastStatus: 'success',
        lastSizeBytes: 5 * 1024 * 1024,
      },
    };
    render(<BackupScheduleSection />);
    expect(screen.getByText(/Senaste:/)).toBeTruthy();
    expect(screen.getByText(/5\.0 MB/)).toBeTruthy();
  });

  it('visar "Ingen körning än" när lastRunAt saknas', () => {
    render(<BackupScheduleSection />);
    expect(screen.getByText(/Ingen körning än/)).toBeTruthy();
  });

  it('"Spara"-klick anropar update-mutationen med rätt värden', () => {
    render(<BackupScheduleSection />);
    fireEvent.change(screen.getByLabelText('Tid (HH:MM)'), { target: { value: '03:30' } });
    fireEvent.change(screen.getByLabelText('Lagringstid (dagar)'), { target: { value: '14' } });
    fireEvent.click(screen.getByRole('button', { name: /Spara/i }));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate).toHaveBeenCalledWith({
      enabled: true,
      time: '03:30',
      retentionDays: 14,
    });
  });

  it('"Kör backup nu"-klick anropar run-now-mutationen', () => {
    render(<BackupScheduleSection />);
    fireEvent.click(screen.getByRole('button', { name: /Kör backup nu/i }));
    expect(runMutate).toHaveBeenCalledTimes(1);
  });
});
