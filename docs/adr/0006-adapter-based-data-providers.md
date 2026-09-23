# ADR-0006: Adapter Pattern for External Parcel/Zoning Data Providers

## Status
Accepted

## Context
The client explicitly required: "Do not hard-code one website's response format throughout the application. Put integration-specific logic behind a clear boundary and normalize the result into our internal data model." Massachusetts parcel/zoning data is fragmented across a statewide GIS source and many per-municipality systems with differing formats and reliability, and the client may add other states or sources later.

## Decision
Define one `ParcelDataProvider` interface (`lookupByAddress` / `lookupByParcelId`, returning a normalized `ProviderResult`). Each real data source (MassGIS, an individual municipality's assessor system, a future state or vendor) is implemented as its own adapter class behind this interface, registered in a provider registry keyed by municipality/state. Nothing outside the `parcels`/`zoning` modules ever sees a provider's raw response shape.

## Consequences
- Positive: adding a new source, replacing an unreliable one, or expanding to a second state is "write one new adapter class + register it," not a change to site creation, the data model, or the UI.
- Positive: each adapter call is independently wrapped with a timeout and try/catch, so one source's failure or format change can't propagate into an application crash — it degrades to a `source_unavailable` status on the affected fields (see the technical discovery package §7/§12) and the investigation continues with the rest.
- Negative: slightly more indirection than calling a provider's SDK/API directly from the business logic — considered a worthwhile, deliberate cost given the client's explicit requirement and the near-certainty that source coverage/format will change over the project's life.
- Direct implementation of the client's stated non-negotiable: normalize at the boundary, never let one source's shape leak into the core data model.
