import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ParcelScore, RankedParcel } from '../utils/useParcelScores';
import './ParcelScoringDialog.css';

export function ParcelScoringDialog({ parcel, score, onClose }: {
  parcel: RankedParcel; score: ParcelScore; onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const noteId = useId();
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  return createPortal(<div className="parcel-scoring-overlay" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} className="parcel-scoring-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={noteId}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
        if (event.key === 'Tab') {
          const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex="0"]');
          if (!controls?.length) return;
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}>
      <header className="parcel-scoring-header">
        <div><span className="parcel-scoring-eyebrow">Scoring details</span>
          <h2 id={titleId}>{parcel.address || parcel.parcel_id}</h2>
          <p>{parcel.town} · ID: {parcel.parcel_id}</p>
        </div>
        <button ref={closeButton} type="button" onClick={onClose} aria-label="Close scoring details">×</button>
      </header>
      <div className="parcel-scoring-body">
        <section className="parcel-scoring-summary" aria-label="Score summary">
          <div className="parcel-scoring-total-row">
            <div><h3>Calculated score</h3>
              <p>From recorded parcel data · As of {score.asOf}</p></div>
            <strong className="parcel-scoring-total">{score.score}<small>/100</small></strong>
          </div>
          <div className="parcel-scoring-metrics">
            <div><span>Site quality</span><strong>{score.site}<small>/40</small></strong></div>
            <div><span>Seller likelihood</span><strong>{score.seller}<small>/60</small></strong></div>
            <div><span>Deal blockers</span><strong>{score.deductions}<small> pts</small></strong></div>
          </div>
          <p id={noteId}>Site quality + seller likelihood − deal blockers, capped at 0–100. This is a research ranking, not a probability of sale.</p>
        </section>
        {(['site', 'seller', 'blocker'] as const).map(group => <section className="parcel-scoring-group" key={group}>
          <h3>{group === 'site' ? 'Site quality · up to 40 points' : group === 'seller' ? 'Seller likelihood · up to 60 points' : 'Deal blockers · deductions'}</h3>
          {score.factors.filter(f => f.group === group).map(factor => <div className="parcel-scoring-factor" key={factor.id}>
            <div className="parcel-scoring-factor-heading">
              <span>{factor.label}</span>
              <strong className={factor.points < 0 ? 'parcel-scoring-negative' : factor.points > 0 ? 'parcel-scoring-positive' : 'parcel-scoring-zero'}>
                {`${factor.points > 0 ? '+' : ''}${factor.points} pts`}
              </strong>
            </div>
            <p className="parcel-scoring-evidence">{factor.evidence}</p>
            {!factor.hasData && <p className="parcel-scoring-source-note">No supporting data for this factor; 0 points applied.</p>}
            <p className="parcel-scoring-rule">{factor.options.map(([points, label]) => `${label}: ${points > 0 ? '+' : ''}${points}`).join(' · ')}</p>
          </div>)}
        </section>)}
        <footer className="parcel-scoring-footer">
          <p>Calculated automatically using the scoring table and recorded data. Missing or unsupported factors contribute 0 points. No estimates or manual point adjustments are included.</p>
        </footer>
      </div>
    </div>
  </div>, document.body);
}
