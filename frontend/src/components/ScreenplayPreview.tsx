import type { ApiSceneVariant } from '../services/api';
import { sceneBlocks } from '../services/workspaceData';

export function ScreenplayPreview({ variant }: { variant: ApiSceneVariant }) {
  const blocks = sceneBlocks(variant.critic_metadata, variant.generated_full_text, `variant-${variant.id}`);
  return <div className="screenplay-preview">{blocks.map(block =>
    <p key={block.id} className={`screenplay-preview-block ${block.type}`}>{block.text}</p>,
  )}</div>;
}
