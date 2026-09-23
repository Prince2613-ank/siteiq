import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';

@Controller('sites/:siteId/reports')
@UseGuards(RolesGuard)
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Param('siteId') siteId: string) {
    return this.reportsService.listForSite(user.organizationId, siteId);
  }

  @Post()
  @Roles(Role.ADMIN, Role.ANALYST)
  generate(@CurrentUser() user: AuthenticatedUser, @Param('siteId') siteId: string) {
    return this.reportsService.generate(user, siteId);
  }
}

@Controller('reports')
@UseGuards(RolesGuard)
export class ReportController {
  constructor(private reportsService: ReportsService) {}

  @Get(':id')
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.reportsService.getOne(user.organizationId, id);
  }
}
