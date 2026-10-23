export const API_BASE_URL = 'http://127.0.0.1:8000/api/';

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue }
export type ApiId = number;
export type HttpMethod = 'GET' | 'HEAD' | 'OPTIONS' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Page<T> { items: T[]; count: number }
export interface PaginationParams { limit?: number; offset?: number }
export interface CallOptions { signal?: AbortSignal }
export type ProjectCollection = 'all' | 'recent' | 'favorites' | 'archive' | 'trash';
export type ProjectAction = 'favorite' | 'unfavorite' | 'archive' | 'unarchive' | 'trash' | 'restore' | 'open';
export interface ProjectListParams extends PaginationParams { collection?: ProjectCollection; search?: string }
export interface SceneListParams extends PaginationParams { act_id?: ApiId }
export interface MessageResponse { detail: string }
export interface CsrfResponse { csrf_token: string }

interface Timestamped {
  id: ApiId;
  created_at: string;
  updated_at: string;
}

// API DTOs intentionally do not reuse the frontend's mock/editor data shapes.
export interface ApiProfile extends Timestamped {
  user_id: ApiId;
  display_name: string;
  avatar_url: string;
  preferred_language: string;
  writing_style_preferences: JsonObject;
  llm_preferences: JsonObject;
}

export interface ApiUser extends Timestamped {
  username: string;
  email: string;
  profile: ApiProfile;
}

export interface LoginInput { identifier: string; password: string }
export interface RegisterInput { username: string; email: string; password: string; password_confirm: string }
export interface UpdateAccountInput { username?: string }
export interface ChangePasswordInput { old_password: string; new_password: string; new_password_confirm: string }
export interface UpdateProfileInput { display_name?: string; avatar_url?: string; preferred_language?: 'pl' }
export interface WritingStylePreferences {
  stage_directions_style: 'concise_technical' | 'literary_descriptive';
  dialogue_tone: string;
  parentheticals: 'sparingly' | 'ignore';
}
export interface LlmPreferences {
  model_name: 'Bielik 11B (Lokalny)';
  temperature: number;
  max_tokens: number;
}
export interface ApiPreferences {
  writing_style_preferences: WritingStylePreferences;
  llm_preferences: LlmPreferences;
}
export interface PreferencesInput {
  writing_style_preferences?: Partial<WritingStylePreferences>;
  llm_preferences?: Partial<LlmPreferences>;
}

export interface ApiProject extends Timestamped {
  user_id: ApiId;
  title: string;
  logline: string;
  synopsis: string;
  genre: string;
  target_audience: string;
  screenplay_format: string;
  status: string;
  metadata: JsonObject;
}
export interface CreateProjectInput {
  title: string;
  logline?: string;
  synopsis?: string;
  genre?: string;
  target_audience?: string;
  screenplay_format?: string;
  status?: string;
  metadata?: JsonObject;
}
export type UpdateProjectInput = Partial<CreateProjectInput>;

export interface ApiAct extends Timestamped {
  project_id: ApiId;
  title: string;
  act_number: number;
  sort_order: number;
  summary: string;
  metadata: JsonObject;
}
export interface CreateActInput {
  act_number: number;
  title?: string;
  sort_order?: number;
  summary?: string;
  metadata?: JsonObject;
}
export type UpdateActInput = Partial<CreateActInput>;

export interface ApiCharacter extends Timestamped {
  project_id: ApiId;
  name: string;
  role: string;
  age: number | null;
  psychological_profile: string;
  appearance: string;
  backstory: string;
  goals: string;
  fears: string;
  voice_profile: JsonObject;
  memory_metadata: JsonObject;
}
export interface CreateCharacterInput {
  name: string;
  role?: string;
  age?: number | null;
  psychological_profile?: string;
  appearance?: string;
  backstory?: string;
  goals?: string;
  fears?: string;
  voice_profile?: JsonObject;
  memory_metadata?: JsonObject;
}
export type UpdateCharacterInput = Partial<CreateCharacterInput>;

export interface ApiCastMember {
  id: ApiId;
  scene_id: ApiId;
  character_id: ApiId;
  presence_type: string;
  notes: string;
  created_at: string;
}
export interface CreateCastMemberInput { character_id: ApiId; presence_type?: string; notes?: string }
export type UpdateCastMemberInput = Pick<CreateCastMemberInput, 'presence_type' | 'notes'>;

