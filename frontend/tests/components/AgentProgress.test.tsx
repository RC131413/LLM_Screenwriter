import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AgentProgress } from '../../src/components/AgentProgress';
import { executionFixture as agent, progressFixture } from '../support/generation';

describe('live agent progress', () => {
  it('updates real statuses without closing expanded details and ticks time without inventing progress', async () => {
    const mounted = render(<AgentProgress run={null} progress={progressFixture()} active />);
    await userEvent.setup().click(screen.getByText('Szczegóły agentów'));
    const details = screen.getByText('Szczegóły agentów').closest('details')!;
    await waitFor(() => expect(details).toHaveAttribute('open'));
    expect(screen.getByText('Archiwista').closest('li')).toHaveAttribute('data-status', 'running');
    expect(screen.getByText('Reżyser').closest('li')).toHaveAttribute('data-status', 'pending');
    const next = progressFixture({ percent: 25, completed_steps: 1,
      agent_executions: [agent('archivist', 'completed'), agent('director')] });
    mounted.rerender(<AgentProgress run={null} progress={next} active />);
    expect(details).toHaveAttribute('open');
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '25');
    expect(screen.getByText('Archiwista').closest('li')).toHaveTextContent('Zakończono');
    const director = screen.getByText('Reżyser').closest('li')!;
    const before = director.textContent;
    vi.useFakeTimers();
    // The interval was created before fake timers: enable it again in the fake clock.
    mounted.rerender(<AgentProgress run={null} progress={{ ...next, status: 'failed' }} />);
    mounted.rerender(<AgentProgress run={null} progress={next} active />);
    act(() => vi.advanceTimersByTime(2000));
    expect(director.textContent).not.toBe(before);
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '25');
  });

  it('shows critic repairs as additional executions, then keeps details open at completion', async () => {
    const rows = [agent('archivist', 'completed'), agent('director', 'completed'), agent('scenarist', 'completed'),
      { ...agent('critic', 'completed'), review_status: 'revision_requested' }, agent('scenarist', 'running', 1, 15)];
    const snapshot = progressFixture({ percent: 75, completed_steps: 3, agent_executions: rows });
    const mounted = render(<AgentProgress run={null} progress={snapshot} active />);
    await userEvent.setup().click(screen.getByText('Szczegóły agentów'));
    expect(screen.getByText('Scenarzysta · poprawka 1').closest('li')).toHaveAttribute('data-status', 'running');
    expect(screen.getByText('Krytyk · poprawka 1').closest('li')).toHaveAttribute('data-status', 'pending');
    mounted.rerender(<AgentProgress run={null} progress={{ ...snapshot, status: 'completed', percent: 100, completed_steps: 4,
      agent_executions: [...rows.slice(0, -1), { ...rows[4], status: 'completed', duration_ms: 3000 }, agent('critic', 'completed', 1, 16)] }} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '100');
    expect(screen.getByText('Szczegóły agentów').closest('details')).toHaveAttribute('open');
    expect(screen.getByText('Zakończony')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-status="pending"]')).toHaveLength(0);
  });
});
