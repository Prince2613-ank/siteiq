import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';
/**
 * Role-based access, per docs/01 §6.1's approved permission matrix.
 * Assignment (Site.assignedAnalystId) is informational only and never
 * gates access — this decorator is the ONLY authorization mechanism.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
