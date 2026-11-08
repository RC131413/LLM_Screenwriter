import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StatisticsView } from '../../src/components/StatisticsView';
import { toProject } from '../../src/services/workspaceData';
import { statisticsFixture, workspaceFixture } from '../support/fixtures';
import { deferred, interceptHttp, jsonResponse } from '../support/http';

function library() {
  const active = toProject(workspaceFixture());
  const archived = { ...structuredClone(active), id: '2', title: 'Projekt w archiwum', scenes: [], characters: [],
    metadata: { archived_at: '2026-01-01T12:00:00Z' } };
  const trashed = { ...structuredClone(active), id: '3', title: 'Projekt w koszu', metadata: { deleted_at: '2026-01-01T12:00:00Z' } };
  return [active, archived, trashed];
}

describe('account statistics from persisted project data and API', () => {
  it('keeps non-trash totals, real library counts and generation results grouped by project', async () => {
    interceptHttp(() => jsonResponse(statisticsFixture({
      projects: 3,
      // Deliberately reverse IDs: the table must match by ID, not array order.
      project_generations: [{ project_id: 2, completed_runs: 0, failed_runs: 0 }, { project_id: 1, completed_runs: 7, failed_runs: 2 }],
    })));
    const { container } = render(<StatisticsView projects={library()} />);
    await screen.findByRole('heading', { name: 'Projekty w liczbach' });
    const totals = [...container.querySelectorAll('.statistics-metrics dd')].map(element => element.textContent);
    expect(totals).toEqual(['2', '1', '3', '2']);
    expect(screen.getByText('Aktywne: 1')).toBeInTheDocument();
    expect(screen.getByText('Archiwum: 1')).toBeInTheDocument();
    expect(screen.getByText('Kosz: 1')).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getAllByRole('cell').map(cell => cell.textContent).slice(0, 5)).toEqual(['1', '3', '2', '7', '2']);
    expect(within(rows[2]).getAllByRole('cell').map(cell => cell.textContent).slice(0, 5)).toEqual(['0', '0', '0', '0', '0']);
    expect(screen.queryByRole('link', { name: 'Projekt w koszu' })).not.toBeInTheDocument();
  });

  it('shows five separate activities including repeated actions in one project', async () => {
    interceptHttp(() => jsonResponse(statisticsFixture({ recent_activity: Array.from({ length: 5 }, (_, index) => ({
      id: `activity-${index}`, project_id: 1, project_title: 'Nocny pociąg', action: 'open',
      occurred_at: `2026-11-08T12:0${5 - index}:00Z`,
    })) })));
    render(<StatisticsView projects={library()} />);
    const list = await screen.findByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect(within(list).getAllByText('Otwarcie projektu')).toHaveLength(5);
    expect(within(list).getAllByRole('link')).toHaveLength(5);
    expect([...list.querySelectorAll('time')].map(element => element.dateTime)).toEqual([
      '2026-11-08T12:05:00Z', '2026-11-08T12:04:00Z', '2026-11-08T12:03:00Z', '2026-11-08T12:02:00Z', '2026-11-08T12:01:00Z',
    ]);
  });

  it('retains activity for trashed projects without linking to an inaccessible editor', async () => {
    interceptHttp(() => jsonResponse(statisticsFixture({ recent_activity: [{
      id: 'trash-1', project_id: 3, project_title: 'Projekt w koszu', action: 'trash', occurred_at: '2026-11-08T12:00:00Z',
    }] })));
    render(<StatisticsView projects={library()} />);
    const list = await screen.findByRole('list');
    expect(within(list).getByText('Projekt w koszu')).toBeInTheDocument();
    expect(within(list).getByText('Przeniesienie do kosza')).toBeInTheDocument();
    expect(within(list).queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows real zeros and an empty history for a new account', async () => {
    interceptHttp(() => jsonResponse(statisticsFixture({ projects: 0, project_generations: [] })));
    const { container } = render(<StatisticsView projects={[]} />);
    await screen.findByText('Brak ostatniej aktywności.');
    expect([...container.querySelectorAll('.statistics-metrics dd')].map(element => element.textContent)).toEqual(['0', '0', '0', '0']);
    expect(screen.getByText('Aktywne: 0')).toBeInTheDocument();
    expect(screen.getByText('Archiwum: 0')).toBeInTheDocument();
    expect(screen.getByText('Kosz: 0')).toBeInTheDocument();
    expect([...container.querySelectorAll('.activity-count')].map(element => element.textContent)).toEqual(Array(7).fill('0'));
  });

  it('waits for saving, uses the browser time zone and refreshes results on return to the tab', async () => {
    const saved = deferred<void>();
    const prepare = vi.fn(() => saved.promise);
    let completed = 1;
    const http = interceptHttp(() => jsonResponse(statisticsFixture({ project_generations: [{ project_id: 1, completed_runs: completed, failed_runs: 0 }] })));
    render(<StatisticsView projects={[library()[0]]} onPrepare={prepare} />);
    expect(http.calls).toHaveLength(0);
    await act(async () => { saved.resolve(); });
    await screen.findByRole('table');
    expect(http.calls[0].url.searchParams.get('time_zone')).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    completed = 9;
    fireEvent.focus(window);
    await waitFor(() => expect(within(screen.getAllByRole('row')[1]).getAllByRole('cell')[3]).toHaveTextContent('9'));
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it('allows retry after a statistics fetch fails and aborts pending reads on leaving', async () => {
    let fail = true;
    const pending = deferred<Response>();
    const http = interceptHttp(() => fail ? jsonResponse({ detail: 'Statystyki niedostępne.' }, 503) : pending.promise);
    const mounted = render(<StatisticsView projects={[]} />);
    expect(await screen.findByText('Statystyki niedostępne.')).toBeInTheDocument();
    fail = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    await waitFor(() => expect(http.calls).toHaveLength(2));
    mounted.unmount();
    expect(http.calls[1].init.signal?.aborted).toBe(true);
    await act(async () => { pending.resolve(jsonResponse(statisticsFixture())); });
  });
});
