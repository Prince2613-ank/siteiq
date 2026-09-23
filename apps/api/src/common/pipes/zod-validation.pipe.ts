import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';

/**
 * Minimal Zod validation pipe — Checkpoint 4's implementation of the
 * validation strategy resolved in docs/01 §5 (Zod only, no class-validator).
 * `new ZodValidationPipe(SomeSchema)` used per-route via
 * `@Body(new ZodValidationPipe(Schema))`. A full nestjs-zod integration
 * (auto-wired DTOs, OpenAPI generation) is a Checkpoint 8 hardening item —
 * this hand-rolled version is intentionally small and dependency-free so
 * Checkpoint 4 doesn't take on an unverified third-party package.
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const message = result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new BadRequestException(message);
    }
    return result.data;
  }
}
