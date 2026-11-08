import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SceneEditor } from '../../src/components/SceneEditor';
import type { Scene, ScriptBlock } from '../../src/types';
import { SceneHistory } from '../../src/services/sceneHistory';
import '../../src/styles.css';

declare global {
  interface Window {
    editorTest: { reset: (blocks: ScriptBlock[], zoom?: number) => void; scene: Scene; changes: number };
  }
}
const initial: Scene = { id: 'qa', scene_number: 1, title: 'Test klawiatury', heading: 'WN. DOM – DZIEŃ',
  time_of_day: 'DZIEŃ', act: 1, status: 'draft', synopsis: '', notes: '', characterIds: [],
  ai_metadata: {}, editor_metadata: {}, blocks: [{ id: 'a', type: 'action', text: 'Pierwszy blok.' }] };

function Harness() {
  const [scene, setScene] = useState(initial);
  const [zoom, setZoom] = useState(100);
  const [changes, setChanges] = useState(0);
  const history = useRef(new SceneHistory());
  const breakGroup = useCallback(() => history.current.breakGroup(), []);
  useLayoutEffect(() => {
    window.editorTest = { scene, changes, reset: (blocks, nextZoom = 100) => {
      setScene({ ...initial, blocks }); setZoom(nextZoom); setChanges(0); history.current.clear();
    } };
  });
  return <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
    <SceneEditor scene={scene} sceneNumber={1} zoom={zoom} onHistoryBoundary={breakGroup} onChange={(next, edit) => {
      history.current.record(scene, next, edit); setScene(next); setChanges(changes + 1);
    }} onDelete={() => {}} undo={() => {
      const previous = history.current.undo(scene); if (previous) setScene(previous);
    }} redo={() => {
      const next = history.current.redo(scene); if (next) setScene(next);
    }} canUndo={history.current.canUndo(scene.id)} canRedo={history.current.canRedo(scene.id)} />
  </div>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
