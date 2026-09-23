import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CreateNoteSchema } from '../../common/schemas';
import { NotesService } from './notes.service';

@Controller('sites/:siteId/notes')
@UseGuards(RolesGuard)
export class NotesController {
  constructor(private notesService: NotesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Param('siteId') siteId: string) {
    return this.notesService.list(user.organizationId, siteId);
  }

  @Post()
  @Roles(Role.ADMIN, Role.ANALYST)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('siteId') siteId: string,
    @Body(new ZodValidationPipe(CreateNoteSchema)) body: { body: string },
  ) {
    return this.notesService.create(user, siteId, body.body);
  }
}
