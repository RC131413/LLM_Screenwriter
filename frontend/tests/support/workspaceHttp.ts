import type { ApiWorkspace, UpdateSceneInput } from '../../src/services/api';
import { workspaceFixture } from './fixtures';
import { interceptHttp, jsonResponse } from './http';
import type { HttpCall } from './http';

export function workspaceHttp(override?: (call: HttpCall, workspace: ApiWorkspace) => Response | Promise<Response> | undefined) {
  const workspace = workspaceFixture();
  const http = interceptHttp(call => {
    const overridden = override?.(call, workspace);
    if (overridden !== undefined) return overridden;
    if (call.path === '/projects' && call.method === 'GET') {
      const collection = call.url.searchParams.get('collection');
      return jsonResponse({ items: collection === 'all' ? [workspace.project] : [], count: collection === 'all' ? 1 : 0 });
    }
    if (call.path === '/projects/1/workspace') return jsonResponse(workspace);
    if (call.path === '/scenes/20' && call.method === 'PATCH') {
      Object.assign(workspace.scenes[0], call.body as UpdateSceneInput);
      return jsonResponse(workspace.scenes[0]);
    }
    return undefined;
  });
  return { ...http, workspace };
}
