import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { QueueService } from '../../queue/queue.service';
import { AnalysisService } from './analysis.service';

@Controller('sites/:siteId/analysis-runs')
@UseGuards(RolesGuard)
export class AnalysisController {
  constructor(
    private analysisService: AnalysisService,
    private queue: QueueService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Param('siteId') siteId: string) {
    return this.analysisService.listForSite(user.organizationId, siteId);
  }

  @Post()
  @Roles(Role.ADMIN, Role.ANALYST)
  async create(@CurrentUser() user: AuthenticatedUser, @Param('siteId') siteId: string) {
    const run = await this.analysisService.createRun(user, siteId);
    await this.queue.enqueueAnalysis({ runId: run.id });
    return run;
  }
}

@Controller('analysis-runs')
@UseGuards(RolesGuard)
export class AnalysisRunController {
  constructor(
    private analysisService: AnalysisService,
    private queue: QueueService,
  ) {}

  @Get(':id')
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.analysisService.getOne(user.organizationId, id);
  }

  @Post(':id/retry')
  @Roles(Role.ADMIN, Role.ANALYST)
  async retry(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const run = await this.analysisService.retry(user, id);
    await this.queue.enqueueAnalysis({ runId: run.id });
    return run;
  }
}
