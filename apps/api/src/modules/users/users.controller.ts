import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CreateUserSchema, UpdateUserSchema } from '../../common/schemas';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(RolesGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @Roles(Role.ADMIN)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.list(user.organizationId);
  }

  @Post('invite')
  @Roles(Role.ADMIN)
  invite(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateUserSchema)) body: { email: string; role: Role },
  ) {
    return this.usersService.invite(user, body);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateUserSchema))
    body: { role?: Role; isActive?: boolean },
  ) {
    return this.usersService.update(user, id, body);
  }
}
