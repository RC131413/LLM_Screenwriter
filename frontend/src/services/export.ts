import { projectsApi } from './api';
import type { ScreenplayExportFormat } from './api';
import { toProject } from './workspaceData';

export type ExportFormat = ScreenplayExportFormat | 'json';

export async function exportProject(projectId: string, format: ExportFormat) {
  let file;
  if (format === 'json') {
    // Read after flush as well: never download an outdated render's snapshot.
    const project = toProject(await projectsApi.workspace(Number(projectId)));
    file = {
      blob: new Blob([JSON.stringify(project, null, 2)], { type: 'application/json;charset=utf-8' }),
      filename: `${project.title.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase() || 'projekt'}.json`,
    };
  } else {
    file = await projectsApi.export(Number(projectId), format);
  }
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  document.body.append(link);
  try { link.click(); }
  finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
