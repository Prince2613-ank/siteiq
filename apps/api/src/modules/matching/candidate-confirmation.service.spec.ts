import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ActivityModule } from '../activity/activity.module';
import { FieldEnrichmentService } from '../fields/field-enrichment.service';
import { ParcelMirrorRepository } from './parcel-mirror.repository';
import { ZoningDistrictRepository } from './zoning-district.repository';
import { CandidateConfirmationService } from './candidate-confirmation.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * Integration tests for the confirmation endpoint's business rules — the
 * ones the client specifically reviewed (docs/03 §2/§2.0). Two things this
 * suite exists to prove, per the client's explicit Checkpoint 5 instruction:
 *
 *   1. The system NEVER silently confirms a parcel — confirming candidate
 *      #2 or #3 (not the top-ranked #1) works exactly the same way #1
 *      would, because the analyst's choice is authoritative, not the score.
 *   2. A flagged duplicate cannot be confirmed without an explicit decision,
 *      even via a direct API call bypassing the UI.
 */
describe('CandidateConfirmationService (integration)', () => {
  let prisma: PrismaClient;
  let service: CandidateConfirmationService;
  let mirror: ParcelMirrorRepository;
  let orgId: string;
  let actor: AuthenticatedUser;
  const cleanupSiteIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, ActivityModule],
      providers: [
        CandidateConfirmationService,
        FieldEnrichmentService,
        ParcelMirrorRepository,
        ZoningDistrictRepository,
      ],
    }).compile();

    service = moduleRef.get(CandidateConfirmationService);
    prisma = moduleRef.get(PrismaService);
    mirror = moduleRef.get(ParcelMirrorRepository);

    const org = await prisma.organization.create({ data: { name: 'Confirmation Test Org' } });
    orgId = org.id;
    const user = await prisma.user.create({
      data: {
        organizationId: orgId,
        email: `confirm-test-${Date.now()}@example.com`,
        passwordHash: 'x',
        role: 'ADMIN',
        isActive: true,
      },
    });
    actor = { userId: user.id, organizationId: orgId, role: 'ADMIN', email: user.email };
  });

  afterAll(async () => {
    await prisma.siteMatchCandidate.deleteMany({ where: { siteId: { in: cleanupSiteIds } } });
    await prisma.matchAttempt.deleteMany({ where: { siteId: { in: cleanupSiteIds } } });
    await prisma.activityEvent.deleteMany({ where: { siteId: { in: cleanupSiteIds } } });
    await prisma.site.deleteMany({ where: { id: { in: cleanupSiteIds } } });
    await prisma.user.delete({ where: { id: actor.userId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  async function seedSiteWithCandidates(
    candidateSpecs: { parcelRef: string; confidence: number; duplicateOfSiteId?: string }[],
    siteOverrides: { streetAddress?: string | null } = {},
  ) {
    const site = await prisma.site.create({
      data: {
        organizationId: orgId,
        streetAddress: siteOverrides.streetAddress === undefined ? 'Test St' : siteOverrides.streetAddress,
        city: 'Worcester',
        state: 'MA',
        municipality: 'Worcester',
        originalInputType: siteOverrides.streetAddress === null ? 'location_clues' : 'address',
        originalInputAddress: siteOverrides.streetAddress === null ? null : 'Test St, Worcester, MA',
        identityStatus: 'NEEDS_REVIEW',
        createdById: actor.userId,
      },
    });
    cleanupSiteIds.push(site.id);

    const attempt = await prisma.matchAttempt.create({
      data: {
        siteId: site.id,
        inputSnapshot: {},
        strategyUsed: 'FUZZY',
        candidateCount: candidateSpecs.length,
        topConfidence: Math.max(...candidateSpecs.map((c) => c.confidence)),
        triggeredById: actor.userId,
      },
    });

    const candidates: Awaited<ReturnType<typeof prisma.siteMatchCandidate.create>>[] = [];
    for (let i = 0; i < candidateSpecs.length; i++) {
      const spec = candidateSpecs[i];
      candidates.push(
        await prisma.siteMatchCandidate.create({
          data: {
            siteId: site.id,
            attemptId: attempt.id,
            parcelRef: spec.parcelRef,
            matchedAddress: `${spec.parcelRef} address`,
            municipality: 'Worcester',
            confidence: spec.confidence,
            evidence: { addressSimilarity: 1, distanceMeters: null, distanceScore: null, parcelIdMatch: null, municipalityMatch: true },
            rank: i + 1,
            duplicateOfSiteId: spec.duplicateOfSiteId,
          },
        }),
      );
    }

    return { site, attempt, candidates };
  }

  it('confirms candidate #1 (the top-ranked one) when that is what the analyst chose', async () => {
    const { site, attempt, candidates } = await seedSiteWithCandidates([
      { parcelRef: 'P-001', confidence: 95 },
      { parcelRef: 'P-002', confidence: 60 },
    ]);

    const result = await service.confirm(actor, site.id, attempt.id, candidates[0].id, {});
    expect(result.site.parcelRef).toBe('P-001');
    expect(result.site.identityStatus).toBe('CONFIRMED');
    expect(result.site.streetAddress).toBe('P-001 address');

    const rejected = await prisma.siteMatchCandidate.findUniqueOrThrow({ where: { id: candidates[1].id } });
    expect(rejected.status).toBe('REJECTED');
  });

  it('resolves the property address from the confirmed parcel when the site was created with no exact address at all (client requirement — property address discovery)', async () => {
    const { site, attempt, candidates } = await seedSiteWithCandidates(
      [{ parcelRef: 'P-CLUE-001', confidence: 88 }],
      { streetAddress: null },
    );
    expect(site.streetAddress).toBeNull();

    const result = await service.confirm(actor, site.id, attempt.id, candidates[0].id, {});
    expect(result.site.identityStatus).toBe('CONFIRMED');
    // Original input remains untouched (still absent) — only the
    // confirmed/current streetAddress is populated from the parcel.
    expect(result.site.originalInputAddress).toBeNull();
    expect(result.site.streetAddress).toBe('P-CLUE-001 address');
  });

  it('Checkpoint 11 follow-up: a field-enrichment failure (mirror lookup throws) never destroys the identity confirmation itself', async () => {
    const { site, attempt, candidates } = await seedSiteWithCandidates([
      { parcelRef: 'ENRICH-FAIL-001', confidence: 90 },
    ]);

    const spy = jest.spyOn(mirror, 'findByParcelRef').mockRejectedValueOnce(new Error('Simulated mirror DB failure'));

    const result = await service.confirm(actor, site.id, attempt.id, candidates[0].id, {});

    // The thing the analyst actually clicked — confirming the parcel
    // identity — must succeed regardless of the enrichment failure.
    expect(result.site.identityStatus).toBe('CONFIRMED');
    expect(result.site.parcelRef).toBe('ENRICH-FAIL-001');

    // The failure is on record, distinctly, for diagnosability — not
    // confused with a genuine "field unavailable" observation.
    const events = await prisma.activityEvent.findMany({ where: { siteId: site.id } });
    expect(events.some((e) => e.eventType === 'enrichment_failed')).toBe(true);

    // No partial/garbage SiteDataField rows were left behind for this site.
    const fields = await prisma.siteDataField.findMany({ where: { siteId: site.id } });
    expect(fields.length).toBe(0);

    spy.mockRestore();
  });

  it('preserves confirmation after a real SQL error during enrichment', async () => {
    const { site, attempt, candidates } = await seedSiteWithCandidates([
      { parcelRef: 'ENRICH-SQL-FAIL-001', confidence: 90 },
    ]);
    const spy = jest.spyOn(FieldEnrichmentService.prototype, 'enrich').mockImplementationOnce(async (tx) => {
      await tx.siteDataField.create({
        data: {
          siteId: site.id, fieldName: 'lot_size', fieldType: 'NUMBER',
          value: 123, sourceName: 'Failure injection', retrievedAt: new Date(),
          status: 'MATCHED', isCurrent: true,
        },
      });
      await tx.$executeRawUnsafe('SELECT 1 / 0');
    });
    try {
      const result = await service.confirm(actor, site.id, attempt.id, candidates[0].id, {});
      expect(result.site.identityStatus).toBe('CONFIRMED');
      expect(result.site.parcelRef).toBe('ENRICH-SQL-FAIL-001');
      const events = await prisma.activityEvent.findMany({ where: { siteId: site.id } });
      expect(events.some((event) => event.eventType === 'enrichment_failed')).toBe(true);
      expect(events.some((event) => event.eventType === 'parcel_confirmed')).toBe(true);
      expect(await prisma.siteDataField.count({ where: { siteId: site.id } })).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('confirms a LOWER-ranked candidate when the analyst deliberately picks it — proves no silent auto-confirm of the top score', async () => {
    const { site, attempt, candidates } = await seedSiteWithCandidates([
      { parcelRef: 'HIGH-CONF', confidence: 96 },
      { parcelRef: 'ANALYST-PICK', confidence: 61 },
    ]);

    // Deliberately confirm the SECOND (lower-confidence) candidate, not the
    // 96%-confidence top pick — this is the scenario the client specifically
    // asked to be proven.
    const result = await service.confirm(actor, site.id, attempt.id, candidates[1].id, {
      note: 'Analyst has local knowledge the automated score does not.',
    });

    expect(result.site.parcelRef).toBe('ANALYST-PICK');
    expect(result.site.matchConfidence).toBe(61); // the confidence of what was ACTUALLY chosen, not the top score

    const highConfRow = await prisma.siteMatchCandidate.findUniqueOrThrow({ where: { id: candidates[0].id } });
    expect(highConfRow.status).toBe('REJECTED'); // the 96% candidate was explicitly passed over, on record
  });

  it('rejects confirmation of a flagged-duplicate candidate with no duplicate decision — even via a direct call bypassing the UI', async () => {
    const existing = await prisma.site.create({
      data: {
        organizationId: orgId,
        streetAddress: 'Existing St',
        city: 'Worcester',
        state: 'MA',
        municipality: 'Worcester',
        originalInputType: 'address',
        originalInputAddress: 'Existing St',
        identityStatus: 'CONFIRMED',
        parcelRef: 'DUP-001',
        createdById: actor.userId,
      },
    });
    cleanupSiteIds.push(existing.id);

    const { site, attempt, candidates } = await seedSiteWithCandidates([
      { parcelRef: 'DUP-001', confidence: 90, duplicateOfSiteId: existing.id },
    ]);

    await expect(
      service.confirm(actor, site.id, attempt.id, candidates[0].id, {}),
    ).rejects.toThrow(/specify OPENED_EXISTING or CONTINUED_SEPARATE/);

    // Confirm it's genuinely still undecided, not partially applied.
    const stillProposed = await prisma.siteMatchCandidate.findUniqueOrThrow({ where: { id: candidates[0].id } });
    expect(stillProposed.status).toBe('PROPOSED');
    const siteUnchanged = await prisma.site.findUniqueOrThrow({ where: { id: site.id } });
    expect(siteUnchanged.identityStatus).toBe('NEEDS_REVIEW');
  });

  it('rejects a duplicate decision provided for a candidate that is not actually flagged as a duplicate', async () => {
    const { site, attempt, candidates } = await seedSiteWithCandidates([{ parcelRef: 'NOT-DUP', confidence: 90 }]);

    await expect(
      service.confirm(actor, site.id, attempt.id, candidates[0].id, { duplicateDecision: 'CONTINUED_SEPARATE' }),
    ).rejects.toThrow(/not flagged as a duplicate/);
  });

  it('accepting OPENED_EXISTING merges (soft-deletes) the new site rather than confirming it separately', async () => {
    const existing = await prisma.site.create({
      data: {
        organizationId: orgId,
        streetAddress: 'Canonical St',
        city: 'Worcester',
        state: 'MA',
        municipality: 'Worcester',
        originalInputType: 'address',
        originalInputAddress: 'Canonical St',
        identityStatus: 'CONFIRMED',
        parcelRef: 'DUP-002',
        createdById: actor.userId,
      },
    });
    cleanupSiteIds.push(existing.id);

    const { site, attempt, candidates } = await seedSiteWithCandidates([
      { parcelRef: 'DUP-002', confidence: 90, duplicateOfSiteId: existing.id },
    ]);

    await service.confirm(actor, site.id, attempt.id, candidates[0].id, {
      duplicateDecision: 'OPENED_EXISTING',
    });

    const merged = await prisma.site.findUniqueOrThrow({ where: { id: site.id } });
    expect(merged.deletedAt).not.toBeNull();
    expect(merged.mergedIntoSiteId).toBe(existing.id);
    expect(merged.confirmedCandidateId).toBeNull(); // never confirmed on its own

    const events = await prisma.activityEvent.findMany({ where: { siteId: existing.id } });
    expect(events.some((e) => e.eventType === 'duplicate_decision_recorded')).toBe(true);
  });
});
