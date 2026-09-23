import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { DuplicateDecision, Role } from '@prisma/client';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ConfirmCandidateSchema } from '../../common/schemas';
import { CandidateConfirmationService } from './candidate-confirmation.service';
import { QueueService } from '../../queue/queue.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

@Controller('sites/:siteId/match-attempts')
@UseGuards(RolesGuard)
export class MatchAttemptsController {
  constructor(
    private confirmation: CandidateConfirmationService,
    private queue: QueueService,
    private prisma: PrismaService,
  ) {}

  @Get()
  listAttempts(@CurrentUser() user: AuthenticatedUser, @Param('siteId') siteId: string) {
    return this.confirmation.listAttempts(user.organizationId, siteId);
  }

  @Get(':attemptId/candidates')
  listCandidates(
    @CurrentUser() user: AuthenticatedUser,
    @Param('siteId') siteId: string,
    @Param('attemptId') attemptId: string,
  ) {
    return this.confirmation.listCandidates(user.organizationId, siteId, attemptId);
  }

  @Post(':attemptId/candidates/:candidateId/confirm')
  @Roles(Role.ADMIN, Role.ANALYST)
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('siteId') siteId: string,
    @Param('attemptId') attemptId: string,
    @Param('candidateId') candidateId: string,
    @Body(new ZodValidationPipe(ConfirmCandidateSchema))
    body: { note?: string; duplicateDecision?: DuplicateDecision },
  ) {
    return this.confirmation.confirm(user, siteId, attemptId, candidateId, body);
  }

  @Post(':attemptId/reject-all')
  @Roles(Role.ADMIN, Role.ANALYST)
  rejectAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('siteId') siteId: string,
    @Param('attemptId') attemptId: string,
  ) {
    return this.confirmation.rejectAll(user, siteId, attemptId);
  }
}

@Controller('sites/:siteId/re-match')
@UseGuards(RolesGuard)
export class ReMatchController {
  constructor(
    private prisma: PrismaService,
    private queue: QueueService,
  ) {}

  @Post()
  @Roles(Role.ADMIN, Role.ANALYST)
  async reMatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('siteId') siteId: string,
    @Body()
    body: {
      address?: string;
      parcelRef?: string;
      lat?: number;
      lng?: number;
      municipality?: string;
      locationText?: string;
      locationDescription?: string;
    },
  ) {
    const site = await this.prisma.site.findFirst({
      where: { id: siteId, organizationId: user.organizationId, deletedAt: null },
    });
    if (!site) throw new NotFoundException('Site not found');

    // Deliberately NOT setting identityStatus = IDENTIFYING here. This used
    // to write it synchronously for immediate UI feedback, but that meant
    // by the time the worker's runMatchAttempt read the site row to check
    // "was this already CONFIRMED?" (docs/02 §2.3's re-match-conflict
    // rule), the answer had already been overwritten to IDENTIFYING by
    // THIS request — silently defeating the conflict check every time.
    // The worker sets identityStatus itself once it has real results; the
    // frontend's brief "still on the old status" window until then is a
    // fair trade for that check being correct.
    await this.queue.enqueuePropertyMatch({
      siteId,
      input: body,
      triggeredById: user.userId,
    });
    return { ok: true, identityStatus: site.identityStatus };
  }
}
