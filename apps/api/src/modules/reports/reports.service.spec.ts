import { PrismaClient, FieldStatus, FieldType, IdentityStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { InvestigationDataService } from '../analysis/investigation-data.service';
import { ReportsService } from './reports.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * Integration tests for Checkpoint 10's immutable report snapshots — the
 * client's four required cases: A (normal), B (immutability across later
 * changes), C (preliminary), D (incomplete investigation shown honestly).
 */
describe('ReportsService (integration)', () => {
  let prisma: PrismaService;
  let service: ReportsService;
  let orgId: string;
  let actor: AuthenticatedUser;
  const cleanupSiteIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new ReportsService(prisma, new ActivityService(prisma), new InvestigationDataService(prisma));

    const org = await prisma.organization.create({ data: { name: 'Reports Test Org' } });
    orgId = org.id;
    const user = await prisma.user.create({
      data: {
        organizationId: orgId,
        email: `reports-test-${Date.now()}@example.com`,
        passwordHash: 'x',
        role: 'ADMIN',
        isActive: true,
      },
    });
    actor = { userId: user.id, organizationId: orgId, role: 'ADMIN', email: user.email };
  });

  afterAll(async () => {
    await prisma.report.deleteMany({ where: { siteId: { in: cleanupSiteIds } } });
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
        streetAddress: 'Report Test St',
        city: 'Testville',
        state: 'MA',
        municipality: 'Testville',
        originalInputType: 'address',
        originalInputAddress: 'Report Test St, Testville, MA',
        identityStatus,
        parcelRef,
        matchConfidence: identityStatus === 'CONFIRMED' ? 88 : null,
        matchMethod: identityStatus === 'CONFIRMED' ? 'EXACT' : null,
        createdById: actor.userId,
      },
    });
    cleanupSiteIds.push(site.id);
    return site;
  }

  it('Case A — normal report: confirmed property + data → all current information appears', async () => {
    const site = await seedSite(IdentityStatus.CONFIRMED, 'REPORT-A');
    await prisma.siteDataField.create({
      data: {
        siteId: site.id, fieldName: 'lot_size', fieldType: FieldType.NUMBER, value: 25000, numericValue: 25000,
        sourceName: 'MassGIS', retrievedAt: new Date(), status: FieldStatus.MATCHED, isCurrent: true,
      },
    });
    await prisma.document.create({
      data: { siteId: site.id, filename: 'plan.pdf', storageKey: 'x', mimeType: 'application/pdf', sizeBytes: 10, category: 'Site Plan', uploadedById: actor.userId },
    });

    const report = await service.generate(actor, site.id);
    const snapshot = report.contentSnapshot as any;

    expect(snapshot.identity.parcelRef).toBe('REPORT-A');
    expect(snapshot.identity.identityStatus).toBe('CONFIRMED');
    expect(snapshot.propertyData.find((f: any) => f.fieldName === 'lot_size').value).toBe(25000);
    expect(snapshot.documents).toHaveLength(1);
    expect(snapshot.documents[0].category).toBe('Site Plan');
    expect(snapshot.isPreliminary).toBe(false);
  });

  it('Case B — immutability: changing the Site AFTER report generation does not change the stored report', async () => {
    const site = await seedSite(IdentityStatus.CONFIRMED, 'REPORT-B');
    await prisma.siteDataField.create({
      data: {
        siteId: site.id, fieldName: 'lot_size', fieldType: FieldType.NUMBER, value: 30056, numericValue: 30056,
        sourceName: 'MassGIS', retrievedAt: new Date(), status: FieldStatus.MATCHED, isCurrent: true,
      },
    });

    const report = await service.generate(actor, site.id);
    const originalSnapshot = report.contentSnapshot as any;
    expect(originalSnapshot.propertyData.find((f: any) => f.fieldName === 'lot_size').value).toBe(30056);

    // The site's data changes AFTER the report was generated — the field
    // gets superseded (a new current value), exactly the client's
    // Sept 7 -> Sept 10 scenario.
    await prisma.siteDataField.updateMany({ where: { siteId: site.id, fieldName: 'lot_size' }, data: { isCurrent: false } });
    await prisma.siteDataField.create({
      data: {
        siteId: site.id, fieldName: 'lot_size', fieldType: FieldType.NUMBER, value: 99999, numericValue: 99999,
        sourceName: 'MassGIS (corrected)', retrievedAt: new Date(), status: FieldStatus.MATCHED, isCurrent: true,
      },
    });

    // Re-fetch the SAME report from the database — never recomputed.
    const reFetched = await service.getOne(orgId, report.id);
    const reFetchedSnapshot = reFetched.contentSnapshot as any;
    expect(reFetchedSnapshot.propertyData.find((f: any) => f.fieldName === 'lot_size').value).toBe(30056);

    // A NEW report generated now correctly reflects the new value —
    // proving the old one wasn't just coincidentally stale.
    const newReport = await service.generate(actor, site.id);
    const newSnapshot = newReport.contentSnapshot as any;
    expect(newSnapshot.propertyData.find((f: any) => f.fieldName === 'lot_size').value).toBe(99999);
  });

  it('Case C — preliminary report: clearly marked when identity was not confirmed at generation time', async () => {
    const site = await seedSite(IdentityStatus.NEEDS_REVIEW);

    const report = await service.generate(actor, site.id);
    const snapshot = report.contentSnapshot as any;

    expect(snapshot.isPreliminary).toBe(true);
    expect(snapshot.identity.identityStatus).toBe('NEEDS_REVIEW');
    expect(snapshot.identity.parcelRef).toBeNull();

    // Confirming the site AFTER doesn't retroactively change this report.
    await prisma.site.update({ where: { id: site.id }, data: { identityStatus: IdentityStatus.CONFIRMED, parcelRef: 'LATE' } });
    const reFetched = await service.getOne(orgId, report.id);
    expect((reFetched.contentSnapshot as any).isPreliminary).toBe(true);
  });

  it('Case D — incomplete investigation: unresolved conflicts and missing items shown, never hidden', async () => {
    const site = await seedSite(IdentityStatus.CONFIRMED, 'REPORT-D');
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
    // No documents uploaded.

    const report = await service.generate(actor, site.id);
    const snapshot = report.contentSnapshot as any;

    expect(snapshot.analysis.complete).toBe(false);
    expect(snapshot.investigationQuality.conflictingFields).toContain('Zoning');
    expect(snapshot.analysis.requiredActions).toEqual(
      expect.arrayContaining([expect.stringContaining('Resolve conflicting zoning'), 'Upload Site Plan', 'Upload Survey']),
    );
    // The conflicting zoning value is not silently resolved in the report either.
    const zoningEntry = snapshot.propertyData.find((f: any) => f.fieldName === 'zoning_code');
    expect(zoningEntry.status).toBe('conflicting');
    expect(zoningEntry.value).toBeNull();
  });
});
