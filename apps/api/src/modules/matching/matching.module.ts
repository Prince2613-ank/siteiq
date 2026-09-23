import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { QueueModule } from '../../queue/queue.module';
import { FieldsModule } from '../fields/fields.module';
import { MatchingService } from './matching.service';
import { ParcelMirrorModule } from './parcel-mirror.module';
import { CensusGeocoderAdapter } from './geocoding.service';
import { GEOCODER } from './geocoder.interface';
import { CandidateConfirmationService } from './candidate-confirmation.service';
import { MatchAttemptsController, ReMatchController } from './match-attempts.controller';
import { MassGisClient } from './massgis-client';
import { MassGisIngestionService } from './massgis-ingestion.service';

@Module({
  imports: [ActivityModule, QueueModule, ParcelMirrorModule, FieldsModule],
  controllers: [MatchAttemptsController, ReMatchController],
  providers: [
    MatchingService,
    { provide: GEOCODER, useClass: CensusGeocoderAdapter },
    CandidateConfirmationService,
    MassGisClient,
    MassGisIngestionService,
  ],
  exports: [MatchingService, MassGisIngestionService],
})
export class MatchingModule {}
