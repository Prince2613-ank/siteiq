import { Injectable } from '@nestjs/common';
import { IdentityStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FIELD_LABELS,
  InvestigationSummary,
  REQUIRED_DOCUMENT_CATEGORIES,
  REQUIRED_PROPERTY_FIELDS,
  STALE_SOURCE_DAYS,
} from './investigation-summary';

/**
 * The actual "what do we currently know about this site" computation —
 * extracted out of AnalysisService (Checkpoint 9) so Checkpoint 10's
 * report generation can reuse the EXACT same logic rather than
 * re-deriving identity/property-data/data-quality a second, possibly
 * inconsistent way. AnalysisService.runAnalysis calls this and stores the
 * result on an AnalysisRun (mutable — a new run recomputes it fresh);
 * ReportsService calls this and freezes the result permanently into a
 * Report's contentSnapshot (immutable — see docs/03 §2.3, docs/10).
 */
@Injectable()
export class InvestigationDataService {
  constructor(private prisma: PrismaService) {}

  async buildSummary(siteId: string): Promise<InvestigationSummary> {
    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { confirmedCandidate: { include: { decidedBy: { select: { email: true } } } } },
    });

    const fields = await this.prisma.siteDataField.findMany({ where: { siteId } });
    const documents = await this.prisma.document.findMany({ where: { siteId, deletedAt: null } });

    // ── Property data + data quality ──────────────────────────────────
    const propertyData: InvestigationSummary['propertyData'] = [];
    const missingFields: string[] = [];
    const conflictingFields: string[] = [];
    const sourcesUsed = new Set<string>();
    const staleSources: InvestigationSummary['dataQuality']['staleSources'] = [];

    const fieldNames = Array.from(new Set(fields.map((f) => f.fieldName)));
    for (const fieldName of fieldNames) {
      const label = FIELD_LABELS[fieldName] ?? fieldName;
      const observations = fields.filter((f) => f.fieldName === fieldName);
      const current = observations.find((o) => o.isCurrent);
      const hasConflict = observations.some((o) => o.status === 'CONFLICTING');

      if (hasConflict) {
        conflictingFields.push(label);
        propertyData.push({ fieldName, label, status: 'conflicting', value: null, source: null, retrievedAt: null });
        continue;
      }
      if (!current) {
        missingFields.push(label);
        propertyData.push({ fieldName, label, status: 'unavailable', value: null, source: null, retrievedAt: null });
        continue;
      }

      sourcesUsed.add(current.sourceName);
      const ageDays = Math.floor((Date.now() - current.retrievedAt.getTime()) / (1000 * 60 * 60 * 24));
      if (ageDays > STALE_SOURCE_DAYS) {
        staleSources.push({ field: label, source: current.sourceName, ageDays });
      }
      propertyData.push({
        fieldName,
        label,
        status: 'confirmed',
        value: current.value,
        source: current.sourceName,
        retrievedAt: current.retrievedAt.toISOString(),
      });
    }
    for (const required of REQUIRED_PROPERTY_FIELDS) {
      if (!fieldNames.includes(required)) {
        const label = FIELD_LABELS[required] ?? required;
        if (!missingFields.includes(label)) missingFields.push(label);
        propertyData.push({ fieldName: required, label, status: 'unavailable', value: null, source: null, retrievedAt: null });
      }
    }

    // ── Documents ──────────────────────────────────────────────────────
    const uploadedCategories = new Set(documents.map((d) => d.category));
    const missingDocs = REQUIRED_DOCUMENT_CATEGORIES.filter((c) => !uploadedCategories.has(c));

    // ── Investigation completeness ────────────────────────────────────
    const requiredActions: string[] = [];
    if (site.identityStatus !== IdentityStatus.CONFIRMED) {
      requiredActions.push('Confirm the property identity');
    }
    for (const label of conflictingFields) {
      requiredActions.push(`Resolve conflicting ${label.toLowerCase()} information`);
    }
    for (const requiredField of REQUIRED_PROPERTY_FIELDS) {
      const label = FIELD_LABELS[requiredField] ?? requiredField;
      if (missingFields.includes(label) && !conflictingFields.includes(label)) {
        requiredActions.push(`${label} information is unavailable from automated sources — investigate manually`);
      }
    }
    for (const category of missingDocs) {
      requiredActions.push(`Upload ${category}`);
    }

    const complete =
      site.identityStatus === IdentityStatus.CONFIRMED &&
      conflictingFields.length === 0 &&
      REQUIRED_PROPERTY_FIELDS.every((f) => !missingFields.includes(FIELD_LABELS[f] ?? f)) &&
      missingDocs.length === 0;

    return {
      generatedAt: new Date().toISOString(),
      identity: {
        status: site.identityStatus,
        parcelRef: site.parcelRef,
        confidence: site.matchConfidence,
        method: site.matchMethod,
        confirmedAt: site.confirmedCandidate?.decidedAt?.toISOString() ?? null,
        confirmedBy: site.confirmedCandidate?.decidedBy?.email ?? null,
      },
      propertyData,
      dataQuality: {
        missingFields,
        conflictingFields,
        sourcesUsed: Array.from(sourcesUsed),
        staleSources,
      },
      documents: {
        required: [...REQUIRED_DOCUMENT_CATEGORIES],
        uploaded: documents.map((d) => ({ category: d.category, filename: d.filename, uploadedAt: d.uploadedAt.toISOString() })),
        missing: missingDocs,
      },
      investigation: { complete, requiredActions },
    };
  }
}
