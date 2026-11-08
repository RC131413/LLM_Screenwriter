import type { ApiActiveGeneration, ApiExecutionProgress, ApiGenerationProgress, ApiRunDetail } from '../../src/services/api';

const names: Record<string, string> = { archivist: 'Archiwista', director: 'Reżyser', scenarist: 'Scenarzysta', critic: 'Krytyk' };
const ids: Record<string, number> = { archivist: 1, director: 2, scenarist: 3, critic: 4 };

export function executionFixture(node: string, status = 'running', variant: 1 | 2 | 3 = 1, id = variant * 10 + ids[node]): ApiExecutionProgress {
  return { id, node_name: node, agent_name: names[node], status, variant_number: variant,
    started_at: new Date(Date.now() - 2000).toISOString(),
    finished_at: status === 'completed' ? new Date().toISOString() : null,
    duration_ms: status === 'completed' ? 2000 : null, error_message: '',
    review_status: node === 'critic' && status === 'completed' ? 'accepted' : null };
}

export function progressFixture(overrides: Partial<ApiGenerationProgress> = {}): ApiGenerationProgress {
  return { run_id: 60, status: 'running', variant_count: 1, percent: 0, completed_steps: 0, total_steps: 4,
    started_at: new Date(Date.now() - 2000).toISOString(), finished_at: null, total_duration_ms: null,
    error_message: '', agent_executions: [executionFixture('archivist')], ...overrides };
}

export function activeFixture(progress = progressFixture()): ApiActiveGeneration {
  const running = progress.agent_executions.findLast(row => row.status === 'running');
  return { scene_id: 20, generation_id: 'f64dbe6e-bd79-4e50-80c8-b4c8b241dbed',
    user_prompt: 'Anna otwiera list.', variant_count: progress.variant_count, progress,
    current_agent: running?.agent_name ?? null, variant_number: running?.variant_number ?? null };
}

export function runDetailFixture(progress: ApiGenerationProgress): ApiRunDetail {
  const time = new Date().toISOString();
  return { id: progress.run_id, request_id: 50, status: progress.status, langgraph_thread_id: '',
    started_at: progress.started_at, finished_at: progress.finished_at, total_duration_ms: progress.total_duration_ms,
    error_message: progress.error_message, run_metadata: { variant_count: progress.variant_count },
    created_at: time, updated_at: time, progress, variants: [],
    agent_executions: progress.agent_executions.map(agent => ({ ...agent, run_id: progress.run_id,
      input_payload: { variant_number: agent.variant_number }, output_payload: { review_status: agent.review_status },
      logs: {}, created_at: agent.started_at ?? time })),
  };
}
