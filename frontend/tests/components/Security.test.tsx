import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UserAvatar, UserMenu } from '../../src/components/UserMenu';
import { safeAvatarUrl } from '../../src/services/validation';

describe('untrusted profile data', () => {
  it.each(['javascript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>', 'file:///etc/passwd', '//example.com/img.png', 'https://user:secret@example.com/img.png'])('does not embed an unsafe avatar URL: %s', avatar_url => {
    const { container } = render(<UserAvatar profile={{ display_name: 'Autor', avatar_url }} />);
    expect(safeAvatarUrl(avatar_url)).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('uses a safe image without leaking the current URL as a referrer', () => {
    const { container } = render(<UserAvatar profile={{ display_name: 'Autor', avatar_url: 'https://example.com/avatar.png' }} />);
    expect(container.querySelector('img')).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('renders code-like display names as text, not executable HTML', () => {
    const display_name = '<img data-attack src=x onerror="window.pwned=1">';
    const { container } = render(<UserMenu profile={{ display_name, avatar_url: null, username: 'writer', email: 'writer@example.com', preferred_language: 'pl' }} onSettings={vi.fn()} onLogout={vi.fn()} />);
    expect(screen.getByText(display_name)).toBeInTheDocument();
    expect(container.querySelector('[data-attack]')).toBeNull();
  });
});
