import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface LogActivityInput {
  organizationId: string;
  siteId?: string;
  actorId?: string;
  eventType: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Every meaningful mutation gets an ActivityEvent row (KT §13 / docs/01 §4).
 * Centralized here so every module logs the same shape rather than each
 * writing its own ad hoc entry.
 */
@Injectable()
export class ActivityService {
  constructor(private prisma: PrismaService) {}

  log(input: LogActivityInput) {
    return this.prisma.activityEvent.create({
      data: {
        organizationId: input.organizationId,
        siteId: input.siteId,
        actorId: input.actorId,
        eventType: input.eventType,
        metadata: input.metadata,
      },
    });
  }

  listForSite(siteId: string, organizationId: string) {
    return this.prisma.activityEvent.findMany({
      where: { siteId, organizationId },
      orderBy: { createdAt: 'desc' },
      include: { actor: { select: { id: true, email: true } } },
    });
  }
}
