import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private activity: ActivityService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Same generic failure for "no such user" and "wrong password" —
    // never confirm whether an email exists (docs/01 §6.2).
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.activity.log({
      organizationId: user.organizationId,
      actorId: user.id,
      eventType: 'user_logged_in',
    });

    return this.issueTokens(user.id, user.organizationId, user.role, user.email);
  }

  async refresh(refreshToken: string) {
    let payload: { sub: string };
    try {
      payload = this.jwt.verify(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET ?? 'change-me-dev-only-refresh-secret',
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Rotation: every refresh issues a brand-new refresh token (docs/01 §6).
    return this.issueTokens(user.id, user.organizationId, user.role, user.email);
  }

  private issueTokens(
    userId: string,
    organizationId: string,
    role: string,
    email: string,
  ) {
    const payload = { sub: userId, organizationId, role, email };
    const accessToken = this.jwt.sign(payload, {
      secret: process.env.JWT_ACCESS_SECRET ?? 'change-me-dev-only-access-secret',
      expiresIn: process.env.JWT_ACCESS_TTL ?? '15m',
    });
    const refreshToken = this.jwt.sign(
      { sub: userId },
      {
        secret: process.env.JWT_REFRESH_SECRET ?? 'change-me-dev-only-refresh-secret',
        expiresIn: process.env.JWT_REFRESH_TTL ?? '7d',
      },
    );
    return {
      accessToken,
      refreshToken,
      user: { id: userId, email, role, organizationId },
    };
  }
}
