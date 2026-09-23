import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { QueueModule } from '../../queue/queue.module';
import { AnalysisController, AnalysisRunController } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { InvestigationDataService } from './investigation-data.service';

@Module({
  imports: [ActivityModule, QueueModule],
  controllers: [AnalysisController, AnalysisRunController],
  providers: [AnalysisService, InvestigationDataService],
  exports: [AnalysisService, InvestigationDataService],
})
export class AnalysisModule {}
