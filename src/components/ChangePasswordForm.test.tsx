// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { changePassword, refreshUser, toastSuccess } = vi.hoisted(() => ({
  changePassword: vi.fn(),
  refreshUser: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: { changePassword } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ refreshUser }) }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess } }));

import { ChangePasswordForm } from './ChangePasswordForm';

const fill = (current: string, next: string, confirm: string) => {
  fireEvent.change(screen.getByLabelText('Nuvarande lösenord'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('Nytt lösenord'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Upprepa nytt lösenord'), { target: { value: confirm } });
  fireEvent.click(screen.getByRole('button', { name: 'Byt lösenord' }));
};

beforeEach(() => {
  changePassword.mockResolvedValue({ message: 'ok', accessToken: 't' });
  refreshUser.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ChangePasswordForm — klientvalidering speglar serverns policy', () => {
  it.each([
    ['Kort1!', 'Lösenordet måste vara minst 12 tecken långt'],
    ['endastgemenerlangt', null],
    ['endastgemener', 'Lösenordet måste innehålla minst tre av: liten bokstav, stor bokstav, siffra, specialtecken — eller vara minst 16 tecken långt'],
    ['Blandat1Lösen!', null],
    ['å'.repeat(37), 'Lösenordet får vara högst 72 byte långt'],
  ])('"%s"', async (password, expectedError) => {
    render(<ChangePasswordForm />);
    fill('gammalt', password, password);

    if (expectedError) {
      expect(await screen.findByRole('alert')).toHaveTextContent(expectedError);
      expect(changePassword).not.toHaveBeenCalled();
    } else {
      await waitFor(() => expect(changePassword).toHaveBeenCalledWith('gammalt', password));
    }
  });

  it('olika lösenord i upprepningen stoppas', async () => {
    render(<ChangePasswordForm />);
    fill('gammalt', 'Blandat1Lösen!', 'Blandat1Lösen?');
    expect(await screen.findByRole('alert')).toHaveTextContent('Lösenorden matchar inte');
    expect(changePassword).not.toHaveBeenCalled();
  });
});

describe('ChangePasswordForm — byte', () => {
  it('lyckat byte uppdaterar användaren, visar toast och anropar onSuccess', async () => {
    const onSuccess = vi.fn();
    render(<ChangePasswordForm onSuccess={onSuccess} />);
    fill('gammalt', 'Blandat1Lösen!', 'Blandat1Lösen!');

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(refreshUser).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith('Lösenordet har ändrats');
    expect(screen.getByLabelText('Nytt lösenord')).toHaveValue('');
  });

  it('serverns policyfel visas och formuläret blir kvar', async () => {
    changePassword.mockRejectedValue(new Error('Lösenordet är för vanligt'));
    const onSuccess = vi.fn();
    render(<ChangePasswordForm onSuccess={onSuccess} />);
    fill('gammalt', 'Blandat1Lösen!', 'Blandat1Lösen!');

    expect(await screen.findByRole('alert')).toHaveTextContent('Lösenordet är för vanligt');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('översätter serverns "Current password is incorrect"', async () => {
    changePassword.mockRejectedValue(new Error('Current password is incorrect'));
    render(<ChangePasswordForm />);
    fill('fel', 'Blandat1Lösen!', 'Blandat1Lösen!');

    expect(await screen.findByRole('alert')).toHaveTextContent('Nuvarande lösenord är fel');
  });
});
