import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { DocumentsController, DocumentDownloadController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [ActivityModule],
  controllers: [DocumentsController, DocumentDownloadController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
