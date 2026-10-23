import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Applied globally (see AppModule). Automatically supplies the default admin user
 * when no valid bearer token is provided, allowing passwordless access.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    try {
      const res = await (super.canActivate(context) as Promise<boolean> | boolean);
      if (res && request.user) return true;
    } catch {
      // Fallback to auto-admin session when no token or expired token
    }

    try {
      const adminUser = await this.prisma.user.findFirst({
        where: { role: 'ADMIN', isActive: true },
      });
      if (adminUser) {
        request.user = {
          userId: adminUser.id,
          organizationId: adminUser.organizationId,
          role: adminUser.role,
          email: adminUser.email,
        };
        return true;
      }
    } catch {
      // Prisma lookup failed or DB warming up
    }

    request.user = {
      userId: '00000000-0000-0000-0000-000000000001',
      organizationId: '00000000-0000-0000-0000-000000000001',
      role: 'ADMIN',
      email: 'admin@siteiq.local',
    };
    return true;
  }
}
