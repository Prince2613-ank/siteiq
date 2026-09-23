import { Injectable, Logger } from '@nestjs/common';
import { FieldStatus, FieldType, Prisma, PrismaClient } from '@prisma/client';
import { ParcelMirrorRepository } from '../matching/parcel-mirror.repository';
import { ZoningDistrictRepository } from '../matching/zoning-district.repository';
import { ActivityService } from '../activity/activity.service';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Populates SiteDataField (+ SiteDataFieldApproval + the Site denormalized
 * copy) from a just-confirmed parcel's mirror record — Checkpoint 7's
 * "Parcel + Zoning Enrichment" step.
 *
 * Checkpoint 8 addition: zoning is checked against TWO independent MassGIS
 * sources — the assessor extract's self-reported ZONING field
 * (ParcelMirrorRecord.zoning) and the dedicated statewide Zoning Districts
 * polygon layer (ZoningDistrictMirror, a point-in-polygon lookup). This is
 * genuinely the client's KT §6 scenario ("Source A → 25,000 / Source B →
 * 27,500 / CONFLICT") applied to zoning instead of lot size — real
 * normalize → compare → conflict-or-current logic, not a simplified
 * single-source copy.
 *
 * Every value here is an OBSERVATION with a source, exactly like any other
 * field data (docs/01 §4.2/§8, docs/03 §2.2) — never a direct, unaudited
 * write. A missing value becomes a `FIELD_UNAVAILABLE` row, never a guess.
 */
@Injectable()
export class FieldEnrichmentService {
  private readonly logger = new Logger(FieldEnrichmentService.name);

  constructor(
    private mirror: ParcelMirrorRepository,
    private zoningDistricts: ZoningDistrictRepository,
    private activity: ActivityService,
  ) { }

  /**
   * Runs inside the confirmation transaction (candidate-confirmation.service.ts)
   * so a Site is never left "confirmed" without its enrichment attempt, or
   * vice versa — one atomic step, not two that could get out of sync.
   *
   * Per the client's Checkpoint 7 review: a missing/unavailable field must
   * NEVER cause parcel confirmation itself to fail. Every code path below
   * writes SOMETHING (an available observation or a FIELD_UNAVAILABLE one)
   * and returns normally — there is no throw in here that would roll back
   * the surrounding confirmation transaction over a data-completeness gap.
   */
  async enrich(tx: Tx, siteId: string, parcelRef: string, approvedById: string, organizationId: string) {
    const parcel = await this.mirror.findByParcelRef(parcelRef);
    if (!parcel) {
      this.logger.warn(`No mirror record found for confirmed parcel ${parcelRef} — enrichment skipped`);
      return;
    }

    // Single-source fields — unchanged from Checkpoint 7.
    await this.writeSingleSourceField(tx, siteId, 'lot_size', FieldType.NUMBER, parcel.lotSize, parcel.sourceName, parcel.sourceRefreshedAt, approvedById);
    await this.writeSingleSourceField(tx, siteId, 'use_code', FieldType.STRING, parcel.useCode, parcel.sourceName, parcel.sourceRefreshedAt, approvedById);

    // Zoning — TWO independent sources, compared (Checkpoint 8).
    await this.enrichZoning(tx, siteId, organizationId, parcelRef, parcel, approvedById);

    // Denormalized Site copies + real geometry — lot size always safe to
    // set (single source); zoningCode is set inside enrichZoning only when
    // there was no conflict, so it's deliberately NOT touched here.
    await tx.$executeRawUnsafe(
      `UPDATE "Site" SET "lotSize" = $1, "lotSizeUnit" = $2,
         latitude = ST_Y(pm.centroid), longitude = ST_X(pm.centroid), "parcelGeom" = pm.geom
       FROM "ParcelMirrorRecord" pm
       WHERE "Site".id = $3 AND pm."parcelRef" = $4`,
      parcel.lotSize,
      parcel.lotSizeUnit,
      siteId,
      parcelRef,
    );
  }