export interface ApiScene extends Timestamped {
  project_id: ApiId;
  act_id: ApiId;
  scene_number: number;
  sort_order: number;
  title: string;
  location_heading: string;
  time_of_day: string;
  content_text: string;
  ai_metadata: JsonObject;
  editor_metadata: JsonObject;
  cast_members: ApiCastMember[];
}
export interface CreateSceneInput {
  act_id: ApiId;
  scene_number: number;
  sort_order?: number;
  title?: string;
  location_heading?: string;
  time_of_day?: string;
  content_text?: string;
  ai_metadata?: JsonObject;
  editor_metadata?: JsonObject;
}
export type UpdateSceneInput = Partial<CreateSceneInput>;
export interface ApiWorkspace { project: ApiProject; acts: ApiAct[]; characters: ApiCharacter[]; scenes: ApiScene[] }

export interface GenerationParametersInput { temperature?: number; max_tokens?: number }
export interface CreatePromptInput { user_prompt: string; generation_parameters?: GenerationParametersInput | null }
export interface ApiPrompt {
  id: ApiId;
  scene_id: ApiId;
  user_prompt: string;
  system_prompt: string;
  context_snapshot: JsonObject;
  model_name: string;
  generation_parameters: JsonObject;
  created_at: string;
}
export interface ApiGenerationRun extends Timestamped {
  request_id: ApiId;
  status: string;
  langgraph_thread_id: string;
  started_at: string | null;
  finished_at: string | null;
  total_duration_ms: number | null;
  error_message: string;
  run_metadata: JsonObject;
}
export interface ApiAgentExecution {
  id: ApiId;
  run_id: ApiId;
  agent_name: string;
  node_name: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  input_payload: JsonObject;
  output_payload: JsonObject;
  logs: JsonObject;
  error_message: string;
  created_at: string;
}
export interface ApiSceneVariant {
  id: ApiId;
  run_id: ApiId;
  scene_id: ApiId;
  variant_number: number;
  title: string;
  generated_full_text: string;
  // Django Ninja serializes Decimal as a JSON string.
  critic_score: string | null;
  critic_feedback: string;
  critic_metadata: JsonObject;
  is_selected: boolean;
  created_at: string;
}
export interface SelectVariantInput { apply_to_scene?: boolean }
export interface ApiRunDetail extends ApiGenerationRun {
  agent_executions: ApiAgentExecution[];
  variants: ApiSceneVariant[];
}
export interface ApiStatistics {
  projects: number;
  acts: number;
  scenes: number;
  characters: number;
  generation_requests: number;
  generation_runs: number;
  completed_runs: number;
  variants: number;
  total_generation_duration_ms: number;
  prompt_activity: { date: string; count: number }[];
}

export interface ApiValidationIssue {
  loc: (string | number)[];
  msg: string;
  type?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class ApiError extends Error {
  readonly status: number;
  readonly data: unknown;
  readonly fieldErrors: Record<string, string[]>;

  constructor(status: number, data: unknown) {
    const detail = isRecord(data) ? data.detail : undefined;
    const issues = Array.isArray(detail)
      ? detail.filter(isRecord).map(issue => typeof issue.msg === 'string' ? issue.msg : '').filter(Boolean)
      : [];
    super(typeof detail === 'string' ? detail : issues.join('; ') || `API request failed (${status}).`);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.fieldErrors = {};
    if (isRecord(data) && isRecord(data.fields)) {
      for (const [field, errors] of Object.entries(data.fields)) {
        if (Array.isArray(errors) && errors.every(error => typeof error === 'string')) {
          this.fieldErrors[field] = errors;
        }
      }
    }
  }
}

export interface ApiRequestOptions extends Omit<RequestInit, 'method' | 'body' | 'credentials' | 'mode' | 'redirect'> {
  method?: HttpMethod;
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
}

function apiUrl(path: string, query?: ApiRequestOptions['query']): URL {
  const url = new URL(path.replace(/^\/+/, ''), API_BASE_URL);
  const base = new URL(API_BASE_URL);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new TypeError('API requests must stay within API_BASE_URL.');
  }
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
  }
  return url;
}

