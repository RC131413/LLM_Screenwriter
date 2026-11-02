import type { ApiSceneVariant } from '../services/api';
import { sceneBlocks } from '../services/workspaceData';
import { formatSceneHeading } from '../services/sceneHeading';

export function ScreenplayPreview({ variant }: { variant: ApiSceneVariant }) {
  const blocks = sceneBlocks(variant.critic_metadata, variant.generated_full_text, `variant-${variant.id}`);
  const heading = variant.critic_metadata.heading;
  const headingText = heading && typeof heading === 'object' && !Array.isArray(heading) &&
    typeof heading.location_heading === 'string' && typeof heading.time_of_day === 'string'
    ? formatSceneHeading(heading.location_heading, heading.time_of_day) : '';
  return <div className="screenplay-preview">{headingText && <p className="screenplay-preview-heading">{headingText}</p>}{blocks.map(block =>
    <p key={block.id} className={`screenplay-preview-block ${block.type}`}>{block.text}</p>,
  )}</div>;
}
