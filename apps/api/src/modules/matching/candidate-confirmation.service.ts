import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { CandidateStatus, DuplicateDecision, IdentityStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { FieldEnrichmentService } from '../fields/field-enrichment.service';
import { ParcelMirrorRepository } from './parcel-mirror.repository';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

export interface ConfirmCandidateInput {
  note?: string;
  duplicateDecision?: DuplicateDecision;
}

/**
 * Implements docs/03-data-model-api-contract.md §2 / §2.0 / §2.1 exactly —
 * the confirmation write the client specifically reviewed and required
 * server-side enforcement for, not just a UI convention.
 */
@Injectable()
export class CandidateConfirmationService {
  private readonly logger = new Logger(CandidateConfirmationService.name);

  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
    private enrichment: FieldEnrichmentService,
    private mirror: ParcelMirrorRepository,
  ) {}

  async listAttempts(organizationId: string, siteId: string) {
    await this.assertSiteInOrg(organizationId, siteId);
    return this.prisma.matchAttempt.findMany({
      where: { siteId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listCandidates(organizationId: string, siteId: string, attemptId: string) {
    await this.assertSiteInOrg(organizationId, siteId);
    const candidates = await this.prisma.siteMatchCandidate.findMany({
      where: { siteId, attemptId },
      orderBy: { rank: 'asc' },
      include: { duplicateOfSite: { select: { id: true, name: true, streetAddress: true, city: true } } },
    });

    // Real parcel boundaries for the map (Checkpoint 7) — never fabricated;
    // a candidate whose parcelRef isn't in the mirror simply gets no
    // geometry attached, the map just won't draw a boundary for it.
    const parcelRefs = candidates.map((c) => c.parcelRef).filter((r): r is string => r !== null);
    const geoByParcelRef = await this.mirror.findGeoJson(parcelRefs);
    return candidates.map((c) => ({
      ...c,
      geometry: c.parcelRef ? (geoByParcelRef.get(c.parcelRef) ?? null) : null,
    }));
  }

  async confirm(
    actor: AuthenticatedUser,
    siteId: string,
    attemptId: string,
    candidateId: string,
    input: ConfirmCandidateInput,
  ) {
    const site = await this.assertSiteInOrg(actor.organizationId, siteId);

    const candidate = await this.prisma.siteMatchCandidate.findFirst({
      where: { id: candidateId, siteId, attemptId },
    });
    if (!candidate) throw new NotFoundException('Candidate not found');
    if (candidate.status !== CandidateStatus.PROPOSED) {
      throw new UnprocessableEntityException('This candidate has already been decided');
    }

    // §2.0 — server-enforced duplicate decision. Not just a UI convention:
    // this is checked against the flag the WORKER set on the candidate row
    // at creation time, which the caller cannot influence.
    const requestedDecision = input.duplicateDecision ?? DuplicateDecision.NONE;
    if (candidate.duplicateOfSiteId && requestedDecision === DuplicateDecision.NONE) {
      throw new UnprocessableEntityException(
        `This candidate matches parcel ${candidate.parcelRef} on an existing active site; specify OPENED_EXISTING or CONTINUED_SEPARATE.`,
      );
    }
    if (!candidate.duplicateOfSiteId && requestedDecision !== DuplicateDecision.NONE) {
      throw new UnprocessableEntityException(
        'A duplicate decision was provided, but this candidate is not flagged as a duplicate of any existing site.',
      );
    }

    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. The candidate row IS the permanent confirmation record.
      const updatedCandidate = await tx.siteMatchCandidate.update({
        where: { id: candidate.id },
        data: {
          status: CandidateStatus.ACCEPTED,
          decidedById: actor.userId,
          decidedAt: now,
          note: input.note,
          duplicateDecision: requestedDecision,
        },
      });

      // 2. Siblings from the same attempt are rejected, not deleted.
      await tx.siteMatchCandidate.updateMany({
        where: { attemptId, siteId, id: { not: candidate.id }, status: CandidateStatus.PROPOSED },
        data: { status: CandidateStatus.REJECTED },
      });

      if (requestedDecision === DuplicateDecision.OPENED_EXISTING) {
        // 4. Redirect: this site is abandoned in favor of the existing one.
        await tx.site.update({
          where: { id: siteId },
          data: { deletedAt: now, mergedIntoSiteId: candidate.duplicateOfSiteId },
        });
      } else {
        // 3. Site's confirmed IDENTITY is updated from the candidate.
        // streetAddress is resolved from the confirmed parcel's mirror
        // record (client requirement — property address discovery): when
        // the analyst identified the site from coordinates/town/location
        // clues rather than a known address, this is the FIRST time the
        // site gets a real street address. originalInput* is never touched
        // — this only updates the confirmed/current address, same as
        // parcelRef/municipality above.
        const matchAttempt = await tx.matchAttempt.findUniqueOrThrow({ where: { id: attemptId } });
        await tx.site.update({
          where: { id: siteId },
          data: {
            confirmedCandidateId: candidate.id,
            identityStatus: IdentityStatus.CONFIRMED,
            parcelRef: candidate.parcelRef,
            streetAddress: candidate.matchedAddress ?? site.streetAddress,
            municipality: candidate.municipality ?? site.municipality,
            matchConfidence: candidate.confidence,
            matchMethod: matchAttempt.strategyUsed,
          },
        });

        // 3b. Field enrichment (Checkpoint 7) — populates lot size/zoning/use
        // code from the confirmed parcel's mirror record, through the SAME
        // provenance system (SiteDataField + SiteDataFieldApproval) every
        // other observation goes through. Runs in this same transaction so
        // a Site can never end up CONFIRMED without its enrichment attempt,
        // or the reverse.
        // Enrichment reads from an external-data mirror (Checkpoint 7/8) —
        // a failure there (e.g. a DB hiccup on the mirror tables) must
        // never destroy the parcel-identity confirmation itself. Identity
        // and field data are separate concerns (docs/01/03): if enrichment
        // throws, the fields simply stay absent (same visible state as
        // "unavailable"), logged distinctly so it's diagnosable and
        // re-enrichment can be retried later — but confirmation, the thing
        // the analyst actually clicked, still succeeds.
        if (candidate.parcelRef) {
          // A SQL failure aborts a PostgreSQL transaction even when JavaScript
          // catches the error. Isolate enrichment so confirmation can survive
          // a database error and any partial enrichment writes are discarded.
          await tx.$executeRawUnsafe('SAVEPOINT field_enrichment');
          try {
            await this.enrichment.enrich(tx, siteId, candidate.parcelRef, actor.userId, actor.organizationId);
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT field_enrichment');
          } catch (err) {
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT field_enrichment');
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT field_enrichment');
            const message = (err as Error).message;
            this.logger.error(`Field enrichment failed for site ${siteId} (parcel ${candidate.parcelRef}): ${message}`);
            await tx.activityEvent.create({
              data: {
                organizationId: actor.organizationId,
                siteId,
                actorId: actor.userId,
                eventType: 'enrichment_failed',
                metadata: { parcelRef: candidate.parcelRef, error: message } as any,
              },
            });
          }
        }
      }

      // 5. Confirmation activity event, always.
      await tx.activityEvent.create({
        data: {
          organizationId: actor.organizationId,
          siteId,
          actorId: actor.userId,
          eventType: 'parcel_confirmed',
          metadata: {
            candidateId: candidate.id,
            attemptId,
            parcelRef: candidate.parcelRef,
            confidence: candidate.confidence,
            evidence: candidate.evidence as any,
            duplicateDecision: requestedDecision,
            duplicateOfSiteId: candidate.duplicateOfSiteId,
          } as any,
        },
      });

      // §2.1 — duplicate decision recorded on BOTH sites, same shape.
      if (requestedDecision !== DuplicateDecision.NONE && candidate.duplicateOfSiteId) {
        const canonicalSiteId =
          requestedDecision === DuplicateDecision.OPENED_EXISTING
            ? candidate.duplicateOfSiteId
            : siteId;
        const sharedMetadata = {
          consideredDuplicateSiteId:
            requestedDecision === DuplicateDecision.OPENED_EXISTING
              ? siteId
              : candidate.duplicateOfSiteId,
          canonicalSiteId,
          action: requestedDecision === DuplicateDecision.OPENED_EXISTING ? 'merged' : 'dismissed',
          sourceCandidateId: candidate.id,
        };
        for (const targetSiteId of [siteId, candidate.duplicateOfSiteId]) {
          await tx.activityEvent.create({
            data: {
              organizationId: actor.organizationId,
              siteId: targetSiteId,
              actorId: actor.userId,
              eventType: 'duplicate_decision_recorded',
              metadata: sharedMetadata as any,
            },
          });
        }
      }

      return updatedCandidate;
    });

    return {
      confirmedCandidate: result,
      site: await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } }),
    };
  }

  async rejectAll(actor: AuthenticatedUser, siteId: string, attemptId: string) {
    await this.assertSiteInOrg(actor.organizationId, siteId);

    await this.prisma.$transaction([
      this.prisma.siteMatchCandidate.updateMany({
        where: { siteId, attemptId, status: CandidateStatus.PROPOSED },
        data: { status: CandidateStatus.REJECTED },
      }),
      this.prisma.site.update({
        where: { id: siteId },
        data: { identityStatus: IdentityStatus.MANUAL },
      }),
    ]);

    await this.activity.log({
      organizationId: actor.organizationId,
      siteId,
      actorId: actor.userId,
      eventType: 'candidates_rejected_manual_entry',
      metadata: { attemptId },
    });

    return { ok: true };
  }

  private async assertSiteInOrg(organizationId: string, siteId: string) {
    const site = await this.prisma.site.findFirst({ where: { id: siteId, organizationId } });
    if (!site) throw new NotFoundException('Site not found');
    return site;
  }
}
