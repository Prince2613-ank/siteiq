import { PrismaClient, FieldStatus, FieldType, IdentityStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { AnalysisService } from './analysis.service';
import { InvestigationDataService } from './investigation-data.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * Integration tests for Checkpoint 9's investigation summary — the
 * client's three required cases: A (normal, confirmed + complete data),
 * B (preliminary — analysis started before confirmation), C (incomplete /
 * conflicting data correctly surfaced, never silently assumed).
 */
describe('AnalysisService (integration)', () => {
  let prisma: PrismaService;
  let service: AnalysisService;
  let orgId: string;
  let actor: AuthenticatedUser;
  const cleanupSiteIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new AnalysisService(prisma, new ActivityService(prisma), new InvestigationDataService(prisma));

    const org = await prisma.organization.create({ data: { name: 'Analysis Test Org' } });
    orgId = org.id;
    const user = await prisma.user.create({
      data: {
        organizationId: orgId,
        email: `analysis-test-${Date.now()}@example.com`,
        passwordHash: 'x',
        role: 'ADMIN',
        isActive: true,
      },
    });
    actor = { userId: user.id, organizationId: orgId, role: 'ADMIN', email: user.email };
  });

  afterAll(async () => {
    await prisma.document.deleteMany({ where: { siteId: { in: cleanupSiteIds } } });
    await prisma.siteDataFieldApproval.deleteMany({ where: { siteId: { in: cleanupSiteIds } } });
    await prisma.siteDataField.deleteMany({ where: { siteId: { in: cleanupSiteIds } } });
    await prisma.analysisRun.deleteMany({ where: { siteId: { in: cleanupSiteIds } } });
    await prisma.activityEvent.deleteMany({ where: { siteId: { in: cleanupSiteIds } } });
    await prisma.site.deleteMany({ where: { id: { in: cleanupSiteIds } } });
    await prisma.user.delete({ where: { id: actor.userId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  async function seedSite(identityStatus: IdentityStatus, parcelRef?: string) {
    const site = await prisma.site.create({
      data: {
        organizationId: orgId,
        streetAddress: 'Analysis Test St',
        city: 'Testville',
        state: 'MA',
        municipality: 'Testville',
        originalInputType: 'address',
        originalInputAddress: 'Analysis Test St',
        identityStatus,
        parcelRef,
        matchConfidence: identityStatus === 'CONFIRMED' ? 82 : null,
        matchMethod: identityStatus === 'CONFIRMED' ? 'EXACT' : null,
        createdById: actor.userId,
      },
    });
    cleanupSiteIds.push(site.id);
    return site;
  }

  it('Case A — normal analysis: confirmed identity + complete data + required documents → COMPLETE', async () => {
    const site = await seedSite(IdentityStatus.CONFIRMED, 'ANALYSIS-A');
    await prisma.siteDataField.create({
      data: {
        siteId: site.id, fieldName: 'lot_size', fieldType: FieldType.NUMBER, value: 20000, numericValue: 20000,
        sourceName: 'MassGIS', retrievedAt: new Date(), status: FieldStatus.MATCHED, isCurrent: true,
      },
    });
    await prisma.siteDataField.create({
      data: {
        siteId: site.id, fieldName: 'zoning_code', fieldType: FieldType.STRING, value: 'R-1',
        sourceName: 'MassGIS', retrievedAt: new Date(), status: FieldStatus.MATCHED, isCurrent: true,
      },
    });
    await prisma.document.create({
      data: { siteId: site.id, filename: 'plan.pdf', storageKey: 'x', mimeType: 'application/pdf', sizeBytes: 100, category: 'Site Plan', uploadedById: actor.userId },
    });
    await prisma.document.create({
      data: { siteId: site.id, filename: 'survey.pdf', storageKey: 'y', mimeType: 'application/pdf', sizeBytes: 100, category: 'Survey', uploadedById: actor.userId },
    });

    const run = await service.createRun(actor, site.id);
    expect(run.isPreliminary).toBe(false);
    await service.runAnalysis(run.id);

    const completed = await prisma.analysisRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(completed.status).toBe('COMPLETED');
    const result = completed.result as any;
    expect(result.identity.status).toBe('CONFIRMED');
    expect(result.investigation.complete).toBe(true);
    expect(result.investigation.requiredActions).toHaveLength(0);
    expect(result.dataQuality.missingFields).toHaveLength(0);
    expect(result.documents.missing).toHaveLength(0);
  });

  it('Case B — preliminary: analysis started before parcel confirmation stays permanently preliminary', async () => {
    const site = await seedSite(IdentityStatus.NEEDS_REVIEW);

    const run = await service.createRun(actor, site.id);
    expect(run.isPreliminary).toBe(true);
    await service.runAnalysis(run.id);

    const completed = await prisma.analysisRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(completed.isPreliminary).toBe(true); // set at creation, never flips
    const result = completed.result as any;
    expect(result.identity.status).toBe('NEEDS_REVIEW');
    expect(result.investigation.complete).toBe(false);
    expect(result.investigation.requiredActions).toContain('Confirm the property identity');

    // Confirming the site AFTER this run doesn't retroactively change it.
    await prisma.site.update({ where: { id: site.id }, data: { identityStatus: IdentityStatus.CONFIRMED, parcelRef: 'LATE-CONFIRM' } });
    const stillPreliminary = await prisma.analysisRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(stillPreliminary.isPreliminary).toBe(true);
  });

  it('Case C — incomplete/conflicting: missing and conflicting fields are reported, never assumed', async () => {
    const site = await seedSite(IdentityStatus.CONFIRMED, 'ANALYSIS-C');
    // zoning_code: two sources disagree — CONFLICTING, no current value.
    await prisma.siteDataField.create({
      data: {
        siteId: site.id, fieldName: 'zoning_code', fieldType: FieldType.STRING, value: 'R-1',
        sourceName: 'MassGIS', retrievedAt: new Date(), status: FieldStatus.CONFLICTING, isCurrent: false,
      },
    });
    await prisma.siteDataField.create({
      data: {
        siteId: site.id, fieldName: 'zoning_code', fieldType: FieldType.STRING, value: 'R-2',
        sourceName: 'MassGIS Zoning Districts', retrievedAt: new Date(), status: FieldStatus.CONFLICTING, isCurrent: false,
      },
    });
    // lot_size: never even attempted (no observation at all).
    // No documents uploaded either.

    const run = await service.createRun(actor, site.id);
    await service.runAnalysis(run.id);

    const completed = await prisma.analysisRun.findUniqueOrThrow({ where: { id: run.id } });
    const result = completed.result as any;

    expect(result.investigation.complete).toBe(false);
    expect(result.dataQuality.conflictingFields).toContain('Zoning');
    expect(result.dataQuality.missingFields).toContain('Lot size');
    expect(result.documents.missing).toEqual(expect.arrayContaining(['Site Plan', 'Survey']));
    expect(result.investigation.requiredActions).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Resolve conflicting zoning'),
        expect.stringContaining('Lot size'),
        'Upload Site Plan',
        'Upload Survey',
      ]),
    );
    // Never silently picks one of the conflicting zoning values.
    const zoningEntry = result.propertyData.find((p: any) => p.fieldName === 'zoning_code');
    expect(zoningEntry.status).toBe('conflicting');
    expect(zoningEntry.value).toBeNull();
  });

  it('a genuinely failed analysis run is marked FAILED with an error message, not silently swallowed', async () => {
    const site = await seedSite(IdentityStatus.CONFIRMED, 'ANALYSIS-FAIL');
    const run = await service.createRun(actor, site.id);

    // Force the computation step to fail (simulating an unexpected error
    // partway through) to prove runAnalysis's own try/catch marks the run
    // FAILED with a real error message rather than throwing uncaught or
    // leaving the run stuck at PROCESSING forever (docs/01 §12).
    const spy = jest
      .spyOn((service as any).investigationData, 'buildSummary')
      .mockRejectedValueOnce(new Error('Simulated failure for test coverage'));

    await service.runAnalysis(run.id);
    spy.mockRestore();

    const failed = await prisma.analysisRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(failed.status).toBe('FAILED');
    expect(failed.errorMessage).toBe('Simulated failure for test coverage');
  });
});
