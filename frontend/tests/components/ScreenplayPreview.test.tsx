import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScreenplayPreview } from '../../src/components/ScreenplayPreview';
import { variantFixture } from '../support/fixtures';

describe('structured screenplay preview', () => {
  it('shows a newly proposed heading separately from continuation blocks', () => {
    const variant = variantFixture();
    variant.critic_metadata.heading = { location_heading: 'WN. MIESZKANIE', time_of_day: 'RANO' };
    render(<ScreenplayPreview variant={variant} />);
    expect(screen.getByText('WN. MIESZKANIE - RANO')).toHaveClass('screenplay-preview-heading');
    expect(screen.getByText('ANNA')).toHaveClass('character');
  });

  it('renders every paragraph with the same block type used by the scene editor', () => {
    const variant = variantFixture();
    variant.critic_metadata.blocks = [
      { id: 'a', type: 'action', text: 'Anna otwiera kopertę.' },
      { id: 'b', type: 'character', text: 'ANNA' },
      { id: 'c', type: 'parenthetical', text: '(szeptem)' },
      { id: 'd', type: 'dialogue', text: 'To niemożliwe.' },
      { id: 'e', type: 'transition', text: 'CIĘCIE DO:' },
    ];
    render(<ScreenplayPreview variant={variant} />);
    for (const [text, kind] of [
      ['Anna otwiera kopertę.', 'action'], ['ANNA', 'character'], ['(szeptem)', 'parenthetical'],
      ['To niemożliwe.', 'dialogue'], ['CIĘCIE DO:', 'transition'],
    ]) expect(screen.getByText(text)).toHaveClass('screenplay-preview-block', kind);
    expect(screen.queryByText('Znalazłam list.')).not.toBeInTheDocument();
  });

  it('still displays legacy text variants without structured metadata', () => {
    render(<ScreenplayPreview variant={{ ...variantFixture(), critic_metadata: {}, generated_full_text: 'Starszy tekst sceny.' }} />);
    expect(screen.getByText('Starszy tekst sceny.')).toHaveClass('action');
  });
});
