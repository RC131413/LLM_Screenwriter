import { Check, ChevronDown, Circle, LoaderCircle } from 'lucide-react';
import type { ApiRunDetail } from '../services/api';

export function AgentProgress({ run }: { run: ApiRunDetail | null }) {
  if (!run) return <section className="panel-section"><span className="eyebrow">PRZEBIEG GENEROWANIA</span><p className="muted small">Brak zarejestrowanego przebiegu.</p></section>;
  const agents = run.agent_executions;
  const completed = agents.filter(agent => agent.status === 'completed').length;
  const running = ['pending', 'running'].includes(run.status);
  const percent = agents.length ? Math.round(completed / agents.length * 100) : run.status === 'completed' ? 100 : 0;
  return <section className="panel-section"><span className="eyebrow">PRZEBIEG #{run.id}</span>
    <div className="progress-heading"><span role="status">{run.status === 'completed' ? 'Zakończony' : run.status === 'failed' ? 'Błąd generowania' : running ? 'W trakcie' : run.status}</span><span>{percent}%</span></div>
    <progress className="generation-progress" aria-label="Postęp generowania" max={100} value={running && !agents.length ? undefined : percent} />
    {run.error_message && <p className="form-error" role="alert">{run.error_message}</p>}
    {agents.length > 0 && <details className="agent-details"><summary><span>Szczegóły agentów</span><ChevronDown size={14} /></summary><ol className="agent-list">
      {agents.map((agent, index) => <li key={agent.id} className={agent.status === 'running' ? 'active' : ''}>
        <span className="agent-icon">{agent.status === 'completed' ? <Check size={14} /> : agent.status === 'running' ? <LoaderCircle size={14} className="spin" /> : <Circle size={12} />}</span>
        <div><strong>{agent.agent_name}</strong><small>{agent.node_name} · {agent.status}{agent.duration_ms !== null && ` · ${agent.duration_ms} ms`}</small>{agent.error_message && <small>{agent.error_message}</small>}</div><span className="agent-order">{String(index + 1).padStart(2, '0')}</span>
      </li>)}
    </ol></details>}
  </section>;
}
