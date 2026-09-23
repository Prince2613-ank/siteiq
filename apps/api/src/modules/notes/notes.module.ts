import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';

@Module({
  imports: [ActivityModule],
  controllers: [NotesController],
  providers: [NotesService],
})
export class NotesModule {}
