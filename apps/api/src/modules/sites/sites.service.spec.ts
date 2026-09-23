import { PrismaClient, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { QueueService } from '../../queue/queue.service';
import { ParcelMirrorRepository } from '../matching/parcel-mirror.repository';
import { SitesService } from './sites.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * Checkpoint 11 data-integrity review — the client's explicit concern:
 * "test that one organization's data cannot accidentally appear in
 * another organization's API response." QueueService is stubbed (no real
 * Redis needed for these tests — they're about org isolation, not
 * matching).
 */
describe('SitesService — organization isolation (integration)', () => {
  let prisma: PrismaService;
  let service: SitesService;
  let orgA: string;
  let orgB: string;
  let actorA: AuthenticatedUser;
  let actorB: AuthenticatedUser;
  const cleanupSiteIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    const fakeQueue = { enqueuePropertyMatch: async () => undefined } as unknown as QueueService;
    service = new SitesService(prisma, new ActivityService(prisma), fakeQueue, new ParcelMirrorRepository(prisma));

    const org1 = await prisma.organization.create({ data: { name: 'Isolation Test Org A' } });
    const org2 = await prisma.organization.create({ data: { name: 'Isolation Test Org B' } });
    orgA = org1.id;
    orgB = org2.id;

    const userA = await prisma.user.create({
      data: { organizationId: orgA, email: `iso-a-${Date.now()}@example.com`, passwordHash: 'x', role: Role.ADMIN, isActive: true },
    });
    const userB = await prisma.user.create({
      data: { organizationId: orgB, email: `iso-b-${Date.now()}@example.com`, passwordHash: 'x', role: Role.ADMIN, isActive: true },
    });
    actorA = { userId: userA.id, organizationId: orgA, role: 'ADMIN', email: userA.email };
    actorB = { userId: userB.id, organizationId: orgB, role: 'ADMIN', email: userB.email };
  });

  afterAll(async () => {
    await prisma.site.deleteMany({ where: { id: { in: cleanupSiteIds } } });
    await prisma.activityEvent.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await prisma.$disconnect();
  });

  it("org B cannot fetch org A's site by ID, even with the exact real ID", async () => {
    const site = await service.create(actorA, { streetAddress: 'Secret St', city: 'Worcester', state: 'MA' });
    cleanupSiteIds.push(site.id);

    // Org A can fetch its own site.
    await expect(service.findOne(orgA, site.id)).resolves.toMatchObject({ id: site.id });

    // Org B, given the EXACT same real site ID, gets a NotFound — not the
    // data, and not a different error that would leak existence.
    await expect(service.findOne(orgB, site.id)).rejects.toThrow('Site not found');
  });

  it("org B's site list never includes org A's sites", async () => {
    const siteA = await service.create(actorA, { streetAddress: 'Org A Only St', city: 'Worcester', state: 'MA' });
    cleanupSiteIds.push(siteA.id);

    const { items } = await service.list(orgB, {});
    expect(items.some((s) => s.id === siteA.id)).toBe(false);
    expect(items.some((s) => s.streetAddress === 'Org A Only St')).toBe(false);
  });

  it("org B cannot update org A's site by guessing/reusing the ID", async () => {
    const site = await service.create(actorA, { streetAddress: 'Update Target St', city: 'Worcester', state: 'MA' });
    cleanupSiteIds.push(site.id);

    await expect(
      service.update(actorB, site.id, { name: 'Hijacked by org B' }),
    ).rejects.toThrow('Site not found');

    const stillOriginal = await service.findOne(orgA, site.id);
    expect(stillOriginal.name).not.toBe('Hijacked by org B');
  });

  it("org B cannot soft-delete org A's site", async () => {
    const site = await service.create(actorA, { streetAddress: 'Delete Target St', city: 'Worcester', state: 'MA' });
    cleanupSiteIds.push(site.id);

    await expect(service.remove(actorB, site.id)).rejects.toThrow('Site not found');

    const stillThere = await service.findOne(orgA, site.id);
    expect(stillThere.deletedAt).toBeNull();
  });

  it('a soft-deleted site disappears from list/findOne for its OWN organization too', async () => {
    const site = await service.create(actorA, { streetAddress: 'Soft Delete St', city: 'Worcester', state: 'MA' });
    cleanupSiteIds.push(site.id);

    await service.remove(actorA, site.id);

    await expect(service.findOne(orgA, site.id)).rejects.toThrow('Site not found');
    const { items } = await service.list(orgA, {});
    expect(items.some((s) => s.id === site.id)).toBe(false);
  });
});
