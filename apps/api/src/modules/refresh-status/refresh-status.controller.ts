import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RefreshStatusService } from './refresh-status.service';

/** Checkpoint 11 — the operational visibility the client asked for, kept
 * deliberately simple (no monitoring platform): admin-only, one query. */
@Controller('admin/source-refresh-log')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN)
export class RefreshStatusController {
  constructor(private refreshStatusService: RefreshStatusService) {}

  @Get()
  list() {
    return this.refreshStatusService.listLatestPerSource();
  }
}
