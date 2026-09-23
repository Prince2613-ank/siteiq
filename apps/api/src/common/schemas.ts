import { z } from 'zod';

/**
 * Server-side copy of packages/shared/src/schemas.ts.
 *
 * KNOWN, DELIBERATE DUPLICATION for Checkpoint 4: wiring a genuinely shared
 * TS package across NestJS's tsc build (which resolves `rootDir` from the
 * compiled entrypoints and gets confused by files outside apps/api/src) is a
 * build-tooling problem worth solving properly, not rushing through while
 * "foundation only, no matching engine yet" is the actual scope of this
 * checkpoint. Tracked as a Checkpoint 8 (production hardening) cleanup item:
 * publish packages/shared as a proper workspace build output both apps
 * import identically. Keep this file's shapes in sync with
 * packages/shared/src/schemas.ts until then.
 */

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const CreateUserSchema = z.object({
  email: z.string().email(),
  role: z.enum(['ADMIN', 'ANALYST', 'VIEWER']),
});

export const UpdateUserSchema = z.object({
  role: z.enum(['ADMIN', 'ANALYST', 'VIEWER']).optional(),
  isActive: z.boolean().optional(),
});

export const CreateSiteSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    // Street address is now OPTIONAL — client requirement (location-based
    // identification): a site can be created from town + coordinates +
    // street/location clues alone, with the exact address resolved later
    // from the confirmed parcel. See docs on location-based matching.
    streetAddress: z.string().min(1).max(300).optional(),
    city: z.string().min(1).max(120),
    state: z.string().length(2).default('MA'),
    zip: z.string().min(5).max(10).optional(),
    parcelRef: z.string().min(1).max(60).optional(),
    lat: z.number().min(41.2).max(42.9).optional(),
    lng: z.number().min(-73.6).max(-69.9).optional(),
    // Street/location clue with no house number required (e.g. "Marston
    // St") — the client dataset's "Location" column.
    locationText: z.string().min(1).max(300).optional(),
    // Free-text location description, supporting evidence only.
    locationDescription: z.string().min(1).max(1000).optional(),
    // Source system's own record identifier, preserved for traceability.
    facilityId: z.string().min(1).max(120).optional(),
    assignedAnalystId: z.string().uuid().optional(),
  })
  .refine(
    (data) => !!data.streetAddress || !!data.parcelRef || (data.lat !== undefined && data.lng !== undefined) || !!data.locationText,
    {
      message:
        'Provide at least one way to identify the property: a street address, a parcel/assessor reference, coordinates, or a street/location clue.',
      path: ['streetAddress'],
    },
  );

export const ConfirmCandidateSchema = z.object({
  note: z.string().max(1000).optional(),
  duplicateDecision: z.enum(['NONE', 'OPENED_EXISTING', 'CONTINUED_SEPARATE']).optional(),
});

export const UpdateSiteSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  assignedAnalystId: z.string().uuid().nullable().optional(),
  investigationStatus: z
    .enum(['NEW', 'IN_PROGRESS', 'NEEDS_REVIEW', 'COMPLETED', 'ARCHIVED'])
    .optional(),
});

export const ApproveFieldSchema = z.object({
  note: z.string().max(1000).optional(),
});

export const CreateNoteSchema = z.object({
  body: z.string().min(1).max(5000),
});
