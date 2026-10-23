import './PropertyRecords.css';

export function PropertyRecords({ openMortgage, leaseEasementRestriction }: {
  openMortgage?: string | null;
  leaseEasementRestriction?: string | null;
}) {
  return <dl className="property-records">
    <div>
      <dt>Open mortgage</dt>
      <dd>{openMortgage?.trim() || 'Not provided in the source record'}</dd>
    </div>
    <div>
      <dt>Leases, easements &amp; restrictions</dt>
      <dd>{leaseEasementRestriction?.trim() || 'Not provided in the source record'}</dd>
    </div>
  </dl>;
}
