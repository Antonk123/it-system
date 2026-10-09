// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';

const Boom = () => {
  throw new Error('krasch');
};

afterEach(cleanup);

describe('ErrorBoundary', () => {
  it('visar "Ladda om" och en länk till översikten utan att kräva en router', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Boom /></ErrorBoundary>);

    expect(screen.getByRole('heading', { name: 'Något gick fel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ladda om' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Till översikten' })).toHaveAttribute('href', '/');
    spy.mockRestore();
  });

  it('renderar barnen när inget går fel', () => {
    render(<ErrorBoundary><p>innehåll</p></ErrorBoundary>);
    expect(screen.getByText('innehåll')).toBeInTheDocument();
  });
});
