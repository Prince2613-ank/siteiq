import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { QueueModule } from '../../queue/queue.module';
import { ParcelMirrorModule } from '../matching/parcel-mirror.module';
import { SitesController } from './sites.controller';
import { SitesService } from './sites.service';

@Module({
  imports: [ActivityModule, QueueModule, ParcelMirrorModule],
  controllers: [SitesController],
  providers: [SitesService],
})
export class SitesModule {}
