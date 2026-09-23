import { Module } from '@nestjs/common';
import { ParcelMirrorModule } from '../matching/parcel-mirror.module';
import { ActivityModule } from '../activity/activity.module';
import { FieldsController } from './fields.controller';
import { FieldsService } from './fields.service';
import { FieldEnrichmentService } from './field-enrichment.service';
import { FieldApprovalService } from './field-approval.service';

@Module({
  imports: [ParcelMirrorModule, ActivityModule],
  controllers: [FieldsController],
  providers: [FieldsService, FieldEnrichmentService, FieldApprovalService],
  exports: [FieldEnrichmentService],
})
export class FieldsModule { }
