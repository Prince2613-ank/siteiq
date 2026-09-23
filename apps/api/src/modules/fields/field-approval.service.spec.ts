import { PrismaClient, FieldStatus, FieldType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { FieldApprovalService } from './field-approval.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * Integration tests for real Conflict Resolution (Checkpoint 8) — the
 * client's Case B: "Source A → 25,000 / Source B → 27,500 / Conflict
 * Review / Analyst chooses / Decision recorded", wired to real
 * SiteDataField rows rather than fixture UI data.
 */
describe('FieldApprovalService (integration)', () => {
  let prisma: PrismaService;
  let service: FieldApprovalService;
  let orgId: string;
  let actor: AuthenticatedUser;
  const cleanupSiteIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new FieldApprovalService(prisma, new ActivityService(prisma));

    const org = await prisma.organization.create({ data: { name: 'Field Approval Test Org' } });
    orgId = org.id;
    const user = await prisma.user.create({
      data: {
        organizationId: orgId,
        email: `field-approval-test-${Date.now()}@example.com`,
        passwordHash: 'x',
        role: 'ADMIN',
        isActive: true,
      },
    });
    actor = { userId: user.id, organizationId: orgId, role: 'ADMIN', email: user.email };
  });

  afterAll(async () => {
    await prisma.siteDataFieldApproval.deleteMany({ where: { siteId: { in: cleanupSiteIds } } });
    await prisma.siteDataField.deleteMany({ where: { siteId: { in: cleanupSiteIds } } });
    await prisma.activityEvent.deleteMany({ where: { siteId: { in: cleanupSiteIds } } });
    await prisma.site.deleteMany({ where: { id: { in: cleanupSiteIds } } });
    await prisma.user.delete({ where: { id: actor.userId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  async function seedConflictingLotSize() {
    const site = await prisma.site.create({
      data: {
        organizationId: orgId,
        streetAddress: 'Conflict Test St',
        city: 'Testville',
        state: 'MA',
        municipality: 'Testville',
        originalInputType: 'address',
        originalInputAddress: 'Conflict Test St',
        identityStatus: 'CONFIRMED',
        parcelRef: 'APPROVAL-TEST-1',
        createdById: actor.userId,
      },
    });
    cleanupSiteIds.push(site.id);

    const sourceA = await prisma.siteDataField.create({
      data: {
        siteId: site.id,
        fieldName: 'lot_size',
        fieldType: FieldType.NUMBER,
        value: 25000,
        numericValue: 25000,
        sourceName: 'MassGIS Assessor',
        retrievedAt: new Date(),
        status: FieldStatus.CONFLICTING,
        isCurrent: false,
      },
    });
    const sourceB = await prisma.siteDataField.create({
      data: {
        siteId: site.id,
        fieldName: 'lot_size',
        fieldType: FieldType.NUMBER,
        value: 27500,
        numericValue: 27500,
        sourceName: 'MassGIS Zoning Districts',
        retrievedAt: new Date(),
        status: FieldStatus.CONFLICTING,
        isCurrent: false,
      },
    });

    return { site, sourceA, sourceB };
  }

  it('lets the analyst choose the authoritative value and records the decision — the exact client Case B scenario', async () => {
    const { site, sourceA, sourceB } = await seedConflictingLotSize();

    const result = await service.approve(actor, site.id, sourceA.id, 'Assessor value is more current.');
    expect(result.isCurrent).toBe(true);
    expect(result.status).toBe(FieldStatus.MATCHED);

    // The REJECTED observation is not deleted — still fully queryable.
    const stillThere = await prisma.siteDataField.findUniqueOrThrow({ where: { id: sourceB.id } });
    expect(stillThere.value).toBe(27500);
    expect(stillThere.isCurrent).toBe(false);

    const approval = await prisma.siteDataFieldApproval.findFirstOrThrow({
      where: { siteId: site.id, fieldName: 'lot_size' },
    });
    expect(approval.approvedFieldId).toBe(sourceA.id);
    expect(approval.approvedById).toBe(actor.userId);
    expect(approval.note).toBe('Assessor value is more current.');

    const updatedSite = await prisma.site.findUniqueOrThrow({ where: { id: site.id } });
    expect(updatedSite.lotSize).toBe(25000);

    const events = await prisma.activityEvent.findMany({ where: { siteId: site.id } });
    expect(events.some((e) => e.eventType === 'field_conflict_resolved')).toBe(true);
  });

  it('refuses to approve an observation that has no value — nothing to approve', async () => {
    const site = await prisma.site.create({
      data: {
        organizationId: orgId,
        streetAddress: 'No Value St',
        city: 'Testville',
        state: 'MA',
        municipality: 'Testville',
        originalInputType: 'address',
        originalInputAddress: 'No Value St',
        identityStatus: 'CONFIRMED',
        createdById: actor.userId,
      },
    });
    cleanupSiteIds.push(site.id);

    const unavailable = await prisma.siteDataField.create({
      data: {
        siteId: site.id,
        fieldName: 'zoning_code',
        fieldType: FieldType.STRING,
        value: null as any,
        sourceName: 'MassGIS',
        retrievedAt: new Date(),
        status: FieldStatus.FIELD_UNAVAILABLE,
        isCurrent: false,
      },
    });

    await expect(service.approve(actor, site.id, unavailable.id)).rejects.toThrow(/nothing to report/);
  });
});
