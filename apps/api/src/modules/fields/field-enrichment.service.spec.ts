import { PrismaClient, FieldStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ParcelMirrorRepository } from '../matching/parcel-mirror.repository';
import { ZoningDistrictRepository } from '../matching/zoning-district.repository';
import { ActivityService } from '../activity/activity.service';
import { FieldEnrichmentService } from './field-enrichment.service';

/**
 * Integration tests for Checkpoint 7's field enrichment — proves values
 * flow through SiteDataField provenance (never a direct Site write) and
 * that a genuinely missing MassGIS value becomes FIELD_UNAVAILABLE, never
 * an inferred guess (client's explicit "missing values remain missing"
 * requirement).
 */
describe('FieldEnrichmentService (integration)', () => {
  let prisma: PrismaService;
  let mirror: ParcelMirrorRepository;
  let service: FieldEnrichmentService;
  let orgId: string;
  let userId: string;
  const cleanupSiteIds: string[] = [];
  const cleanupParcelRefs: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    mirror = new ParcelMirrorRepository(prisma);
    const zoningDistricts = new ZoningDistrictRepository(prisma);
    const activity = new ActivityService(prisma);
    service = new FieldEnrichmentService(mirror, zoningDistricts, activity);

    const org = await prisma.organization.create({ data: { name: 'Enrichment Test Org' } });
    orgId = org.id;
    const user = await prisma.user.create({
      data: {
        organizationId: orgId,
        email: `enrich-test-${Date.now()}@example.com`,
        passwordHash: 'x',
        role: 'ADMIN',
        isActive: true,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.siteDataFieldApproval.deleteMany({ where: { siteId: { in: cleanupSiteIds } } });
    await prisma.siteDataField.deleteMany({ where: { siteId: { in: cleanupSiteIds } } });
    await prisma.activityEvent.deleteMany({ where: { siteId: { in: cleanupSiteIds } } });
    await prisma.site.deleteMany({ where: { id: { in: cleanupSiteIds } } });
    await prisma.$executeRawUnsafe(
      `DELETE FROM "ParcelMirrorRecord" WHERE "parcelRef" = ANY($1)`,
      cleanupParcelRefs,
    );
    await prisma.user.delete({ where: { id: userId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  async function seedMirrorParcel(parcelRef: string, opts: { lotSize?: number; zoning?: string | null }) {
    cleanupParcelRefs.push(parcelRef);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ParcelMirrorRecord"
         (id, "parcelRef", address, municipality, "lotSize", "lotSizeUnit", zoning, "sourceName", "sourceRefreshedAt", geom, centroid)
       VALUES (gen_random_uuid(), $1, 'Test Address', 'Testville', $2, 'sqft', $3, 'MassGIS (test)', now(),
         ST_Buffer(ST_SetSRID(ST_MakePoint(-71.0, 42.0), 4326)::geography, 10)::geometry,
         ST_SetSRID(ST_MakePoint(-71.0, 42.0), 4326))`,
      parcelRef,
      opts.lotSize ?? null,
      opts.zoning ?? null,
    );
  }

  async function seedSite() {
    const site = await prisma.site.create({
      data: {
        organizationId: orgId,
        streetAddress: 'Test St',
        city: 'Testville',
        state: 'MA',
        municipality: 'Testville',
        originalInputType: 'address',
        originalInputAddress: 'Test St',
        identityStatus: 'NEEDS_REVIEW',
        createdById: userId,
      },
    });
    cleanupSiteIds.push(site.id);
    return site;
  }

  it('populates SiteDataField with real values, through provenance, when MassGIS has data', async () => {
    const site = await seedSite();
    await seedMirrorParcel('ENRICH-001', { lotSize: 20000, zoning: 'R-1' });

    await prisma.$transaction((tx) => service.enrich(tx, site.id, 'ENRICH-001', userId, orgId));

    const fields = await prisma.siteDataField.findMany({ where: { siteId: site.id } });
    const lotSize = fields.find((f) => f.fieldName === 'lot_size')!;
    expect(lotSize.status).toBe(FieldStatus.MATCHED);
    expect(lotSize.isCurrent).toBe(true);
    expect(lotSize.numericValue).toBe(20000);
    expect(lotSize.sourceName).toBe('MassGIS (test)');

    const approvals = await prisma.siteDataFieldApproval.findMany({ where: { siteId: site.id } });
    expect(approvals.some((a) => a.fieldName === 'lot_size')).toBe(true);

    const updatedSite = await prisma.site.findUniqueOrThrow({ where: { id: site.id } });
    expect(updatedSite.lotSize).toBe(20000);
    expect(updatedSite.zoningCode).toBe('R-1');
  });

  it('records a genuinely missing value as FIELD_UNAVAILABLE — never infers one', async () => {
    const site = await seedSite();
    await seedMirrorParcel('ENRICH-002', { lotSize: 15000, zoning: null }); // no zoning on file

    await prisma.$transaction((tx) => service.enrich(tx, site.id, 'ENRICH-002', userId, orgId));

    const fields = await prisma.siteDataField.findMany({ where: { siteId: site.id } });
    const zoning = fields.find((f) => f.fieldName === 'zoning_code')!;
    expect(zoning.status).toBe(FieldStatus.FIELD_UNAVAILABLE);
    expect(zoning.isCurrent).toBe(false);
    expect(zoning.value).toBeNull();

    // No approval is logged for an unavailable field — nothing was
    // approved, there's nothing to approve.
    const approvals = await prisma.siteDataFieldApproval.findMany({ where: { siteId: site.id, fieldName: 'zoning_code' } });
    expect(approvals).toHaveLength(0);

    const updatedSite = await prisma.site.findUniqueOrThrow({ where: { id: site.id } });
    expect(updatedSite.zoningCode).toBeNull(); // stays null, not guessed
  });

  it('flags a genuine two-source disagreement as CONFLICTING, preserves both, and does not set a current value automatically', async () => {
    const site = await seedSite();
    // Assessor extract says R-1; the parcel sits inside a Zoning Districts
    // polygon that says R-2 — a real disagreement between the two
    // independent MassGIS sources (docs/08's Checkpoint 8 scenario).
    await seedMirrorParcel('ENRICH-003', { lotSize: 18000, zoning: 'R-1' });
    const districtId = 'test-district-enrich-003';
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ZoningDistrictMirror" (id, zone, "zoneDesc", geom, "sourceName", "sourceRefreshedAt")
       VALUES ($1, 'R-2', 'Residential-2', ST_Buffer(ST_SetSRID(ST_MakePoint(-71.0, 42.0), 4326)::geography, 50)::geometry, 'MassGIS Zoning Districts', now())`,
      districtId,
    );

    await prisma.$transaction((tx) => service.enrich(tx, site.id, 'ENRICH-003', userId, orgId));

    const fields = await prisma.siteDataField.findMany({ where: { siteId: site.id, fieldName: 'zoning_code' } });
    expect(fields).toHaveLength(2);
    expect(fields.every((f) => f.status === FieldStatus.CONFLICTING)).toBe(true);
    expect(fields.every((f) => f.isCurrent === false)).toBe(true);
    expect(fields.map((f) => f.value).sort()).toEqual(['R-1', 'R-2']);

    const updatedSite = await prisma.site.findUniqueOrThrow({ where: { id: site.id } });
    expect(updatedSite.zoningCode).toBeNull(); // no source wins automatically

    const events = await prisma.activityEvent.findMany({ where: { siteId: site.id } });
    expect(events.some((e) => e.eventType === 'field_conflict_detected')).toBe(true);

    await prisma.$executeRawUnsafe(`DELETE FROM "ZoningDistrictMirror" WHERE id = $1`, districtId);
  });

  it('two sources AGREEING is not a conflict — auto-accepted as current', async () => {
    const site = await seedSite();
    await seedMirrorParcel('ENRICH-004', { lotSize: 22000, zoning: 'R-3' });
    const districtId = 'test-district-enrich-004';
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ZoningDistrictMirror" (id, zone, "zoneDesc", geom, "sourceName", "sourceRefreshedAt")
       VALUES ($1, 'R-3', 'Residential-3', ST_Buffer(ST_SetSRID(ST_MakePoint(-71.0, 42.0), 4326)::geography, 50)::geometry, 'MassGIS Zoning Districts', now())`,
      districtId,
    );

    await prisma.$transaction((tx) => service.enrich(tx, site.id, 'ENRICH-004', userId, orgId));

    const fields = await prisma.siteDataField.findMany({ where: { siteId: site.id, fieldName: 'zoning_code' } });
    expect(fields.filter((f) => f.isCurrent)).toHaveLength(1);
    expect(fields.every((f) => f.status !== FieldStatus.CONFLICTING)).toBe(true);

    const updatedSite = await prisma.site.findUniqueOrThrow({ where: { id: site.id } });
    expect(updatedSite.zoningCode).toBe('R-3');

    await prisma.$executeRawUnsafe(`DELETE FROM "ZoningDistrictMirror" WHERE id = $1`, districtId);
  });
});
