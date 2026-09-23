import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [ActivityModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
