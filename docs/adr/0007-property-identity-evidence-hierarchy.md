# ADR-0007: Property-Identity Evidence Hierarchy

## Status
Accepted

## Context
Batch validation against 15 real Maintenance Depots records exposed a specific failure mode in the original coordinate-matching scoring: a candidate 97% confident and *wrong* (Tewksbury facility 81 — coordinate landed 11m from an unrelated parcel on a different street than the depot's recorded address) and an 89% confident *wrong* match (Buckland facility 3 — a closer, point-in-parcel-contained candidate on "Creamery Lane" outranked the correct, farther, non-contained candidate on "Creamery Ave"). Both cases shared a root cause: distance and point-in-parcel containment were weighted as if they were identity evidence, when they are only ever LOCATION evidence — a GPS coordinate can sit inside the wrong assessor parcel (a neighboring lot, a shared driveway, an imprecise field-collected point) without that parcel being the intended property.

The client's principle, stated directly during review:

> "Spatial proximity identifies the location; address/property evidence identifies the property."

This needed to become an explicit, enforced rule in the scoring code — not an implementation comment that could silently erode as new signals were added.

## Decision
Signals are classified into three tiers, and the scoring/evidence code enforces two hard rules derived from that hierarchy:

**Strong** — capable of establishing identity on their own or nearly so
- Exact parcel reference match (`parcelIdMatch`)
- Exact house number + street match (`addressSimilarity` at 1.0, or `houseNumberMatch` + `streetSuffixMatch` both true)
- A human's explicit confirmation (outside the scoring formula entirely — see below)

**Medium** — meaningfully corroborates identity, not sufficient alone
- Street base-name similarity (`locationTextSimilarity`)
- Municipality match
- A house-number or street-suffix match considered independently

**Supporting** — describes LOCATION, not IDENTITY
- Point-in-parcel containment (`pointInParcel`)
- Centroid distance (`distanceMeters` / `distanceScore`)
- A free-text location description's derived clues

Enforced rules:

1. **No signal from the Supporting tier, alone or combined with other Supporting-tier signals, can push a candidate into the "high" confidence band.** If a candidate's ENTIRE evidence is distance + containment + municipality — no house number, no street-name clue, no full address, no parcel ID — confidence is capped below "high" regardless of how tight the coordinate match is (`NO_ADDRESS_CORROBORATION_CONFIDENCE_CAP`, `scoring.ts`). This is "insufficient evidence," flagged `lowCorroboration`.

2. **A genuine contradiction in Medium-tier evidence caps confidence regardless of how strong the Supporting-tier evidence is.** A mismatched house number or street suffix on a candidate that is otherwise spatially strong (contained, very close) is not allowed to average out to a high score just because the spatial weight is large — it's capped (`ADDRESS_CONTRADICTION_CONFIDENCE_CAP`), flagged `addressEvidenceConflict`, and surfaced as "evidence conflict, manual verification required." This is "contradicted evidence," a different and more serious situation than merely missing evidence, and is deliberately capped to the same value as cross-candidate `conflictDetected` (both mean "evidence disagrees").

Neither rule is implemented by re-tuning the underlying signal weights — weights describe how signals combine when they agree; these two rules are post-hoc ceilings applied after the weighted average, so they hold regardless of future weight changes.

**Human confirmation is not part of this hierarchy at all** — it's the terminal step after every automated signal, at every confidence level, including a hypothetical 100%. No signal or combination of signals in this ADR bypasses it (docs/02 §2.2, unchanged by this decision).

## Consequences
- Positive: a 97%+ confidence candidate can no longer exist without either exact identity evidence or a human's decision — the Tewksbury pattern (97% wrong) cannot recur under any future data, not just the specific record that exposed it.
- Positive: the two caps are named, documented constants (`scoring.ts`) — changing the threshold is a deliberate, visible, one-line decision, not weight arithmetic someone has to re-derive.
- Negative: a correct match resting solely on Supporting-tier evidence (no house number or street clue available in the source data at all) will show as capped/`lowCorroboration` even when it happens to be right — this is intentional (the client's explicit instruction: "coordinates alone should never produce a high-confidence property identity"), but means confidence numbers for sparse-input records read lower than a naive distance-only score would suggest, even when those numbers are the honest ones.
- Direct implementation of the client's explicit post-Buckland-review instruction; supersedes the informal "no single signal proves an address" comment in `scoring.ts` (docs/02 §2.1) with an enforced structural rule.
