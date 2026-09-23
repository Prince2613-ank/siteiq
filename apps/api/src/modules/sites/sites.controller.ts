import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InvestigationStatus, Role } from '@prisma/client';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CreateSiteSchema, UpdateSiteSchema } from '../../common/schemas';
import { SitesService } from './sites.service';

@Controller('sites')
@UseGuards(RolesGuard)
export class SitesController {
  constructor(private sitesService: SitesService) {}

  @Post()
  @Roles(Role.ADMIN, Role.ANALYST)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateSiteSchema)) body: any,
  ) {
    return this.sitesService.create(user, body);
  }

  // No @Roles — every authenticated role (incl. VIEWER) can read.
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('search') search?: string,
    @Query('investigationStatus') investigationStatus?: string,
    @Query('municipality') municipality?: string,
    @Query('assignedAnalystId') assignedAnalystId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.sitesService.list(user.organizationId, {
      search,
      investigationStatus,
      municipality,
      assignedAnalystId,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.sitesService.findOne(user.organizationId, id);
  }

  @Get(':id/geometry')
  findGeometry(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.sitesService.findGeometry(user.organizationId, id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.ANALYST)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateSiteSchema))
    body: { name?: string; assignedAnalystId?: string | null; investigationStatus?: InvestigationStatus },
  ) {
    return this.sitesService.update(user, id, body);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.sitesService.remove(user, id);
  }
}
