import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ApiSceneVariant } from '../services/api';

export function VariantCard({ variant, selected, disabled, onSelect, onPreview }: {
  variant: ApiSceneVariant; selected: boolean; disabled: boolean; onSelect: () => void; onPreview: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const reviewId = `variant-review-${variant.id}`;
  return <div className={`variant-item ${selected ? 'selected' : ''}`}>
    <label><input type="radio" name="scene-variant" disabled={disabled} checked={selected} onChange={onSelect} />
      <strong>{variant.title || `Wariant ${variant.variant_number}`}</strong>
    </label>
    <div className="variant-summary">
      <button type="button" className="variant-review-toggle" aria-expanded={expanded} aria-controls={reviewId}
        aria-label={`${expanded ? 'Zwiń' : 'Rozwiń'} ocenę wariantu ${variant.variant_number}`} onClick={() => setExpanded(value => !value)}>
        <span>{variant.critic_score !== null ? `Ocena: ${variant.critic_score}` : 'Brak oceny'}</span><ChevronDown size={12} />
      </button>
      <button type="button" className="text-button" onClick={onPreview}>Podgląd tekstu<ChevronRight size={13} /></button>
    </div>
    <div id={reviewId} className="variant-review-body" role="region" aria-label={`Ocena Krytyka wariantu ${variant.variant_number}`} hidden={!expanded}>
      <p>{variant.critic_feedback || 'Brak oceny krytyka.'}</p>
      {variant.critic_metadata.review_status === 'revision_limit_reached' && <p className="small">Wariant nadal wymaga poprawek.</p>}
      {variant.critic_metadata.review_status === 'context_limit_reached' && <p className="small">Automatyczna poprawka przekracza limit kontekstu. Zachowano wariant i uwagi Krytyka; tekst nadal wymaga poprawek.</p>}
    </div>
  </div>;
}
