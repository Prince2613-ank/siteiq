import { z } from 'zod';

// Shared between apps/api (via nestjs-zod DTOs) and apps/web (react-hook-form
// resolvers), per docs/01-technical-discovery.md §5's validation-strategy
// resolution: Zod is the single source of truth, no class-validator.
//
// Checkpoint 4 scope note: CreateSiteSchema here is the FOUNDATION-phase
// shape (no address matching yet, per client's explicit "don't implement the
// matching engine yet" instruction for this checkpoint). It will grow the
// originalInputType/candidate-review fields described in
// docs/02-property-matching-architecture.md and
// docs/03-data-model-api-contract.md when the matching engine is built in a
// later checkpoint — deliberately not implemented as dead code today.

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const CreateUserSchema = z.object({
  email: z.string().email(),
  role: z.enum(['ADMIN', 'ANALYST', 'VIEWER']),
});
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = z.object({
  role: z.enum(['ADMIN', 'ANALYST', 'VIEWER']).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

export const CreateSiteSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  streetAddress: z.string().min(1).max(300),
  city: z.string().min(1).max(120),
  state: z.string().length(2).default('MA'),
  zip: z.string().min(5).max(10).optional(),
  assignedAnalystId: z.string().uuid().optional(),
});
export type CreateSiteInput = z.infer<typeof CreateSiteSchema>;

export const UpdateSiteSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  assignedAnalystId: z.string().uuid().nullable().optional(),
  investigationStatus: z
    .enum(['NEW', 'IN_PROGRESS', 'NEEDS_REVIEW', 'COMPLETED', 'ARCHIVED'])
    .optional(),
});
export type UpdateSiteInput = z.infer<typeof UpdateSiteSchema>;

export const SiteListQuerySchema = z.object({
  search: z.string().optional(),
  investigationStatus: z.string().optional(),
  municipality: z.string().optional(),
  assignedAnalystId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type SiteListQuery = z.infer<typeof SiteListQuerySchema>;

export const CreateNoteSchema = z.object({
  body: z.string().min(1).max(5000),
});
export type CreateNoteInput = z.infer<typeof CreateNoteSchema>;
