import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Circle, LoaderCircle, X } from 'lucide-react';
import type { ApiGenerationProgress, ApiRunDetail } from '../services/api';
import { agentRows, elapsedTime, storedProgress } from '../services/generationProgress';

const STATUS: Record<string, string> = { pending: 'Oczekuje', running: 'W trakcie', completed: 'Zakończono', failed: 'Błąd', cancelled: 'Anulowano' };

export function AgentProgress({ run, progress: live, active = false, variantCount = 1, activity, loading = false, syncError }: {
  run: ApiRunDetail | null; progress?: ApiGenerationProgress; active?: boolean; variantCount?: number;
  activity?: string; loading?: boolean; syncError?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now);
  const list = useRef<HTMLOListElement>(null);
  const progress = live ?? storedProgress(run);
  const running = active || progress?.status === 'running' || progress?.status === 'pending';
  const currentAgentId = progress?.agent_executions.findLast(agent => agent.status === 'running')?.id;
  useLayoutEffect(() => {
    const element = list.current;
    const current = element?.querySelector<HTMLElement>('[data-status="running"]');
    if (!expanded || !element) return;
    if (!current) { if (active && !progress) element.scrollTop = 0; return; }
    if (current.offsetTop < element.scrollTop) element.scrollTop = current.offsetTop;
    else if (current.offsetTop + current.offsetHeight > element.scrollTop + element.clientHeight) {
      element.scrollTop = current.offsetTop + current.offsetHeight - element.clientHeight;
    }
  }, [expanded, currentAgentId, progress?.run_id, active]);
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  if (!progress && !active) return <section className="panel-section" aria-label="Przebieg generowania"><span className="eyebrow">PRZEBIEG GENEROWANIA</span><p className="muted small">{loading ? 'Pobieranie przebiegu…' : 'Brak zarejestrowanego przebiegu.'}</p></section>;
  const count = progress?.variant_count ?? variantCount;
  const rows = agentRows(progress?.agent_executions ?? [], count, running);
  const percent = progress?.percent ?? 0;
  const status = active ? activity ?? 'Generowanie…' : progress?.status === 'completed' ? 'Zakończony'
    : progress?.status === 'failed' ? 'Błąd generowania' : progress?.status === 'cancelled' ? 'Anulowano' : 'W trakcie';
  return <section className="panel-section" aria-label="Przebieg generowania">
    <span className="eyebrow">{progress ? `PRZEBIEG #${progress.run_id}` : 'PRZEBIEG GENEROWANIA'}</span>
    <div className="progress-heading"><span role="status">{status}</span><span>{percent}%</span></div>
    <progress className="generation-progress" aria-label="Postęp generowania" aria-valuetext={`${percent}% ukończonych etapów`} max={100} value={percent} />
    {syncError && active && <p className="muted small generation-message" role="status">{syncError}</p>}
    {progress?.error_message && <p className="form-error" role="alert">{progress.error_message}</p>}
    {rows.length > 0 && <details className="agent-details" open={expanded}>
      <summary onClick={event => { event.preventDefault(); setExpanded(value => !value); }}><span>Szczegóły agentów</span><ChevronDown size={14} /></summary><ol ref={list} className="agent-list" aria-label="Etapy generowania">
        {rows.map((row, index) => {
          const state = row.execution?.status ?? 'pending';
          const duration = elapsedTime(row.execution, now, running);
          const scope = row.node === 'archivist' && count > 1 ? 'Wspólny kontekst · ' : count > 1 ? `Wariant ${row.variant}/${count} · ` : '';
          return <li key={row.key} className={state === 'running' ? 'active' : state} data-node={row.node} data-status={state} data-variant={row.variant}>
            <span className="agent-icon">{state === 'completed' ? <Check size={14} /> : state === 'running' ? <LoaderCircle size={14} className="spin" /> : state === 'failed' || state === 'cancelled' ? <X size={13} /> : <Circle size={12} />}</span>
            <div><strong>{row.name}{row.revision > 0 && ` · poprawka ${row.revision}`}</strong><small>{scope}{STATUS[state] ?? state}{duration && ` · ${duration}`}</small>{row.execution?.error_message && <small>{row.execution.error_message}</small>}</div>
            <span className="agent-order">{String(index + 1).padStart(2, '0')}</span>
          </li>;
        })}
      </ol>
    </details>}
  </section>;
}