export function getCsrfTokenFromCookie(): string | null {
  if (typeof document === 'undefined') return null;
  for (const item of document.cookie.split(';')) {
    const cookie = item.trim();
    if (!cookie.startsWith('csrftoken=')) continue;
    try { return decodeURIComponent(cookie.slice('csrftoken='.length)) || null; }
    catch { return null; }
  }
  return null;
}

function waitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => {
      signal.removeEventListener('abort', abort);
      resolve(value);
    }, error => {
      signal.removeEventListener('abort', abort);
      reject(error);
    });
  });
}

let csrfBootstrap: Promise<CsrfResponse> | undefined;

export function initializeCsrf(options: CallOptions = {}): Promise<CsrfResponse> {
  options.signal?.throwIfAborted();
  // Share initial cookie creation so simultaneous first writes do not race.
  csrfBootstrap ??= apiRequest<CsrfResponse>('auth/csrf', { cache: 'no-store' })
    .then(data => {
      if (!data || typeof data.csrf_token !== 'string' || !data.csrf_token) {
        throw new ApiError(200, { detail: 'The API did not return a CSRF token.' });
      }
      return data;
    }).finally(() => { csrfBootstrap = undefined; });
  return waitWithSignal(csrfBootstrap, options.signal);
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method: requestedMethod = 'GET', body, query, headers: suppliedHeaders, ...init } = options;
  const method = requestedMethod.toUpperCase();
  const url = apiUrl(path, query);
  const headers = new Headers(suppliedHeaders);
  init.signal?.throwIfAborted();
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    let token = getCsrfTokenFromCookie();
    if (!token) {
      const bootstrap = await initializeCsrf({ signal: init.signal ?? undefined });
      // The JSON token also supports deployments where the API cookie is not JS-readable.
      token = getCsrfTokenFromCookie() ?? bootstrap.csrf_token;
    }
    headers.set('X-CSRFToken', token);
  }

  const response = await fetch(url.toString(), {
    ...init, method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'include', mode: 'cors', redirect: 'error',
  });
  if (response.ok && (response.status === 204 || response.status === 205 || method === 'HEAD')) {
    return undefined as T;
  }
  const text = await response.text();
  let data: unknown;
  try { data = JSON.parse(text); }
  catch {
    if (response.ok) throw new ApiError(response.status, { detail: 'The API returned invalid JSON.' });
    data = text;
  }
  if (!response.ok) throw new ApiError(response.status, data);
  return data as T;
}

function id(value: ApiId): string {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('API IDs must be positive safe integers.');
  return String(value);
}

export const authApi = {
  csrf: initializeCsrf,
  login: (data: LoginInput, options: CallOptions = {}) =>
    apiRequest<ApiUser>('auth/login', { ...options, method: 'POST', body: data }),
  register: (data: RegisterInput, options: CallOptions = {}) =>
    apiRequest<ApiUser>('auth/register', { ...options, method: 'POST', body: data }),
  logout: (options: CallOptions = {}) =>
    apiRequest<MessageResponse>('auth/logout', { ...options, method: 'POST' }),
};

export const accountApi = {
  get: (options: CallOptions = {}) => apiRequest<ApiUser>('users/me', options),
  update: (data: UpdateAccountInput, options: CallOptions = {}) =>
    apiRequest<ApiUser>('users/me', { ...options, method: 'PATCH', body: data }),
  changePassword: (data: ChangePasswordInput, options: CallOptions = {}) =>
    apiRequest<MessageResponse>('users/me/password', { ...options, method: 'POST', body: data }),
  getProfile: (options: CallOptions = {}) => apiRequest<ApiProfile>('users/me/profile', options),
  updateProfile: (data: UpdateProfileInput, options: CallOptions = {}) =>
    apiRequest<ApiProfile>('users/me/profile', { ...options, method: 'PATCH', body: data }),
  getPreferences: (options: CallOptions = {}) => apiRequest<ApiPreferences>('users/me/preferences', options),
  savePreferences: (data: PreferencesInput, options: CallOptions = {}) =>
    apiRequest<ApiPreferences>('users/me/preferences', { ...options, method: 'PUT', body: data }),
  getStatistics: (options: CallOptions = {}) => apiRequest<ApiStatistics>('users/me/statistics', options),
};

