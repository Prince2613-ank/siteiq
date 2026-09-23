import { Controller, Get, Param } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ActivityService } from './activity.service';

@Controller('sites/:siteId/activity')
export class ActivityController {
  constructor(private activityService: ActivityService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Param('siteId') siteId: string) {
    return this.activityService.listForSite(siteId, user.organizationId);
  }
}
