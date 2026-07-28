// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

let brandingValue: { logoUrl: string | null };
vi.mock('@/hooks/useBranding', () => ({
  useBranding: () => brandingValue,
}));
vi.mock('@/assets/logo-default.svg', () => ({ default: '/mock/logo-default.svg' }));

import { BrandLogo } from './BrandLogo';

beforeEach(() => {
  brandingValue = { logoUrl: null };
});

afterEach(cleanup);

describe('BrandLogo', () => {
  it('visar standardmärket när logoUrl är null', () => {
    render(<BrandLogo alt="IT-Ticket" />);
    const img = screen.getByRole('img', { name: 'IT-Ticket' });
    expect(img).toHaveAttribute('src', '/mock/logo-default.svg');
  });

  it('visar den uppladdade logotypen när logoUrl finns', () => {
    brandingValue = { logoUrl: '/api/public/branding/logo?v=123' };
    render(<BrandLogo alt="IT-Ticket" />);
    const img = screen.getByRole('img', { name: 'IT-Ticket' });
    expect(img).toHaveAttribute('src', '/api/public/branding/logo?v=123');
  });

  it('faller tillbaka på standardmärket vid onError', () => {
    brandingValue = { logoUrl: '/api/public/branding/logo?v=123' };
    render(<BrandLogo alt="IT-Ticket" />);
    const img = screen.getByRole('img', { name: 'IT-Ticket' });
    fireEvent.error(img);
    expect(img).toHaveAttribute('src', '/mock/logo-default.svg');
  });
});
