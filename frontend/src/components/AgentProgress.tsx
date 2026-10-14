import { Check, ChevronDown, Circle, LoaderCircle } from 'lucide-react';
import { agentRoles } from '../services/mockAi';

interface Props { agent: number; running: boolean; hasVariants: boolean; error: string }

export function AgentProgress({ agent, running, hasVariants, error }: Props) {
  const completed = Math.max(0, Math.min(agent, agentRoles.length));
  const percent = Math.round(completed / agentRoles.length * 100);
  const status = running ? `${agentRoles[agent]?.name ?? 'Agent'} pracuje…` :
    error ? 'Generowanie przerwane' : hasVariants ? 'Symulacja zakończona' : 'Gotowy do uruchomienia';

  return <section className="panel-section">
    <span className="eyebrow">POSTĘP GENEROWANIA</span>
    <div className="progress-heading"><span role="status">{status}</span><span>{percent}%</span></div>
    <progress className="generation-progress" aria-label="Postęp generowania" aria-valuetext={`${completed} z ${agentRoles.length} etapów ukończonych`} max={agentRoles.length} value={completed} />
    <details className="agent-details">
      <summary><span>Szczegóły agentów</span><ChevronDown size={14} /></summary>
      <ol className="agent-list">
        {agentRoles.map((role, index) => <li key={role.name} className={agent === index && running ? 'active' : ''}>
          <span className="agent-icon">{completed > index ? <Check size={14} /> : agent === index && running ? <LoaderCircle size={14} className="spin" /> : <Circle size={12} />}</span>
          <div><strong>{role.name}</strong><small>{role.task}</small></div>
          <span className="agent-order">{String(index + 1).padStart(2, '0')}</span>
        </li>)}
      </ol>
    </details>
  </section>;
}