export const projectsApi = {
  list: (params: ProjectListParams = {}, options: CallOptions = {}) =>
    apiRequest<Page<ApiProject>>('projects', { ...options, query: { ...params } }),
  create: (data: CreateProjectInput, options: CallOptions = {}) =>
    apiRequest<ApiProject>('projects', { ...options, method: 'POST', body: data }),
  get: (projectId: ApiId, options: CallOptions = {}) => apiRequest<ApiProject>(`projects/${id(projectId)}`, options),
  update: (projectId: ApiId, data: UpdateProjectInput, options: CallOptions = {}) =>
    apiRequest<ApiProject>(`projects/${id(projectId)}`, { ...options, method: 'PATCH', body: data }),
  delete: (projectId: ApiId, options: CallOptions = {}) =>
    apiRequest<void>(`projects/${id(projectId)}`, { ...options, method: 'DELETE' }),
  action: (projectId: ApiId, action: ProjectAction, options: CallOptions = {}) =>
    apiRequest<ApiProject>(`projects/${id(projectId)}/actions/${encodeURIComponent(action)}`, { ...options, method: 'POST' }),
  workspace: (projectId: ApiId, options: CallOptions = {}) =>
    apiRequest<ApiWorkspace>(`projects/${id(projectId)}/workspace`, options),
};

export const actsApi = {
  list: (projectId: ApiId, params: PaginationParams = {}, options: CallOptions = {}) =>
    apiRequest<Page<ApiAct>>(`projects/${id(projectId)}/acts`, { ...options, query: { ...params } }),
  create: (projectId: ApiId, data: CreateActInput, options: CallOptions = {}) =>
    apiRequest<ApiAct>(`projects/${id(projectId)}/acts`, { ...options, method: 'POST', body: data }),
  get: (actId: ApiId, options: CallOptions = {}) => apiRequest<ApiAct>(`acts/${id(actId)}`, options),
  update: (actId: ApiId, data: UpdateActInput, options: CallOptions = {}) =>
    apiRequest<ApiAct>(`acts/${id(actId)}`, { ...options, method: 'PATCH', body: data }),
  delete: (actId: ApiId, options: CallOptions = {}) =>
    apiRequest<void>(`acts/${id(actId)}`, { ...options, method: 'DELETE' }),
};

export const charactersApi = {
  list: (projectId: ApiId, params: PaginationParams = {}, options: CallOptions = {}) =>
    apiRequest<Page<ApiCharacter>>(`projects/${id(projectId)}/characters`, { ...options, query: { ...params } }),
  create: (projectId: ApiId, data: CreateCharacterInput, options: CallOptions = {}) =>
    apiRequest<ApiCharacter>(`projects/${id(projectId)}/characters`, { ...options, method: 'POST', body: data }),
  get: (characterId: ApiId, options: CallOptions = {}) => apiRequest<ApiCharacter>(`characters/${id(characterId)}`, options),
  update: (characterId: ApiId, data: UpdateCharacterInput, options: CallOptions = {}) =>
    apiRequest<ApiCharacter>(`characters/${id(characterId)}`, { ...options, method: 'PATCH', body: data }),
  delete: (characterId: ApiId, options: CallOptions = {}) =>
    apiRequest<void>(`characters/${id(characterId)}`, { ...options, method: 'DELETE' }),
};

export const scenesApi = {
  list: (projectId: ApiId, params: SceneListParams = {}, options: CallOptions = {}) =>
    apiRequest<Page<ApiScene>>(`projects/${id(projectId)}/scenes`, { ...options, query: { ...params } }),
  create: (projectId: ApiId, data: CreateSceneInput, options: CallOptions = {}) =>
    apiRequest<ApiScene>(`projects/${id(projectId)}/scenes`, { ...options, method: 'POST', body: data }),
  get: (sceneId: ApiId, options: CallOptions = {}) => apiRequest<ApiScene>(`scenes/${id(sceneId)}`, options),
  update: (sceneId: ApiId, data: UpdateSceneInput, options: CallOptions = {}) =>
    apiRequest<ApiScene>(`scenes/${id(sceneId)}`, { ...options, method: 'PATCH', body: data }),
  delete: (sceneId: ApiId, options: CallOptions = {}) =>
    apiRequest<void>(`scenes/${id(sceneId)}`, { ...options, method: 'DELETE' }),
};

