// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Button } from './button';

afterEach(cleanup);

describe('Button', () => {
  it('renderar sina children', () => {
    render(<Button>Spara</Button>);
    expect(screen.getByRole('button', { name: 'Spara' })).toBeTruthy();
  });

  it('anropar onClick vid klick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Klicka</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Klicka' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('blockerar klick när disabled', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Av
      </Button>
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
});
