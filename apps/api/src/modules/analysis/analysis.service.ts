import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AnalysisStatus, IdentityStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { InvestigationDataService } from './investigation-data.service';

/**
 * Checkpoint 9 — turns collected data into a transparent investigation
 * result. `runAnalysis` is the actual computation (called by the worker);
 * the rest of this class is the REST-facing CRUD around AnalysisRun. The
 * computation itself lives in InvestigationDataService (Checkpoint 10
 * extracted it so report generation can reuse the identical logic).
 */
@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
    private investigationData: InvestigationDataService,
  ) {}

  async listForSite(organizationId: string, siteId: string) {
    await this.assertSiteInOrg(organizationId, siteId);
    return this.prisma.analysisRun.findMany({
      where: { siteId },
      orderBy: { createdAt: 'desc' },
      include: { triggeredBy: { select: { id: true, email: true } } },
    });
  }

  async getOne(organizationId: string, runId: string) {
    const run = await this.prisma.analysisRun.findFirst({
      where: { id: runId, site: { organizationId } },
      include: { triggeredBy: { select: { id: true, email: true } } },
    });
    if (!run) throw new NotFoundException('Analysis run not found');
    return run;
  }

  async createRun(actor: AuthenticatedUser, siteId: string) {
    const site = await this.assertSiteInOrg(actor.organizationId, siteId);

    // isPreliminary is fixed at CREATION time from the site's identity
    // status right now — a run started before confirmation stays
    // preliminary forever, even if the site gets confirmed a moment later
    // (docs/01 ADR discussion, Checkpoint 5) — an analyst re-runs analysis
    // to get a non-preliminary result, it never flips retroactively.
    const isPreliminary = site.identityStatus !== IdentityStatus.CONFIRMED;

    const run = await this.prisma.analysisRun.create({
      data: {
        siteId,
        status: AnalysisStatus.QUEUED,
        isPreliminary,
        triggeredById: actor.userId,
      },
    });

    await this.activity.log({
      organizationId: actor.organizationId,
      siteId,
      actorId: actor.userId,
      eventType: 'analysis_started',
      metadata: { runId: run.id, isPreliminary },
    });

    return run;
  }

  async retry(actor: AuthenticatedUser, runId: string) {
    const run = await this.prisma.analysisRun.findFirst({
      where: { id: runId, site: { organizationId: actor.organizationId } },
      include: { site: true },
    });
    if (!run) throw new NotFoundException('Analysis run not found');

    const isPreliminary = run.site.identityStatus !== IdentityStatus.CONFIRMED;
    const retried = await this.prisma.analysisRun.create({
      data: {
        siteId: run.siteId,
        status: AnalysisStatus.QUEUED,
        isPreliminary,
        triggeredById: actor.userId,
        retryCount: run.retryCount + 1,
      },
    });

    await this.activity.log({
      organizationId: actor.organizationId,
      siteId: run.siteId,
      actorId: actor.userId,
      eventType: 'analysis_retried',
      metadata: { previousRunId: run.id, newRunId: retried.id },
    });

    return retried;
  }

  /** The actual computation — run by the worker, not the API request path
   * (docs/01 §9/§10: long-running work runs asynchronously, never blocks
   * the browser — this is fast today, but the architecture doesn't assume
   * that stays true as more sources get added later). */
  async runAnalysis(runId: string) {
    const run = await this.prisma.analysisRun.findUniqueOrThrow({ where: { id: runId } });

    try {
      await this.prisma.analysisRun.update({
        where: { id: runId },
        data: { status: AnalysisStatus.PROCESSING, startedAt: new Date() },
      });

      const summary = await this.investigationData.buildSummary(run.siteId);

      await this.prisma.analysisRun.update({
        where: { id: runId },
        data: { status: AnalysisStatus.COMPLETED, completedAt: new Date(), result: summary as any },
      });

      await this.activity.log({
        organizationId: (await this.prisma.site.findUniqueOrThrow({ where: { id: run.siteId } })).organizationId,
        siteId: run.siteId,
        eventType: 'analysis_completed',
        metadata: { runId, complete: summary.investigation.complete },
      });

      this.logger.log(`Analysis ${runId} completed for site ${run.siteId}: complete=${summary.investigation.complete}`);
    } catch (err) {
      const message = (err as Error).message;
      await this.prisma.analysisRun.update({
        where: { id: runId },
        data: { status: AnalysisStatus.FAILED, completedAt: new Date(), errorMessage: message },
      });
      this.logger.error(`Analysis ${runId} failed: ${message}`);
    }
  }

  private async assertSiteInOrg(organizationId: string, siteId: string) {
    const site = await this.prisma.site.findFirst({ where: { id: siteId, organizationId, deletedAt: null } });
    if (!site) throw new NotFoundException('Site not found');
    return site;
  }
}
