import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FieldsService {
  constructor(private prisma: PrismaService) {}

  async listForSite(organizationId: string, siteId: string) {
    await this.assertSiteInOrg(organizationId, siteId);
    const fields = await this.prisma.siteDataField.findMany({
      where: { siteId },
      orderBy: { createdAt: 'desc' },
    });

    // Grouped by fieldName so the UI can render "current value + full
    // history" per field without re-deriving it client-side.
    const grouped = new Map<string, typeof fields>();
    for (const f of fields) {
      const list = grouped.get(f.fieldName) ?? [];
      list.push(f);
      grouped.set(f.fieldName, list);
    }
    return Array.from(grouped.entries()).map(([fieldName, observations]) => ({
      fieldName,
      current: observations.find((o) => o.isCurrent) ?? null,
      observations,
    }));
  }

  async listApprovals(organizationId: string, siteId: string, fieldName: string) {
    await this.assertSiteInOrg(organizationId, siteId);
    return this.prisma.siteDataFieldApproval.findMany({
      where: { siteId, fieldName },
      orderBy: { approvedAt: 'desc' },
      include: { approvedBy: { select: { id: true, email: true } } },
    });
  }

  private async assertSiteInOrg(organizationId: string, siteId: string) {
    const site = await this.prisma.site.findFirst({ where: { id: siteId, organizationId } });
    if (!site) throw new NotFoundException('Site not found');
  }
}
