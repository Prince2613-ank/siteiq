import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { IdentityStatus, InvestigationStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { QueueService } from '../../queue/queue.service';
import { ParcelMirrorRepository } from '../matching/parcel-mirror.repository';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

export interface CreateSiteInput {
  name?: string;
  streetAddress?: string;
  city: string;
  state: string;
  zip?: string;
  parcelRef?: string;
  lat?: number;
  lng?: number;
  locationText?: string;
  locationDescription?: string;
  facilityId?: string;
  assignedAnalystId?: string;
}

export interface UpdateSiteInput {
  name?: string;
  assignedAnalystId?: string | null;
  investigationStatus?: InvestigationStatus;
}

export interface ListSitesQuery {
  search?: string;
  investigationStatus?: string;
  municipality?: string;
  assignedAnalystId?: string;
  cursor?: string;
  limit?: number;
}

/**
 * Checkpoint 4 scope: sites are created directly with identityStatus =
 * MANUAL — the automated matching pipeline (MatchAttempt/SiteMatchCandidate,
 * docs/02 + docs/03) is explicitly deferred to the next checkpoint per the
 * client's instruction not to build it yet. This is real, permanent
 * behavior for a manually-identified site, not a stub — a site created this
 * way stays MANUAL until someone runs an explicit re-match once that
 * pipeline exists.
 */
@Injectable()
export class SitesService {
  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
    private queue: QueueService,
    private mirror: ParcelMirrorRepository,
  ) {}

  /** Confirmed parcel's real boundary + centroid, for the site's Map tab
   * (Checkpoint 7). Returns null geometry if not yet confirmed — never a
   * placeholder shape. */
  async findGeometry(organizationId: string, id: string) {
    const site = await this.findOne(organizationId, id);
    if (!site.parcelRef) return { boundary: null, centroid: null };
    const geo = await this.mirror.findGeoJson([site.parcelRef]);
    return geo.get(site.parcelRef) ?? { boundary: null, centroid: null };
  }

  async create(actor: AuthenticatedUser, input: CreateSiteInput) {
    if (input.assignedAnalystId) {
      await this.assertAnalystInOrg(actor.organizationId, input.assignedAnalystId);
    }

    // Street address is now optional (client requirement — location-based
    // identification): only build a formatted address string when one was
    // actually supplied. A site identified by town + coordinates + a
    // street/location clue has no full address to preserve here — that's
    // expected, not a gap; the exact address is resolved later from the
    // confirmed parcel (see CandidateConfirmationService.confirm).
    const originalInputAddress = input.streetAddress
      ? `${input.streetAddress}, ${input.city}, ${input.state} ${input.zip ?? ''}`.trim()
      : null;

    const hasCoordinates = input.lat !== undefined && input.lng !== undefined;
    const originalInputType = input.parcelRef
      ? 'parcel_id'
      : input.streetAddress && hasCoordinates
        ? 'address_and_coordinates'
        : input.streetAddress
          ? 'address'
          : 'location_clues';

    const site = await this.prisma.site.create({
      data: {
        organizationId: actor.organizationId,
        name: input.name,
        streetAddress: input.streetAddress,
        city: input.city,
        state: input.state,
        zip: input.zip,
        municipality: input.city,
        originalInputType,
        originalInputAddress,
        originalInputParcelRef: input.parcelRef,
        originalInputLat: input.lat,
        originalInputLng: input.lng,
        originalInputLocationText: input.locationText,
        originalInputLocationDescription: input.locationDescription,
        originalInputFacilityId: input.facilityId,
        // Automated matching (docs/02/03) takes it from here — the pipeline
        // decides NEEDS_REVIEW vs. NO_MATCH once candidates come back.
        identityStatus: IdentityStatus.IDENTIFYING,
        investigationStatus: InvestigationStatus.NEW,
        assignedAnalystId: input.assignedAnalystId,
        createdById: actor.userId,
      },
    });

    await this.activity.log({
      organizationId: actor.organizationId,
      siteId: site.id,
      actorId: actor.userId,
      eventType: 'site_created',
      metadata: { streetAddress: input.streetAddress, city: input.city, locationText: input.locationText },
    });

    await this.queue.enqueuePropertyMatch({
      siteId: site.id,
      input: {
        // When a parcel ID is the primary input, streetAddress/city are
        // still required by the form for display purposes (KT §4.2 asks
        // for name/address/city on every site) but are NOT a genuine
        // address the analyst is asking us to match against — passing
        // them into the matching pipeline would score a real parcel-ID
        // resolution against irrelevant text and drag down what should be
        // near-certain confidence. Address matching and parcel-ID lookup
        // are two different input modes (docs/02 §2); don't blend them.
        address: input.parcelRef ? undefined : (originalInputAddress ?? undefined),
        parcelRef: input.parcelRef,
        lat: input.lat,
        lng: input.lng,
        municipality: input.city,
        locationText: input.locationText,
        locationDescription: input.locationDescription,
      },
      triggeredById: actor.userId,
    });

    return site;
  }

  async list(organizationId: string, query: ListSitesQuery) {
    const where: Prisma.SiteWhereInput = {
      organizationId,
      deletedAt: null,
    };
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { streetAddress: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.investigationStatus) {
      where.investigationStatus = query.investigationStatus as InvestigationStatus;
    }
    if (query.municipality) {
      where.municipality = { equals: query.municipality, mode: 'insensitive' };
    }
    if (query.assignedAnalystId) {
      where.assignedAnalystId = query.assignedAnalystId;
    }

    const limit = query.limit ?? 25;
    const items = await this.prisma.site.findMany({
      where,
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: { updatedAt: 'desc' },
      include: {
        assignedAnalyst: { select: { id: true, email: true } },
      },
    });

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async findOne(organizationId: string, id: string) {
    const site = await this.prisma.site.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        assignedAnalyst: { select: { id: true, email: true } },
        createdBy: { select: { id: true, email: true } },
      },
    });
    if (!site) throw new NotFoundException('Site not found');
    return site;
  }

  async update(actor: AuthenticatedUser, id: string, input: UpdateSiteInput) {
    const site = await this.findOne(actor.organizationId, id);

    if (input.assignedAnalystId) {
      await this.assertAnalystInOrg(actor.organizationId, input.assignedAnalystId);
    }

    const updated = await this.prisma.site.update({
      where: { id: site.id },
      data: {
        name: input.name,
        assignedAnalystId:
          input.assignedAnalystId === undefined ? undefined : input.assignedAnalystId,
        investigationStatus: input.investigationStatus,
      },
    });

    if (input.assignedAnalystId !== undefined) {
      await this.activity.log({
        organizationId: actor.organizationId,
        siteId: site.id,
        actorId: actor.userId,
        eventType: 'assignment_changed',
        metadata: { assignedAnalystId: input.assignedAnalystId },
      });
    }
    if (input.investigationStatus) {
      await this.activity.log({
        organizationId: actor.organizationId,
        siteId: site.id,
        actorId: actor.userId,
        eventType: 'status_changed',
        metadata: { investigationStatus: input.investigationStatus },
      });
    }

    return updated;
  }

  async remove(actor: AuthenticatedUser, id: string) {
    // Admin-only soft delete, enforced again here (not just via @Roles on
    // the controller) since this is the kind of action worth defending in
    // depth — see docs/01 §6.1.
    if (actor.role !== Role.ADMIN) {
      throw new ForbiddenException('Only an Administrator can archive a site');
    }
    const site = await this.findOne(actor.organizationId, id);
    await this.prisma.site.update({
      where: { id: site.id },
      data: { deletedAt: new Date() },
    });
    await this.activity.log({
      organizationId: actor.organizationId,
      siteId: site.id,
      actorId: actor.userId,
      eventType: 'site_archived',
    });
    return { ok: true };
  }

  private async assertAnalystInOrg(organizationId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId, isActive: true },
    });
    if (!user) throw new NotFoundException('Assigned user not found in this organization');
  }
}
