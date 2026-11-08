import type { ApiExecutionProgress, ApiGenerationProgress, ApiRunDetail } from './api';

const NAMES: Record<string, string> = { archivist: 'Archiwista', director: 'Reżyser', scenarist: 'Scenarzysta', critic: 'Krytyk' };
export interface AgentRow {
  key: string;
  name: string;
  node: string;
  variant: number;
  revision: number;
  execution?: ApiExecutionProgress;
}

export function storedProgress(run: ApiRunDetail | null): ApiGenerationProgress | null {
  if (!run) return null;
  if (run.progress) return run.progress;
  // Compatibility with run history loaded from an older API response.
  const count = Number(run.run_metadata?.variant_count);
  const variantCount = count === 2 || count === 3 ? count : 1;
  return { run_id: run.id, status: run.status, variant_count: variantCount,
    percent: run.status === 'completed' ? 100 : 0,
    completed_steps: run.status === 'completed' ? 1 + 3 * variantCount : 0, total_steps: 1 + 3 * variantCount,
    started_at: run.started_at, finished_at: run.finished_at, total_duration_ms: run.total_duration_ms,
    error_message: run.error_message,
    agent_executions: run.agent_executions.map(agent => ({ ...agent,
      variant_number: agent.input_payload?.variant_number === 2 ? 2 : agent.input_payload?.variant_number === 3 ? 3 : 1,
      review_status: typeof agent.output_payload?.review_status === 'string' ? agent.output_payload.review_status : null,
    })),
  };
}

export function agentRows(executions: ApiExecutionProgress[], count: number, includeWaiting: boolean): AgentRow[] {
  const attempts = new Map<string, number>();
  const actual = executions.map(execution => {
    const key = `${execution.variant_number}:${execution.node_name}`;
    const previous = attempts.get(key) ?? 0;
    attempts.set(key, previous + 1);
    return { key: `execution-${execution.id}`, name: execution.agent_name, node: execution.node_name,
      variant: execution.variant_number, revision: ['scenarist', 'critic'].includes(execution.node_name) ? previous : 0, execution };
  });
  if (!includeWaiting) return actual;
  const waiting = (node: string, variant: number, revision = 0): AgentRow => ({
    key: `waiting-${node}-${variant}-${revision}`, node, name: NAMES[node], variant, revision,
  });
  const archive = actual.filter(row => row.node === 'archivist');
  const rows: AgentRow[] = archive.length ? [...archive] : [waiting('archivist', 1)];
  for (let variant = 1; variant <= count; variant++) {
    const recorded = actual.filter(row => row.node !== 'archivist' && row.variant === variant);
    rows.push(...recorded);
    const last = recorded.at(-1);
    if (!last) rows.push(waiting('director', variant), waiting('scenarist', variant), waiting('critic', variant));
    else if (last.node === 'director') rows.push(waiting('scenarist', variant), waiting('critic', variant));
    else if (last.node === 'scenarist') rows.push(waiting('critic', variant, last.revision));
    else if (last.node === 'critic' && last.execution?.review_status === 'revision_requested') {
      rows.push(waiting('scenarist', variant, last.revision + 1), waiting('critic', variant, last.revision + 1));
    }
  }
  return rows;
}

export function elapsedTime(execution: ApiExecutionProgress | undefined, now: number, ticking: boolean): string {
  if (!execution) return '';
  const start = Date.parse(execution.started_at ?? '');
  const milliseconds = ticking && execution.status === 'running' && Number.isFinite(start)
    ? Math.max(0, now - start) : execution.duration_ms;
  if (milliseconds == null) return '';
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 60000) return `${(milliseconds / 1000).toFixed(1).replace('.', ',')} s`;
  return `${Math.floor(milliseconds / 60000)} min ${Math.floor(milliseconds % 60000 / 1000)} s`;
}
