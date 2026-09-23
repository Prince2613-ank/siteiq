import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * Field-VALUE conflict resolution (Checkpoint 8) — deliberately a separate
 * system from candidate-confirmation.service.ts's property-IDENTITY
 * resolution (client's explicit instruction, Checkpoint 5 review point 7:
 * "keep two different concepts separate"). This is "which source's zoning
 * value is correct for a parcel we've already identified," not "is this
 * the right parcel."
 *
 * Implements doc 01 §8's normalization rule: approving one observation
 * marks every sibling observation for that field NOT current (a flag flip,
 * never a delete — the full history stays queryable), logs an approval
 * record, and updates the Site's denormalized current value.
 */
@Injectable()
export class FieldApprovalService {
  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
  ) {}

  async approve(actor: AuthenticatedUser, siteId: string, fieldId: string, note?: string) {
    const site = await this.prisma.site.findFirst({
      where: { id: siteId, organizationId: actor.organizationId },
    });
    if (!site) throw new NotFoundException('Site not found');

    const field = await this.prisma.siteDataField.findFirst({ where: { id: fieldId, siteId } });
    if (!field) throw new NotFoundException('Field observation not found');
    if (field.value === null) {
      throw new UnprocessableEntityException(
        'Cannot approve a field observation with no value — this source genuinely had nothing to report.',
      );
    }

    const previousCurrent = await this.prisma.siteDataField.findFirst({
      where: { siteId, fieldName: field.fieldName, isCurrent: true },
    });

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.siteDataField.updateMany({
        where: { siteId, fieldName: field.fieldName, isCurrent: true },
        data: { isCurrent: false },
      });
      const updated = await tx.siteDataField.update({
        where: { id: field.id },
        data: { isCurrent: true, status: 'MATCHED' },
      });
      await tx.siteDataFieldApproval.create({
        data: {
          siteId,
          fieldName: field.fieldName,
          approvedFieldId: field.id,
          previousFieldId: previousCurrent?.id,
          approvedById: actor.userId,
          note,
        },
      });

      // Denormalized Site copy — only for fields Site has a column for.
      if (field.fieldName === 'zoning_code') {
        await tx.site.update({ where: { id: siteId }, data: { zoningCode: valueAsString(field.value) } });
      } else if (field.fieldName === 'lot_size') {
        await tx.site.update({ where: { id: siteId }, data: { lotSize: field.numericValue } });
      }

      return updated;
    });

    await this.activity.log({
      organizationId: actor.organizationId,
      siteId,
      actorId: actor.userId,
      eventType: 'field_conflict_resolved',
      metadata: {
        fieldName: field.fieldName,
        approvedFieldId: field.id,
        approvedSource: field.sourceName,
        approvedValue: field.value as any,
        previousFieldId: previousCurrent?.id ?? null,
      },
    });

    return result;
  }
}

function valueAsString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}
