import { Module } from '@nestjs/common';
import { RefreshStatusController } from './refresh-status.controller';
import { RefreshStatusService } from './refresh-status.service';

@Module({
  controllers: [RefreshStatusController],
  providers: [RefreshStatusService],
})
export class RefreshStatusModule {}