  private async enrichZoning(
    tx: Tx,
    siteId: string,
    organizationId: string,
    parcelRef: string,
    parcel: { zoning: string | null; sourceName: string; sourceRefreshedAt: Date },
    approvedById: string,
  ) {
    const centroid = await this.mirror.findCentroid(parcelRef);
    const districtMatch = centroid ? await this.zoningDistricts.findForPoint(centroid.lat, centroid.lng) : null;

    const sourceAValue = parcel.zoning; // assessor extract
    const sourceBValue = districtMatch?.zone ?? null; // dedicated zoning districts layer

    const sourceARow = await tx.siteDataField.create({
      data: {
        siteId,
        fieldName: 'zoning_code',
        fieldType: FieldType.STRING,
        value: (sourceAValue ?? null) as Prisma.InputJsonValue,
        sourceName: parcel.sourceName,
        sourceUrl: null,
        retrievedAt: parcel.sourceRefreshedAt,
        status: sourceAValue ? FieldStatus.MATCHED : FieldStatus.FIELD_UNAVAILABLE,
        confidence: null,
        isCurrent: false, // set below, once we know if there's a conflict
      },
    });

    const sourceBRow = await tx.siteDataField.create({
      data: {
        siteId,
        fieldName: 'zoning_code',
        fieldType: FieldType.STRING,
        value: (sourceBValue ?? null) as Prisma.InputJsonValue,
        sourceName: districtMatch?.sourceName ?? 'MassGIS Zoning Districts',
        sourceUrl: null,
        retrievedAt: districtMatch?.sourceRefreshedAt ?? new Date(),
        status: sourceBValue ? FieldStatus.MATCHED : FieldStatus.FIELD_UNAVAILABLE,
        confidence: null,
        isCurrent: false,
      },
    });

    if (sourceAValue && sourceBValue && sourceAValue !== sourceBValue) {
      // CONFLICT — both preserved, neither wins automatically (KT §6/§10).
      await tx.siteDataField.updateMany({
        where: { id: { in: [sourceARow.id, sourceBRow.id] } },
        data: { status: FieldStatus.CONFLICTING },
      });
      await tx.activityEvent.create({
        data: {
          organizationId,
          siteId,
          eventType: 'field_conflict_detected',
          metadata: {
            fieldName: 'zoning_code',
            sourceA: { name: parcel.sourceName, value: sourceAValue },
            sourceB: { name: districtMatch?.sourceName, value: sourceBValue },
          } as any,
        },
      });
      this.logger.warn(`Zoning conflict for site ${siteId}: "${sourceAValue}" (assessor) vs. "${sourceBValue}" (zoning districts)`);
      return; // Site.zoningCode is NOT set — stays whatever it was (null on first enrichment)
    }

    // No conflict: agreement, or exactly one source had a value, or neither did.
    const winner = sourceAValue ? sourceARow : sourceBValue ? sourceBRow : null;
    if (winner) {
      await tx.siteDataField.update({ where: { id: winner.id }, data: { isCurrent: true } });
      await tx.siteDataFieldApproval.create({
        data: {
          siteId,
          fieldName: 'zoning_code',
          approvedFieldId: winner.id,
          approvedById,
          note:
            sourceAValue && sourceBValue
              ? 'Both zoning sources agree — automatically accepted.'
              : 'Only one zoning source had a value — automatically accepted, no conflict to resolve.',
        },
      });
      await tx.$executeRawUnsafe(`UPDATE "Site" SET "zoningCode" = $1 WHERE id = $2`, sourceAValue ?? sourceBValue, siteId);
    }
    // If neither source had a value, both rows stay FIELD_UNAVAILABLE,
    // isCurrent=false, Site.zoningCode untouched (null) — genuinely
    // unavailable, not guessed.
  }

  private async writeSingleSourceField(
    tx: Tx,
    siteId: string,
    fieldName: string,
    fieldType: FieldType,
    value: string | number | null,
    sourceName: string,
    retrievedAt: Date,
    approvedById: string,
  ) {
    const isAvailable = value !== null && value !== undefined && value !== '';

    const field = await tx.siteDataField.create({
      data: {
        siteId,
        fieldName,
        fieldType,
        value: (isAvailable ? value : null) as Prisma.InputJsonValue,
        numericValue: fieldType === FieldType.NUMBER && isAvailable ? (value as number) : null,
        sourceName,
        sourceUrl: null,
        retrievedAt,
        status: isAvailable ? FieldStatus.MATCHED : FieldStatus.FIELD_UNAVAILABLE,
        confidence: null,
        isCurrent: isAvailable,
      },
    });

    if (isAvailable) {
      await tx.siteDataFieldApproval.create({
        data: {
          siteId,
          fieldName,
          approvedFieldId: field.id,
          approvedById,
          note: 'Automatically populated from the confirmed parcel — single source, no conflict to resolve.',
        },
      });
    }
  }
}
