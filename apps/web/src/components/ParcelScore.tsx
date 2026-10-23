import type { ParcelScore } from '../utils/useParcelScores';
import './ParcelScore.css';

export function ScoreBadge({ score, onClick }: { score?: ParcelScore; onClick?: () => void }) {
  if (!score) return null;
  const label = `Score ${score.score} out of 100`;
  const title = `Calculated from source data: ${score.site}/40 site + ${score.seller}/60 seller ${score.deductions} deductions.`;
  const content = <>{score.score}<span>/100</span></>;
  return onClick ? <button type="button" className="parcel-score-badge" aria-label={`View scoring details: ${label}`} aria-haspopup="dialog" title={title}
    onKeyDown={event => event.stopPropagation()}
    onClick={event => { event.stopPropagation(); onClick(); }}>{content}</button> :
    <span className="parcel-score-badge" aria-label={label} title={title}>{content}</span>;
}
