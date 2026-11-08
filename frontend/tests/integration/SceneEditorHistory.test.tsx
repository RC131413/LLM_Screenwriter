import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SceneEditor } from '../../src/components/SceneEditor';
import { useWorkspace } from '../../src/hooks/useWorkspace';
import { workspaceHttp } from '../support/workspaceHttp';

function WorkspaceEditor() {
  const workspace = useWorkspace(1);
  const scene = workspace.projects[0]?.scenes[0];
  if (!scene) return null;
  return <SceneEditor scene={scene} sceneNumber={1} zoom={100} onChange={workspace.updateScene}
    onHistoryBoundary={workspace.breakHistoryGroup} onDelete={() => {}}
    undo={() => workspace.undo(scene.id)} redo={() => workspace.redo(scene.id)}
    canUndo={workspace.canUndo(scene.id)} canRedo={workspace.canRedo(scene.id)} />;
}

describe('scene editor grouped history controls', () => {
  it('shares grouped text history between toolbar and keyboard, including redo and selection deletion', async () => {
    workspaceHttp(); render(<WorkspaceEditor />);
    const input = await screen.findByLabelText<HTMLTextAreaElement>('Akcja 1');
    const initial = input.value;
    const user = userEvent.setup();
    await user.click(input); await user.keyboard('{End} Dopisany fragment.');
    const written = input.value;
    await user.click(screen.getByRole('button', { name: 'Cofnij zmianę' }));
    expect(input).toHaveValue(initial);
    await user.click(screen.getByRole('button', { name: 'Ponów zmianę' }));
    expect(input).toHaveValue(written);
    await user.click(input); await user.keyboard('{Control>}z{/Control}');
    expect(input).toHaveValue(initial);
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(input).toHaveValue(written);
    await user.keyboard('{Control>}a{/Control}{Backspace}');
    expect(input).toHaveValue('');
    await user.keyboard('{Control>}z{/Control}');
    expect(input).toHaveValue(written);
    await user.keyboard('{Control>}y{/Control}');
    expect(input).toHaveValue('');
  });

  it('separates paste, cursor relocation, changing fields and new edits after undo', async () => {
    workspaceHttp(); render(<WorkspaceEditor />);
    const input = await screen.findByLabelText<HTMLTextAreaElement>('Akcja 1');
    const initial = input.value;
    const user = userEvent.setup();
    await user.click(input); await user.keyboard('{End} Dopisek.');
    await user.paste(' Wklejony tekst.');
    await user.keyboard(' Dalej.');
    await user.keyboard('{Control>}z{/Control}');
    expect(input).toHaveValue(initial + ' Dopisek. Wklejony tekst.');
    await user.keyboard('{Control>}z{/Control}');
    expect(input).toHaveValue(initial + ' Dopisek.');
    await user.keyboard('{Home}!');
    await user.keyboard('{Control>}z{/Control}');
    expect(input).toHaveValue(initial + ' Dopisek.');
    const title = screen.getByLabelText<HTMLInputElement>('Tytuł sceny');
    await user.click(title); await user.keyboard('{End} nowy tytuł');
    await user.click(screen.getByRole('button', { name: 'Cofnij zmianę' }));
    expect(title).toHaveValue('List');
    expect(input).toHaveValue(initial + ' Dopisek.');
    await user.click(input); await user.keyboard('{End} Inaczej.');
    expect(screen.getByRole('button', { name: 'Ponów zmianę' })).toBeDisabled();
    // Ctrl+Z stays in the scene history even when the title field has focus.
    act(() => title.focus());
    await user.keyboard('{Control>}z{/Control}');
    expect(input).toHaveValue(initial + ' Dopisek.');
  });
});
