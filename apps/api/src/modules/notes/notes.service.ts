import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class NotesService {
  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
  ) {}

  async list(organizationId: string, siteId: string) {
    await this.assertSiteInOrg(organizationId, siteId);
    return this.prisma.note.findMany({
      where: { siteId },
      orderBy: { createdAt: 'desc' },
      include: { author: { select: { id: true, email: true } } },
    });
  }

  async create(actor: AuthenticatedUser, siteId: string, body: string) {
    await this.assertSiteInOrg(actor.organizationId, siteId);

    const note = await this.prisma.note.create({
      data: { siteId, authorId: actor.userId, body },
      include: { author: { select: { id: true, email: true } } },
    });

    await this.activity.log({
      organizationId: actor.organizationId,
      siteId,
      actorId: actor.userId,
      eventType: 'note_added',
    });

    return note;
  }

  private async assertSiteInOrg(organizationId: string, siteId: string) {
    const site = await this.prisma.site.findFirst({
      where: { id: siteId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!site) throw new NotFoundException('Site not found');
  }
}
