import { Injectable, NotFoundException } from '@nestjs/common';
import { IdentityStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { InvestigationDataService } from '../analysis/investigation-data.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { REPORT_AUDIT_EVENT_TYPES, ReportSnapshot } from './report-snapshot';

/**
 * Checkpoint 10 — generates and reads immutable report snapshots. There is
 * deliberately no `update()` method anywhere in this class: once
 * `Report.contentSnapshot` is written by `generate()`, nothing in the
 * codebase can change it. `getOne()` always renders straight from that
 * stored JSON, never re-joining live Site/SiteDataField/Document data —
 * this is what makes "the September 7 report still says what was true on
 * September 7" true by construction, not by convention.
 */
@Injectable()
export class ReportsService {
  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
    private investigationData: InvestigationDataService,
  ) {}

  async listForSite(organizationId: string, siteId: string) {
    await this.assertSiteInOrg(organizationId, siteId);
    return this.prisma.report.findMany({
      where: { siteId },
      orderBy: { generatedAt: 'desc' },
      include: { generatedBy: { select: { id: true, email: true } } },
    });
  }

  async getOne(organizationId: string, reportId: string) {
    const report = await this.prisma.report.findFirst({
      where: { id: reportId, site: { organizationId } },
      include: { generatedBy: { select: { id: true, email: true } } },
    });
    if (!report) throw new NotFoundException('Report not found');
    return report;
  }

  async generate(actor: AuthenticatedUser, siteId: string) {
    const site = await this.assertSiteInOrg(actor.organizationId, siteId);

    // Everything below is read ONCE, right now, and frozen — this is the
    // entire immutability mechanism: there's no lazy/computed field on
    // Report, only this one write.
    const [summary, siteWithCandidate, documents, latestRun, events] = await Promise.all([
      this.investigationData.buildSummary(siteId),
      this.prisma.site.findUniqueOrThrow({
        where: { id: siteId },
        include: { confirmedCandidate: { include: { decidedBy: { select: { email: true } } } } },
      }),
      this.prisma.document.findMany({
        where: { siteId, deletedAt: null },
        include: { uploadedBy: { select: { email: true } } },
        orderBy: { uploadedAt: 'asc' },
      }),
      this.prisma.analysisRun.findFirst({
        where: { siteId, status: { in: ['COMPLETED', 'FAILED'] } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.activityEvent.findMany({
        where: { siteId, eventType: { in: REPORT_AUDIT_EVENT_TYPES } },
        include: { actor: { select: { email: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const isPreliminary = site.identityStatus !== IdentityStatus.CONFIRMED;

    const snapshot: ReportSnapshot = {
      snapshotVersion: 1,
      generatedAt: new Date().toISOString(),
      generatedBy: actor.email,
      isPreliminary,
      identity: {
        originalInputType: siteWithCandidate.originalInputType,
        originalInputAddress: siteWithCandidate.originalInputAddress,
        originalInputParcelRef: siteWithCandidate.originalInputParcelRef,
        matchedAddress: siteWithCandidate.confirmedCandidate?.matchedAddress ?? null,
        parcelRef: siteWithCandidate.parcelRef,
        identityStatus: siteWithCandidate.identityStatus,
        matchConfidence: siteWithCandidate.matchConfidence,
        matchMethod: siteWithCandidate.matchMethod,
        confirmedBy: siteWithCandidate.confirmedCandidate?.decidedBy?.email ?? null,
        confirmedAt: siteWithCandidate.confirmedCandidate?.decidedAt?.toISOString() ?? null,
      },
      propertyData: summary.propertyData,
      investigationQuality: summary.dataQuality,
      documents: documents.map((d) => ({
        filename: d.filename,
        category: d.category,
        uploadedBy: d.uploadedBy.email,
        uploadedAt: d.uploadedAt.toISOString(),
      })),
      analysis: {
        complete: summary.investigation.complete,
        requiredActions: summary.investigation.requiredActions,
        basedOnRun: latestRun
          ? {
              id: latestRun.id,
              completedAt: latestRun.completedAt?.toISOString() ?? null,
              isPreliminary: latestRun.isPreliminary,
              status: latestRun.status,
            }
          : null,
      },
      auditTrail: events.map((e) => ({
        eventType: e.eventType,
        actor: e.actor?.email ?? null,
        createdAt: e.createdAt.toISOString(),
      })),
    };

    const report = await this.prisma.report.create({
      data: {
        siteId,
        generatedById: actor.userId,
        snapshotVersion: 1,
        contentSnapshot: snapshot as any,
      },
      include: { generatedBy: { select: { id: true, email: true } } },
    });

    await this.activity.log({
      organizationId: actor.organizationId,
      siteId,
      actorId: actor.userId,
      eventType: 'report_generated',
      metadata: { reportId: report.id, isPreliminary },
    });

    return report;
  }

  private async assertSiteInOrg(organizationId: string, siteId: string) {
    const site = await this.prisma.site.findFirst({ where: { id: siteId, organizationId, deletedAt: null } });
    if (!site) throw new NotFoundException('Site not found');
    return site;
  }
}
