import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProjectDialog } from '../../src/components/ProjectDialog';
import { api } from '../../src/services/api';
import { toProject } from '../../src/services/workspaceData';
import { workspaceFixture } from '../support/fixtures';
import { deferred, interceptHttp, jsonResponse } from '../support/http';

describe('project form API writes', () => {
  it('submits all ERD fields and keeps the dialog open and locked until the request finishes', async () => {
    const response = deferred<Response>();
    const http = interceptHttp(() => response.promise);
    const close = vi.fn();
    render(<ProjectDialog onClose={close} onSave={async data => { await api.projects.create(data); close(); }} />);
    const user = userEvent.setup();
    for (const [label, value] of [['Tytuł', ' Nowy film '], ['Gatunek', 'Dramat'], ['Grupa docelowa', 'Dorośli'], ['Logline', 'List z przeszłości.'], ['Streszczenie', 'Bohaterka odkrywa prawdę.']]) {
      await user.type(screen.getByLabelText(label), value);
    }
    await user.click(screen.getByRole('button', { name: 'Utwórz projekt' }));
    expect(screen.getByRole('button', { name: 'Zapisywanie…' })).toBeDisabled();
    expect(screen.getByLabelText('Tytuł')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Zamknij okno' }));
    expect(close).not.toHaveBeenCalled();
    expect(http.calls[0].body).toEqual({ title: 'Nowy film', genre: 'Dramat', target_audience: 'Dorośli', logline: 'List z przeszłości.', synopsis: 'Bohaterka odkrywa prawdę.' });
    await act(async () => { response.resolve(jsonResponse(workspaceFixture().project, 201)); });
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });

  it('preserves edited fields after server validation fails and supports retry', async () => {
    let fail = true;
    const close = vi.fn();
    const http = interceptHttp(() => fail ? jsonResponse({ detail: 'Validation failed', fields: { title: ['Niedozwolony tytuł'] } }, 422) : jsonResponse(workspaceFixture().project));
    render(<ProjectDialog project={toProject(workspaceFixture())} onClose={close} onSave={async data => { await api.projects.update(1, data); close(); }} />);
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText('Streszczenie'));
    await user.type(screen.getByLabelText('Streszczenie'), 'Nowy opis');
    await user.click(screen.getByRole('button', { name: 'Zapisz projekt' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('title: Niedozwolony tytuł');
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Streszczenie')).toHaveValue('Nowy opis');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Zapisz projekt' }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(http.calls.map(call => [call.method, call.path])).toEqual([['PATCH', '/projects/1'], ['PATCH', '/projects/1']]);
  });
});
