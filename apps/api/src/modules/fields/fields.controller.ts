import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApproveFieldSchema } from '../../common/schemas';
import { FieldsService } from './fields.service';
import { FieldApprovalService } from './field-approval.service';

@Controller('sites/:siteId/fields')
@UseGuards(RolesGuard)
export class FieldsController {
  constructor(
    private fieldsService: FieldsService,
    private approvalService: FieldApprovalService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Param('siteId') siteId: string) {
    return this.fieldsService.listForSite(user.organizationId, siteId);
  }

  @Get(':fieldName/approvals')
  listApprovals(
    @CurrentUser() user: AuthenticatedUser,
    @Param('siteId') siteId: string,
    @Param('fieldName') fieldName: string,
  ) {
    return this.fieldsService.listApprovals(user.organizationId, siteId, fieldName);
  }

  @Post(':fieldId/approve')
  @Roles(Role.ADMIN, Role.ANALYST)
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('siteId') siteId: string,
    @Param('fieldId') fieldId: string,
    @Body(new ZodValidationPipe(ApproveFieldSchema)) body: { note?: string },
  ) {
    return this.approvalService.approve(user, siteId, fieldId, body.note);
  }
}
