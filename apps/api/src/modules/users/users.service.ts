import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
  ) {}

  list(organizationId: string) {
    return this.prisma.user.findMany({
      where: { organizationId },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Checkpoint 4 simplification: creates the user active immediately with a
   * generated temporary password, returned once in the response for the
   * admin to relay out-of-band. The full invite-token + email link flow
   * (docs/01 §6.2) needs SES, which is a Checkpoint 9 deployment
   * dependency — tracked, not forgotten.
   */
  async invite(
    actor: AuthenticatedUser,
    input: { email: string; role: 'ADMIN' | 'ANALYST' | 'VIEWER' },
  ) {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new ConflictException('A user with this email already exists');

    const tempPassword = crypto.randomBytes(9).toString('base64url');
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const user = await this.prisma.user.create({
      data: {
        organizationId: actor.organizationId,
        email: input.email,
        role: input.role,
        passwordHash,
        isActive: true,
      },
    });

    await this.activity.log({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      eventType: 'user_invited',
      metadata: { invitedUserId: user.id, email: user.email, role: user.role },
    });

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      temporaryPassword: tempPassword,
    };
  }

  async update(
    actor: AuthenticatedUser,
    userId: string,
    input: { role?: 'ADMIN' | 'ANALYST' | 'VIEWER'; isActive?: boolean },
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId: actor.organizationId },
    });
    if (!user) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: input,
    });

    // Deactivation unassigns their sites — never deletes anything (docs/01 §21).
    if (input.isActive === false) {
      await this.prisma.site.updateMany({
        where: { assignedAnalystId: userId },
        data: { assignedAnalystId: null },
      });
    }

    await this.activity.log({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      eventType: input.isActive === false ? 'user_deactivated' : 'user_updated',
      metadata: { targetUserId: userId, changes: input },
    });

    return {
      id: updated.id,
      email: updated.email,
      role: updated.role,
      isActive: updated.isActive,
    };
  }
}
