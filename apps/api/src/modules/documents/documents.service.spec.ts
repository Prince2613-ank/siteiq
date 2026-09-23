import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  writeFileSync: jest.fn((...args: unknown[]) => (jest.requireActual('fs') as typeof fs).writeFileSync(...(args as [any, any]))),
}));
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { DocumentsService } from './documents.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * Checkpoint 11 follow-up — failure injection: "document upload failure."
 * The client's acceptance condition is that the site stays usable and the
 * failure is understandable/retryable, not a corrupted half-written state.
 */
describe('DocumentsService (integration)', () => {
  let prisma: PrismaClient;
  let service: DocumentsService;
  let orgId: string;
  let siteId: string;
  let actor: AuthenticatedUser;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new DocumentsService(prisma as any, new ActivityService(prisma as any));

    const org = await prisma.organization.create({ data: { name: 'Documents Test Org' } });
    orgId = org.id;
    const user = await prisma.user.create({
      data: { organizationId: orgId, email: `docs-test-${Date.now()}@example.com`, passwordHash: 'x', role: 'ADMIN', isActive: true },
    });
    actor = { userId: user.id, organizationId: orgId, role: 'ADMIN', email: user.email };

    const site = await prisma.site.create({
      data: {
        organizationId: orgId,
        streetAddress: 'Docs Test St',
        city: 'Worcester',
        state: 'MA',
        municipality: 'Worcester',
        originalInputType: 'address',
        originalInputAddress: 'Docs Test St, Worcester, MA',
        identityStatus: 'MANUAL',
        createdById: actor.userId,
      },
    });
    siteId = site.id;
  });

  afterAll(async () => {
    await prisma.document.deleteMany({ where: { siteId } });
    await prisma.activityEvent.deleteMany({ where: { siteId } });
    await prisma.site.deleteMany({ where: { id: siteId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it('a genuine disk-write failure rejects cleanly and leaves no orphaned document row', async () => {
    (fs.writeFileSync as jest.Mock).mockImplementationOnce(() => {
      throw new Error('ENOSPC: no space left on device');
    });

    await expect(
      service.upload(actor, siteId, { originalname: 'plan.pdf', mimetype: 'application/pdf', size: 10, buffer: Buffer.from('x') }, 'Site Plan'),
    ).rejects.toThrow('ENOSPC');

    // No half-written document row for a file that was never actually saved.
    const docs = await prisma.document.findMany({ where: { siteId } });
    expect(docs.length).toBe(0);
  });

  it('the site remains fully usable after a failed upload — a subsequent real upload still succeeds', async () => {
    const doc = await service.upload(
      actor,
      siteId,
      { originalname: 'survey.pdf', mimetype: 'application/pdf', size: 11, buffer: Buffer.from('real bytes') },
      'Survey',
    );
    expect(doc.filename).toBe('survey.pdf');

    const docs = await service.list(orgId, siteId);
    expect(docs.some((d) => d.id === doc.id)).toBe(true);
  });
});