export const castApi = {
  list: (sceneId: ApiId, params: PaginationParams = {}, options: CallOptions = {}) =>
    apiRequest<Page<ApiCastMember>>(`scenes/${id(sceneId)}/cast`, { ...options, query: { ...params } }),
  create: (sceneId: ApiId, data: CreateCastMemberInput, options: CallOptions = {}) =>
    apiRequest<ApiCastMember>(`scenes/${id(sceneId)}/cast`, { ...options, method: 'POST', body: data }),
  get: (castId: ApiId, options: CallOptions = {}) => apiRequest<ApiCastMember>(`cast/${id(castId)}`, options),
  update: (castId: ApiId, data: UpdateCastMemberInput, options: CallOptions = {}) =>
    apiRequest<ApiCastMember>(`cast/${id(castId)}`, { ...options, method: 'PATCH', body: data }),
  delete: (castId: ApiId, options: CallOptions = {}) =>
    apiRequest<void>(`cast/${id(castId)}`, { ...options, method: 'DELETE' }),
};

export const promptsApi = {
  list: (sceneId: ApiId, params: PaginationParams = {}, options: CallOptions = {}) =>
    apiRequest<Page<ApiPrompt>>(`scenes/${id(sceneId)}/prompts`, { ...options, query: { ...params } }),
  create: (sceneId: ApiId, data: CreatePromptInput, options: CallOptions = {}) =>
    apiRequest<ApiPrompt>(`scenes/${id(sceneId)}/prompts`, { ...options, method: 'POST', body: data }),
  get: (promptId: ApiId, options: CallOptions = {}) => apiRequest<ApiPrompt>(`prompts/${id(promptId)}`, options),
  getRun: (promptId: ApiId, options: CallOptions = {}) => apiRequest<ApiRunDetail>(`prompts/${id(promptId)}/run`, options),
};

export const runsApi = {
  list: (sceneId: ApiId, params: PaginationParams = {}, options: CallOptions = {}) =>
    apiRequest<Page<ApiGenerationRun>>(`scenes/${id(sceneId)}/runs`, { ...options, query: { ...params } }),
  get: (runId: ApiId, options: CallOptions = {}) => apiRequest<ApiRunDetail>(`runs/${id(runId)}`, options),
};

export const agentExecutionsApi = {
  list: (runId: ApiId, params: PaginationParams = {}, options: CallOptions = {}) =>
    apiRequest<Page<ApiAgentExecution>>(`runs/${id(runId)}/agents`, { ...options, query: { ...params } }),
  get: (executionId: ApiId, options: CallOptions = {}) =>
    apiRequest<ApiAgentExecution>(`agent-executions/${id(executionId)}`, options),
};

// Generation records are server-managed: the backend exposes read/select, not CRUD.
export const variantsApi = {
  listForScene: (sceneId: ApiId, params: PaginationParams = {}, options: CallOptions = {}) =>
    apiRequest<Page<ApiSceneVariant>>(`scenes/${id(sceneId)}/variants`, { ...options, query: { ...params } }),
  listForRun: (runId: ApiId, params: PaginationParams = {}, options: CallOptions = {}) =>
    apiRequest<Page<ApiSceneVariant>>(`runs/${id(runId)}/variants`, { ...options, query: { ...params } }),
  get: (variantId: ApiId, options: CallOptions = {}) => apiRequest<ApiSceneVariant>(`variants/${id(variantId)}`, options),
  select: (variantId: ApiId, data: SelectVariantInput = {}, options: CallOptions = {}) =>
    apiRequest<ApiSceneVariant>(`variants/${id(variantId)}/select`, { ...options, method: 'POST', body: data }),
};

export const api = {
  auth: authApi, account: accountApi, projects: projectsApi, acts: actsApi,
  characters: charactersApi, scenes: scenesApi, cast: castApi, prompts: promptsApi,
  runs: runsApi, agentExecutions: agentExecutionsApi, variants: variantsApi,
};
