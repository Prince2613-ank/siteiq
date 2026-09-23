import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { ReportsController, ReportController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [ActivityModule, AnalysisModule],
  controllers: [ReportsController, ReportController],
  providers: [ReportsService],
})
export class ReportsModule {}
