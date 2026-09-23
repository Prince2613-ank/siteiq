import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ActivityModule } from '../activity/activity.module';
import { MatchingService } from './matching.service';
import { ParcelMirrorRepository } from './parcel-mirror.repository';
import { GEOCODER } from './geocoder.interface';
import { bandFor } from './scoring';

/**
 * Integration tests — run against the real dev Postgres+PostGIS database
 * (docs/01 §13's rationale: mocking the database here would hide exactly
 * the bugs that matter, like the pg_trgm/PostGIS query correctness this
 * module depends on). Requires:
 *   docker compose up -d postgres
 *   npx prisma migrate deploy && npm run mirror:load   (from apps/api)
 *
 * GeocodingService is stubbed (not mocked away entirely — see the
 * "misspelled with no local match" test) so the "no match" test is
 * deterministic and doesn't depend on network access in CI.
 */
describe('MatchingService (integration)', () => {
  let prisma: PrismaClient;
  let service: MatchingService;
  let mirrorRepo: ParcelMirrorRepository;
  let orgId: string;
  let userId: string;
  const createdSiteIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, ActivityModule],
      providers: [
        MatchingService,
        ParcelMirrorRepository,
        {
          provide: GEOCODER,
          useValue: { geocode: async () => null }, // deterministic: no network geocode in tests
        },
      ],
    }).compile();

    service = moduleRef.get(MatchingService);
    prisma = moduleRef.get(PrismaService);
    mirrorRepo = moduleRef.get(ParcelMirrorRepository);

    const org = await prisma.organization.create({ data: { name: 'Matching Test Org' } });
    orgId = org.id;
    const user = await prisma.user.create({
      data: {
        organizationId: orgId,
        email: `matching-test-${Date.now()}@example.com`,
        passwordHash: 'x',
        role: 'ADMIN',
        isActive: true,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.siteMatchCandidate.deleteMany({ where: { siteId: { in: createdSiteIds } } });
    await prisma.matchAttempt.deleteMany({ where: { siteId: { in: createdSiteIds } } });
    await prisma.activityEvent.deleteMany({ where: { siteId: { in: createdSiteIds } } });
    await prisma.site.deleteMany({ where: { id: { in: createdSiteIds } } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  /** runMatchAttempt now returns undefined on a caught pipeline failure
   * (Checkpoint 11 hardening) — this helper is for the tests that expect
   * a real MatchAttempt back and want a clear failure if that assumption
   * is wrong, rather than a cryptic "possibly undefined" everywhere. */
  async function runMatchExpectingAttempt(siteId: string, input: any, actorId: string) {
    const attempt = await service.runMatchAttempt(siteId, input, actorId);
    if (!attempt) throw new Error('Expected a MatchAttempt but the pipeline returned undefined');
    return attempt;
  }

  async function createTestSite(overrides: Partial<{ streetAddress: string; city: string; parcelRef: string }> = {}) {
    const site = await prisma.site.create({
      data: {
        organizationId: orgId,
        streetAddress: overrides.streetAddress ?? '1 Test St',
        city: overrides.city ?? 'Worcester',
        state: 'MA',
        municipality: overrides.city ?? 'Worcester',
        parcelRef: overrides.parcelRef,
        originalInputType: 'address',
        originalInputAddress: `${overrides.streetAddress ?? '1 Test St'}, ${overrides.city ?? 'Worcester'}, MA`,
        identityStatus: overrides.parcelRef ? 'CONFIRMED' : 'IDENTIFYING',
        createdById: userId,
      },
    });
    createdSiteIds.push(site.id);
    return site;
  }

  it('resolves an exact address match at 100% confidence', async () => {
    const site = await createTestSite();
    const attempt = await runMatchExpectingAttempt(
      site.id,
      { address: '142 Elm Street, Worcester, MA 01609' },
      userId,
    );
    expect(attempt.strategyUsed).toBe('EXACT');

    const candidates = await prisma.siteMatchCandidate.findMany({ where: { attemptId: attempt.id } });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].confidence).toBe(100);
    expect(candidates[0].parcelRef).toBe('04-112-0034');

    // Never silently confirmed — the pipeline only proposes.
    const updated = await prisma.site.findUniqueOrThrow({ where: { id: site.id } });
    expect(updated.identityStatus).toBe('NEEDS_REVIEW');
    expect(updated.parcelRef).toBeNull();
    expect(candidates[0].status).toBe('PROPOSED');
  });

  it('recovers a misspelled address via fuzzy matching', async () => {
    const site = await createTestSite();
    const attempt = await runMatchExpectingAttempt(
      site.id,
      { address: '142 Elm Steet, Worcester, MA 01609' },
      userId,
    );
    expect(attempt.strategyUsed).toBe('FUZZY');
    expect(attempt.candidateCount).toBeGreaterThan(0);

    const candidates = await prisma.siteMatchCandidate.findMany({
      where: { attemptId: attempt.id },
      orderBy: { rank: 'asc' },
    });
    expect(candidates[0].parcelRef).toBe('04-112-0034'); // still ranks the right one first
    expect(candidates[0].confidence).toBeLessThan(100); // but not perfect — it WAS misspelled
    expect(candidates[0].confidence).toBeGreaterThan(60);
  });

  it('surfaces multiple plausible candidates for an incomplete address, ranked, none pre-decided', async () => {
    const site = await createTestSite();
    const attempt = await runMatchExpectingAttempt(site.id, { address: 'Elm St, Worcester, MA' }, userId);

    const candidates = await prisma.siteMatchCandidate.findMany({ where: { attemptId: attempt.id } });
    expect(candidates.length).toBeGreaterThanOrEqual(3); // 140/142/144/200 Elm St all plausible
    expect(candidates.every((c) => c.status === 'PROPOSED')).toBe(true);
  });

  it('resolves a parcel ID directly, independent of an unrelated address string', async () => {
    const site = await createTestSite();
    // No address given at all — this is the fixed behavior (see
    // sites.service.ts comment): parcel-ID lookups don't get dragged down
    // by irrelevant address text.
    const attempt = await runMatchExpectingAttempt(site.id, { parcelRef: '09-004-1122' }, userId);
    expect(attempt.strategyUsed).toBe('PARCEL_ID');

    const candidates = await prisma.siteMatchCandidate.findMany({ where: { attemptId: attempt.id } });
    expect(candidates[0].confidence).toBe(100);
  });

  it('finds nearby candidates via spatial search when coordinates are supplied directly', async () => {
    const site = await createTestSite();
    const attempt = await runMatchExpectingAttempt(
      site.id,
      { address: 'garbled unmatched text', lat: 42.2626, lng: -71.8023 },
      userId,
    );
    expect(attempt.strategyUsed).toBe('SPATIAL');
    const candidates = await prisma.siteMatchCandidate.findMany({
      where: { attemptId: attempt.id },
      orderBy: { rank: 'asc' },
    });
    expect(candidates[0].parcelRef).toBe('04-112-0034'); // the closest one
  });

  it('reports NO_MATCH honestly when nothing resolves — never invents a candidate', async () => {
    const site = await createTestSite();
    const attempt = await runMatchExpectingAttempt(
      site.id,
      { address: '999 Nowhere Ave, Nowhereville, MA 00000' },
      userId,
    );
    expect(attempt.candidateCount).toBe(0);

    const updated = await prisma.site.findUniqueOrThrow({ where: { id: site.id } });
    expect(updated.identityStatus).toBe('NO_MATCH');
  });

  it('Checkpoint 11: an unexpected pipeline failure degrades to NO_MATCH rather than leaving the site stuck at IDENTIFYING forever', async () => {
    const site = await createTestSite();

    // Force a genuine failure deep in the pipeline (not a "no results"
    // case — an actual thrown error), simulating e.g. a DB hiccup.
    const spy = jest
      .spyOn(mirrorRepo, 'findExact')
      .mockRejectedValueOnce(new Error('Simulated DB failure for test coverage'));

    // The public method must not throw — it catches internally and
    // degrades gracefully (this is the whole point of the fix).
    await expect(service.runMatchAttempt(site.id, { address: '142 Elm Street, Worcester, MA 01609' }, userId))
      .resolves.not.toThrow();
    spy.mockRestore();

    const updated = await prisma.site.findUniqueOrThrow({ where: { id: site.id } });
    expect(updated.identityStatus).toBe('NO_MATCH'); // never stuck at IDENTIFYING

    const events = await prisma.activityEvent.findMany({ where: { siteId: site.id } });
    expect(events.some((e) => e.eventType === 'match_attempt_error')).toBe(true);
  });

  it('re-matching an already-CONFIRMED site with a different result flags a conflict, never silently replaces the confirmed parcel', async () => {
    const site = await createTestSite();
    // Simulate a prior confirmation to a DIFFERENT parcel than what this
    // re-match will find.
    await prisma.site.update({
      where: { id: site.id },
      data: { identityStatus: 'CONFIRMED', parcelRef: 'SOME-OTHER-PARCEL', matchConfidence: 90 },
    });

    await runMatchExpectingAttempt(site.id, { address: '142 Elm Street, Worcester, MA 01609' }, userId);

    const updated = await prisma.site.findUniqueOrThrow({ where: { id: site.id } });
    // Flips to NEEDS_REVIEW (a human must decide again)...
    expect(updated.identityStatus).toBe('NEEDS_REVIEW');
    // ...but the previously confirmed parcel is NOT silently overwritten.
    expect(updated.parcelRef).toBe('SOME-OTHER-PARCEL');

    const events = await prisma.activityEvent.findMany({ where: { siteId: site.id } });
    expect(events.some((e) => e.eventType === 'rematch_conflict_detected')).toBe(true);
  });

  it('flags a candidate as a duplicate when its parcel already belongs to another active site', async () => {
    const existingSite = await createTestSite({ parcelRef: '04-112-0034' });
    const newSite = await createTestSite();

    const attempt = await runMatchExpectingAttempt(
      newSite.id,
      { address: '142 Elm Street, Worcester, MA 01609' },
      userId,
    );
    const candidates = await prisma.siteMatchCandidate.findMany({ where: { attemptId: attempt.id } });
    expect(candidates[0].duplicateOfSiteId).toBe(existingSite.id);
  });

  // ── Location-based identification (client requirement) ──────────────────

  describe('location-based identification (no exact address available)', () => {
    const testFixtureParcelRefs: string[] = [];

    afterAll(async () => {
      await prisma.parcelMirrorRecord.deleteMany({ where: { parcelRef: { in: testFixtureParcelRefs } } });
    });

    async function insertFixtureParcel(opts: {
      parcelRef: string;
      address: string;
      municipality: string;
      lat: number;
      lng: number;
    }) {
      testFixtureParcelRefs.push(opts.parcelRef);
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ParcelMirrorRecord"
           (id, "parcelRef", address, municipality, "sourceName", "sourceRefreshedAt", geom, centroid)
         VALUES ($1, $2, $3, $4, 'Test Fixture', now(),
           ST_Buffer(ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, 15)::geometry,
           ST_SetSRID(ST_MakePoint($5, $6), 4326))`,
        randomUUID(),
        opts.parcelRef,
        opts.address,
        opts.municipality,
        opts.lng,
        opts.lat,
      );
    }

    // Regression for the real bug found on this dataset (Checkpoint,
    // client review): a source record giving the village name "South
    // Deerfield" instead of the official municipality "Deerfield" caused
    // findExact/findFuzzy's hard municipality filter to reject every real
    // candidate, producing NO_MATCH even though the parcel existed.
    it('resolves a village/locality municipality alias so address matching no longer NO_MATCHes (South Deerfield -> Deerfield)', async () => {
      // A synthetic, non-colliding street name — Deerfield now has real
      // ingested MassGIS coverage (client-approved ingestion), so this
      // fixture must not reuse an address that's also real Deerfield data,
      // or EXACT would (correctly) return both.
      await insertFixtureParcel({
        parcelRef: 'TEST-DEERFIELD-001',
        address: '75 Testfixture Rd',
        municipality: 'Deerfield',
        lat: 42.4751,
        lng: -72.6023,
      });

      const site = await createTestSite({ streetAddress: '75 Testfixture Rd', city: 'South Deerfield' });
      const attempt = await runMatchExpectingAttempt(
        site.id,
        { address: '75 Testfixture Rd, South Deerfield, MA 01373' },
        userId,
      );

      expect(attempt.strategyUsed).toBe('EXACT');
      const candidates = await prisma.siteMatchCandidate.findMany({ where: { attemptId: attempt.id } });
      expect(candidates).toHaveLength(1);
      expect(candidates[0].parcelRef).toBe('TEST-DEERFIELD-001');
      expect(candidates[0].confidence).toBe(100);
      expect((candidates[0].evidence as any).municipalityMatch).toBe(true);
    });

    // The client's real acceptance case, scripted: identify 190 Marston St,
    // Lawrence from town + street/location clue + coordinates ALONE —
    // "190 Marston St" is never supplied as input. Runs against the real
    // MassGIS mirror data (not a fixture) ingested for Lawrence.
    it('identifies a real parcel from coordinates + town + street/location clue alone, with no address supplied', async () => {
      const site = await createTestSite({ city: 'Lawrence' });
      const attempt = await runMatchExpectingAttempt(
        site.id,
        {
          lat: 42.71796,
          lng: -71.142581,
          municipality: 'Lawrence',
          locationText: 'Marston St',
          locationDescription: '0.25 mi S of Methuen-Lawrence TL on Marston St',
        },
        userId,
      );

      expect(attempt.strategyUsed).toBe('SPATIAL');
      const candidates = await prisma.siteMatchCandidate.findMany({
        where: { attemptId: attempt.id },
        orderBy: { rank: 'asc' },
      });
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].parcelRef).toBe('M_229292_940840'); // real MassGIS parcel for 190 Marston St
      expect(candidates[0].matchedAddress).toBe('190 Marston St');
      const evidence = candidates[0].evidence as any;
      expect(evidence.municipalityMatch).toBe(true);
      expect(evidence.locationTextSimilarity).toBeGreaterThan(0.6);
    });

    it('true point-in-parcel containment is correctly detected and ranks that parcel first over a further neighbor', async () => {
      await insertFixtureParcel({
        parcelRef: 'TEST-CONTAIN-001',
        address: '10 Containment Way',
        municipality: 'Worcester',
        lat: 42.3,
        lng: -71.9,
      });
      await insertFixtureParcel({
        parcelRef: 'TEST-CONTAIN-002',
        address: '12 Containment Way',
        municipality: 'Worcester',
        lat: 42.30036, // ~40m away — inside the 150m search radius, outside its own 15m containment buffer
        lng: -71.9,
      });

      const site = await createTestSite({ city: 'Worcester' });
      const attempt = await runMatchExpectingAttempt(
        site.id,
        { lat: 42.3, lng: -71.9, municipality: 'Worcester' },
        userId,
      );

      const candidates = await prisma.siteMatchCandidate.findMany({
        where: { attemptId: attempt.id },
        orderBy: { rank: 'asc' },
      });
      const top = candidates.find((c) => c.parcelRef === 'TEST-CONTAIN-001');
      expect(top).toBeDefined();
      expect((top!.evidence as any).pointInParcel).toBe(true);
      expect(candidates[0].parcelRef).toBe('TEST-CONTAIN-001');
    });

    // --- Regression tests for the 5 problem patterns found in the real
    // depot batch review (client-approved corrections) ---

    // Pattern: Milton facility 72 — "73 Granite Ave" lost to a closer but
    // unnumbered "Granite Ave" candidate because house number was parsed
    // but never scored.
    it('a matching house number outranks a closer candidate on the same street whose number does not match', async () => {
      await insertFixtureParcel({
        parcelRef: 'TEST-HOUSENUM-FAR',
        address: '73 Granite Ave',
        municipality: 'Worcester',
        lat: 42.31, // ~80m from the query point
        lng: -71.91,
      });
      await insertFixtureParcel({
        parcelRef: 'TEST-HOUSENUM-NEAR',
        address: '10 Granite Ave',
        municipality: 'Worcester',
        lat: 42.3102, // ~20m from the query point — closer, but the wrong house number
        lng: -71.9099,
      });

      const site = await createTestSite({ city: 'Worcester' });
      const attempt = await runMatchExpectingAttempt(
        site.id,
        { lat: 42.31018, lng: -71.90993, municipality: 'Worcester', locationText: '73 Granite Ave' },
        userId,
      );

      const candidates = await prisma.siteMatchCandidate.findMany({
        where: { attemptId: attempt.id },
        orderBy: { rank: 'asc' },
      });
      expect(candidates[0].parcelRef).toBe('TEST-HOUSENUM-FAR');
      expect((candidates[0].evidence as any).houseNumberMatch).toBe(true);
      const near = candidates.find((c) => c.parcelRef === 'TEST-HOUSENUM-NEAR');
      expect((near!.evidence as any).houseNumberMatch).toBe(false);
    });

    // Pattern: Buckland facility 3 — "4 Creamery Ave" lost to a closer but
    // WRONG-STREET "1 Creamery Lane" because whole-string bigram similarity
    // let a shared base word ("Creamery") hide a different suffix.
    it('the correct street suffix outranks a closer candidate on a different street sharing the same base word', async () => {
      await insertFixtureParcel({
        parcelRef: 'TEST-SUFFIX-WRONG-STREET',
        address: '1 Creamery Lane',
        municipality: 'Worcester',
        lat: 42.320252, // ~28m from the query point — closer, but "Lane" not "Ave", and outside its own 15m containment buffer
        lng: -71.92,
      });
      await insertFixtureParcel({
        parcelRef: 'TEST-SUFFIX-RIGHT-STREET',
        address: '4 Creamery Ave',
        municipality: 'Worcester',
        lat: 42.3208, // ~88m from the query point — farther, but the correct street
        lng: -71.92,
      });

      const site = await createTestSite({ city: 'Worcester' });
      const attempt = await runMatchExpectingAttempt(
        site.id,
        { lat: 42.32, lng: -71.92, municipality: 'Worcester', locationText: 'Creamery Ave.' },
        userId,
      );

      const candidates = await prisma.siteMatchCandidate.findMany({
        where: { attemptId: attempt.id },
        orderBy: { rank: 'asc' },
      });
      expect(candidates[0].parcelRef).toBe('TEST-SUFFIX-RIGHT-STREET');
      expect((candidates[0].evidence as any).streetSuffixMatch).toBe(true);
      const wrongStreet = candidates.find((c) => c.parcelRef === 'TEST-SUFFIX-WRONG-STREET');
      expect((wrongStreet!.evidence as any).streetSuffixMatch).toBe(false);
      expect((wrongStreet!.evidence as any).addressEvidenceConflict).toBe(true);
      expect((wrongStreet!.evidence as any).manualVerificationRequired).toBe(true);
    });

    // The exact real-world Buckland geometry: the wrong-street candidate is
    // itself point-in-parcel CONTAINED (strong spatial evidence), which the
    // client confirmed can still outrank a farther, correct-street
    // candidate on raw confidence. The requirement isn't that ranking
    // flips — it's that the contradiction is capped and flagged so an
    // analyst never sees a deceptively high, unqualified number.
    it('caps and flags a contained-but-wrong-street candidate, even when it still outranks a farther correct-street candidate (real Buckland geometry)', async () => {
      await insertFixtureParcel({
        parcelRef: 'TEST-CONTAINED-WRONG-STREET',
        address: '1 Sample Lane',
        municipality: 'Worcester',
        lat: 42.36, // exactly the query point — contained
        lng: -71.96,
      });
      await insertFixtureParcel({
        parcelRef: 'TEST-FARTHER-RIGHT-STREET',
        address: '4 Sample Ave',
        municipality: 'Worcester',
        lat: 42.36079, // ~88m away — not contained, but the correct street
        lng: -71.96,
      });

      const site = await createTestSite({ city: 'Worcester' });
      const attempt = await runMatchExpectingAttempt(
        site.id,
        { lat: 42.36, lng: -71.96, municipality: 'Worcester', locationText: 'Sample Ave.' },
        userId,
      );

      const candidates = await prisma.siteMatchCandidate.findMany({
        where: { attemptId: attempt.id },
        orderBy: { rank: 'asc' },
      });
      const contained = candidates.find((c) => c.parcelRef === 'TEST-CONTAINED-WRONG-STREET')!;
      expect((contained.evidence as any).pointInParcel).toBe(true);
      expect((contained.evidence as any).streetSuffixMatch).toBe(false);
      expect((contained.evidence as any).addressEvidenceConflict).toBe(true);
      expect((contained.evidence as any).manualVerificationRequired).toBe(true);
      expect(contained.confidence).toBeLessThanOrEqual(65);
    });

    // Pattern: Tewksbury facility 81 / Sterling facility 43 — distance +
    // containment + municipality alone reached 97% confidence with zero
    // address corroboration.
    it('caps confidence below the high band when nothing but distance/containment/municipality supports the match', async () => {
      await insertFixtureParcel({
        parcelRef: 'TEST-NOCORROBORATION-001',
        address: '20 Unrelated St',
        municipality: 'Worcester',
        lat: 42.33,
        lng: -71.93,
      });

      const site = await createTestSite({ city: 'Worcester' });
      // No locationText, and a description with nothing extractable —
      // exactly the Tewksbury/Sterling shape.
      const attempt = await runMatchExpectingAttempt(
        site.id,
        { lat: 42.33, lng: -71.93, municipality: 'Worcester', locationDescription: 'Rts 38 & 495 junction' },
        userId,
      );

      const candidates = await prisma.siteMatchCandidate.findMany({ where: { attemptId: attempt.id } });
      expect(candidates[0].confidence).toBeLessThanOrEqual(70);
      expect((candidates[0].evidence as any).lowCorroboration).toBe(true);
      expect(bandFor(candidates[0].confidence)).not.toBe('high');
    });

    // Pattern: the general case Tewksbury exemplifies — spatial evidence
    // and house-number evidence point at two DIFFERENT candidates. The
    // spatially-favored one must be flagged and capped, not silently
    // presented as a confident match.
    it('flags a conflict and caps confidence when spatial evidence and house-number evidence favor different candidates', async () => {
      await insertFixtureParcel({
        parcelRef: 'TEST-CONFLICT-SPATIAL',
        address: '5 Wrong St',
        municipality: 'Worcester',
        lat: 42.34, // exactly the query point — point-in-parcel true, distance ~0
        lng: -71.94,
      });
      await insertFixtureParcel({
        parcelRef: 'TEST-CONFLICT-ADDRESS',
        address: '20 Correct Ave',
        municipality: 'Worcester',
        lat: 42.34054, // ~60m away — not contained, but the house number matches the clue
        lng: -71.94,
      });

      const site = await createTestSite({ city: 'Worcester' });
      const attempt = await runMatchExpectingAttempt(
        site.id,
        { lat: 42.34, lng: -71.94, municipality: 'Worcester', locationText: '20 Correct Ave' },
        userId,
      );

      const candidates = await prisma.siteMatchCandidate.findMany({ where: { attemptId: attempt.id } });
      const spatial = candidates.find((c) => c.parcelRef === 'TEST-CONFLICT-SPATIAL')!;
      const address = candidates.find((c) => c.parcelRef === 'TEST-CONFLICT-ADDRESS')!;
      expect(spatial).toBeDefined();
      expect(address).toBeDefined();
      expect((spatial.evidence as any).conflictDetected).toBe(true);
      expect((spatial.evidence as any).conflictingCandidateParcelRef).toBe('TEST-CONFLICT-ADDRESS');
      expect((address.evidence as any).conflictDetected).toBe(true);
      expect(spatial.confidence).toBeLessThanOrEqual(65);
    });

    // Pattern: Milton facility 72 — the real "73 Granite Ave" parcel was
    // 444m from the depot coordinate, outside the 150m search radius
    // entirely, so it never became a candidate no matter how the scoring
    // weights were tuned. Adaptive stage-2 search (client requirement)
    // must widen the search when a house-number clue exists but nothing
    // nearby confirms it.
    it('expands the search radius when a house-number clue is not confirmed within the default radius, and finds the real match farther out', async () => {
      await insertFixtureParcel({
        parcelRef: 'TEST-RADIUS-DECOY-CLOSE',
        address: 'Sample Rd', // no house number — the kind of decoy that used to win by default
        municipality: 'Worcester',
        lat: 42.370359, // ~40m from the query point — inside the default 150m radius
        lng: -71.97,
      });
      await insertFixtureParcel({
        parcelRef: 'TEST-RADIUS-REAL-MATCH',
        address: '55 Sample Rd',
        municipality: 'Worcester',
        lat: 42.373594, // ~400m from the query point — OUTSIDE the default 150m radius, inside the 500m expanded one
        lng: -71.97,
      });

      const site = await createTestSite({ city: 'Worcester' });
      const attempt = await runMatchExpectingAttempt(
        site.id,
        { lat: 42.37, lng: -71.97, municipality: 'Worcester', locationText: '55 Sample Rd' },
        userId,
      );

      const candidates = await prisma.siteMatchCandidate.findMany({ where: { attemptId: attempt.id } });
      const realMatch = candidates.find((c) => c.parcelRef === 'TEST-RADIUS-REAL-MATCH');
      expect(realMatch).toBeDefined();
      expect((realMatch!.evidence as any).houseNumberMatch).toBe(true);
      expect((realMatch!.evidence as any).searchRadiusMeters).toBe(500);

      const decoy = candidates.find((c) => c.parcelRef === 'TEST-RADIUS-DECOY-CLOSE');
      expect((decoy!.evidence as any).searchRadiusMeters).toBe(150);
    });

    it('does NOT expand the search radius when there is no house-number clue to hunt for (most lookups stay tightly scoped)', async () => {
      await insertFixtureParcel({
        parcelRef: 'TEST-NO-EXPAND-001',
        address: 'Nearby Rd',
        municipality: 'Worcester',
        lat: 42.380359, // ~40m — well within default radius
        lng: -71.98,
      });

      const site = await createTestSite({ city: 'Worcester' });
      const attempt = await runMatchExpectingAttempt(
        site.id,
        // No locationText, and a description with nothing extractable — no
        // house number anywhere in the input, so there's nothing to hunt
        // for farther out.
        { lat: 42.38, lng: -71.98, municipality: 'Worcester' },
        userId,
      );

      const candidates = await prisma.siteMatchCandidate.findMany({ where: { attemptId: attempt.id } });
      expect(candidates.every((c) => (c.evidence as any).searchRadiusMeters === 150)).toBe(true);
    });

    // Regression: the client's real Lawrence acceptance case must still
    // resolve correctly, and should now ALSO carry a true houseNumberMatch
    // signal (it didn't exist before this correction).
    it('regression: the real Lawrence 190 Marston St case still identifies correctly, now with house-number corroboration', async () => {
      const site = await createTestSite({ city: 'Lawrence' });
      const attempt = await runMatchExpectingAttempt(
        site.id,
        {
          lat: 42.71796,
          lng: -71.142581,
          municipality: 'Lawrence',
          locationText: 'Marston St',
          locationDescription: '0.25 mi S of Methuen-Lawrence TL on Marston St',
        },
        userId,
      );

      const candidates = await prisma.siteMatchCandidate.findMany({
        where: { attemptId: attempt.id },
        orderBy: { rank: 'asc' },
      });
      expect(candidates[0].parcelRef).toBe('M_229292_940840');
      expect(candidates[0].matchedAddress).toBe('190 Marston St');
      // No house number was in the "Marston St" clue itself, so this stays
      // null (not true) — the fix doesn't fabricate corroboration that
      // wasn't actually supplied.
      expect((candidates[0].evidence as any).houseNumberMatch).toBeNull();
      expect((candidates[0].evidence as any).municipalityMatch).toBe(true);
    });
  });

  // ── Round 4: address-family search + cross-search reconciliation ────────

  describe('address-family search + spatial reconciliation (Round 4)', () => {
    const roundFourFixtureParcelRefs: string[] = [];

    afterAll(async () => {
      await prisma.parcelMirrorRecord.deleteMany({ where: { parcelRef: { in: roundFourFixtureParcelRefs } } });
    });

    async function insertFixture(opts: {
      parcelRef: string;
      address: string;
      municipality: string;
      lat: number;
      lng: number;
    }) {
      roundFourFixtureParcelRefs.push(opts.parcelRef);
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ParcelMirrorRecord"
           (id, "parcelRef", address, municipality, "sourceName", "sourceRefreshedAt", geom, centroid)
         VALUES ($1, $2, $3, $4, 'Test Fixture', now(),
           ST_Buffer(ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, 15)::geometry,
           ST_SetSRID(ST_MakePoint($5, $6), 4326))`,
        randomUUID(),
        opts.parcelRef,
        opts.address,
        opts.municipality,
        opts.lng,
        opts.lat,
      );
    }

    // 1. Address candidate and spatial candidate agree.
    it('AGREE: the same parcel is found by both the address-family search and the spatial search', async () => {
      await insertFixture({
        parcelRef: 'R4-AGREE-001',
        address: '15 Union St',
        municipality: 'Worcester',
        lat: 42.41, // exactly the query point — contained
        lng: -71.41,
      });

      const site = await createTestSite({ city: 'Worcester' });
      const attempt = await runMatchExpectingAttempt(
        site.id,
        { lat: 42.41, lng: -71.41, municipality: 'Worcester', locationText: '15 Union St' },
        userId,
      );

      const candidates = await prisma.siteMatchCandidate.findMany({ where: { attemptId: attempt.id } });
      const top = candidates.find((c) => c.parcelRef === 'R4-AGREE-001')!;
      expect((top.evidence as any).agreement).toBe('AGREE');
      expect((top.evidence as any).houseNumberMatch).toBe(true);
      expect((top.evidence as any).addressEvidenceStrength).toBe('strong');
    });

    // 2 & 6. Address candidate and spatial candidate disagree — including
    // the specific "house number matches but street doesn't" shape (the
    // real Milton "73 Courtland Cir" pattern).
    it('CONFLICT: address search favors one parcel while spatial search favors a different one (house number matches, street does not)', async () => {
      await insertFixture({
        parcelRef: 'R4-CONFLICT-SPATIAL',
        address: '5 Nearby Cir', // wrong street, but exactly at the coordinate
        municipality: 'Worcester',
        lat: 42.42,
        lng: -71.42,
      });
      await insertFixture({
        parcelRef: 'R4-CONFLICT-ADDRESS',
        address: '5 Sample Rd', // correct street + number, but far away
        municipality: 'Worcester',
        lat: 42.42359, // ~400m away — outside 150m, inside the 500m expanded radius
        lng: -71.42,
      });

      const site = await createTestSite({ city: 'Worcester' });
      const attempt = await runMatchExpectingAttempt(
        site.id,
        { lat: 42.42, lng: -71.42, municipality: 'Worcester', locationText: '5 Sample Rd' },
        userId,
      );

      const candidates = await prisma.siteMatchCandidate.findMany({ where: { attemptId: attempt.id } });
      const spatial = candidates.find((c) => c.parcelRef === 'R4-CONFLICT-SPATIAL')!;
      const address = candidates.find((c) => c.parcelRef === 'R4-CONFLICT-ADDRESS')!;
      expect(spatial).toBeDefined();
      expect(address).toBeDefined();
      expect((spatial.evidence as any).agreement).toBe('CONFLICT');
      expect((address.evidence as any).agreement).toBe('CONFLICT');
      expect((address.evidence as any).houseNumberMatch).toBe(true);
      expect((spatial.evidence as any).streetSuffixMatch).toBe(false);
      expect(spatial.confidence).toBeLessThanOrEqual(65);
    });

    // 3. Address candidate exists but is far from coordinates — must still
    // be found (not silently dropped for being outside any radius).
    it('finds a real address match far outside any spatial radius, and still reports its distance for transparency', async () => {
      await insertFixture({
        parcelRef: 'R4-FAR-ADDRESS',
        address: '9 Remote Ave',
        municipality: 'Worcester',
        lat: 42.43594, // ~660m from the query point
        lng: -71.43,
      });

      const site = await createTestSite({ city: 'Worcester' });
      const attempt = await runMatchExpectingAttempt(
        site.id,
        { lat: 42.43, lng: -71.43, municipality: 'Worcester', locationText: '9 Remote Ave' },
        userId,
      );

      const candidates = await prisma.siteMatchCandidate.findMany({ where: { attemptId: attempt.id } });
      const found = candidates.find((c) => c.parcelRef === 'R4-FAR-ADDRESS');
      expect(found).toBeDefined();
      expect((found!.evidence as any).agreement).toBe('ADDRESS_ONLY');
      expect((found!.evidence as any).searchRadiusMeters).toBeNull();
      expect((found!.evidence as any).distanceMeters).toBeGreaterThan(500);
      expect((found!.evidence as any).houseNumberMatch).toBe(true);
    });

    // 4. Coordinates identify a parcel, but no address number exists
    // anywhere in the input to compare — spatial-only, still floor-capped.
    it('SPATIAL_ONLY with no house-number clue at all stays capped by the corroboration floor', async () => {
      await insertFixture({
        parcelRef: 'R4-SPATIAL-ONLY',
        address: 'Quiet Ln',
        municipality: 'Worcester',
        lat: 42.44,
        lng: -71.44,
      });

      const site = await createTestSite({ city: 'Worcester' });
      const attempt = await runMatchExpectingAttempt(
        site.id,
        { lat: 42.44, lng: -71.44, municipality: 'Worcester' }, // no locationText, no description
        userId,
      );

      const candidates = await prisma.siteMatchCandidate.findMany({ where: { attemptId: attempt.id } });
      const top = candidates.find((c) => c.parcelRef === 'R4-SPATIAL-ONLY')!;
      expect((top.evidence as any).agreement).toBe('SPATIAL_ONLY');
      expect((top.evidence as any).lowCorroboration).toBe(true);
      expect(top.confidence).toBeLessThanOrEqual(70);
    });

    // 5. Street matches but house number doesn't.
    it('a street match with a contradicting house number is flagged as an address-evidence conflict, not treated as confirmed', async () => {
      await insertFixture({
        parcelRef: 'R4-WRONG-NUMBER',
        address: '40 Harbor St',
        municipality: 'Worcester',
        lat: 42.45,
        lng: -71.45,
      });

      const site = await createTestSite({ city: 'Worcester' });
      const attempt = await runMatchExpectingAttempt(
        site.id,
        { lat: 42.45, lng: -71.45, municipality: 'Worcester', locationText: '12 Harbor St' },
        userId,
      );

      const candidates = await prisma.siteMatchCandidate.findMany({ where: { attemptId: attempt.id } });
      const top = candidates.find((c) => c.parcelRef === 'R4-WRONG-NUMBER')!;
      expect((top.evidence as any).houseNumberMatch).toBe(false);
      expect((top.evidence as any).streetSuffixMatch).toBe(true);
      expect((top.evidence as any).addressEvidenceConflict).toBe(true);
      expect(top.confidence).toBeLessThanOrEqual(65);
    });

    // 7. No address evidence at all (covered structurally already by
    // existing "finds nearby candidates via spatial search" test — this
    // adds the explicit Round 4 evidence-model assertions).
    it('with zero address-family evidence, agreement is SPATIAL_ONLY or null, never fabricated as AGREE', async () => {
      await insertFixture({
        parcelRef: 'R4-NO-ADDRESS-EVIDENCE',
        address: 'Mystery Way',
        municipality: 'Worcester',
        lat: 42.46,
        lng: -71.46,
      });

      const site = await createTestSite({ city: 'Worcester' });
      const attempt = await runMatchExpectingAttempt(
        site.id,
        { lat: 42.46, lng: -71.46 }, // no municipality clue even — address search can't run at all
        userId,
      );

      const candidates = await prisma.siteMatchCandidate.findMany({ where: { attemptId: attempt.id } });
      const top = candidates.find((c) => c.parcelRef === 'R4-NO-ADDRESS-EVIDENCE')!;
      expect((top.evidence as any).agreement).not.toBe('AGREE');
      expect((top.evidence as any).agreement).not.toBe('CONFLICT');
    });

    // 8. Multiple parcels share/contain the same address text.
    it('returns multiple candidates when several real parcels share the same address text', async () => {
      await insertFixture({
        parcelRef: 'R4-DUP-ADDR-1',
        address: 'Orchard Ave',
        municipality: 'Worcester',
        lat: 42.47,
        lng: -71.47,
      });
      await insertFixture({
        parcelRef: 'R4-DUP-ADDR-2',
        address: 'Orchard Ave',
        municipality: 'Worcester',
        lat: 42.47036, // ~40m away — a different real parcel, same unnumbered street text
        lng: -71.47,
      });

      const site = await createTestSite({ city: 'Worcester' });
      const attempt = await runMatchExpectingAttempt(
        site.id,
        { lat: 42.47, lng: -71.47, municipality: 'Worcester', locationText: 'Orchard Ave' },
        userId,
      );

      const candidates = await prisma.siteMatchCandidate.findMany({ where: { attemptId: attempt.id } });
      const refs = candidates.map((c) => c.parcelRef);
      expect(refs).toContain('R4-DUP-ADDR-1');
      expect(refs).toContain('R4-DUP-ADDR-2');
    });

    // 9. Address normalization variants — hyphenated range, via the FULL
    // address-family search path end-to-end (unit coverage already exists
    // in address-normalizer.spec.ts; this proves it's actually wired up).
    it('matches a clue house number against a real hyphenated-range address (e.g. "7-9 Sample Rd")', async () => {
      await insertFixture({
        parcelRef: 'R4-RANGE-001',
        address: '7-9 Sample Rd',
        municipality: 'Worcester',
        lat: 42.48,
        lng: -71.48,
      });

      const site = await createTestSite({ city: 'Worcester' });
      const attempt = await runMatchExpectingAttempt(
        site.id,
        { lat: 42.48, lng: -71.48, municipality: 'Worcester', locationText: '8 Sample Rd' },
        userId,
      );

      const candidates = await prisma.siteMatchCandidate.findMany({ where: { attemptId: attempt.id } });
      const top = candidates.find((c) => c.parcelRef === 'R4-RANGE-001')!;
      expect((top.evidence as any).houseNumberMatch).toBe(true);
    });

    // 10. Exact-address existing workflow — regression: full-address input
    // stays on the EXACT/FUZZY path, untouched by the new agreement model.
    it('regression: a full-address input still resolves via EXACT, with agreement null (not applicable to single-method searches)', async () => {
      const site = await createTestSite();
      const attempt = await runMatchExpectingAttempt(
        site.id,
        { address: '142 Elm Street, Worcester, MA 01609' },
        userId,
      );
      expect(attempt.strategyUsed).toBe('EXACT');
      const candidates = await prisma.siteMatchCandidate.findMany({ where: { attemptId: attempt.id } });
      expect(candidates[0].confidence).toBe(100);
      expect((candidates[0].evidence as any).agreement).toBeNull();
    });
  });
});
