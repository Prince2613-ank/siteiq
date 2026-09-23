import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';

/**
 * Logs every request to the terminal as it happens — what was clicked in
 * the browser, who did it, and whether it succeeded or failed — not just
 * the route table at startup. Client requirement: "everything should
 * display in terminal ... what clicked, running correctly."
 *
 * Format:
 *   → POST /api/v1/sites  (admin@siteiq.local)
 *   ← POST /api/v1/sites  201  142ms
 * or on failure:
 *   ✗ POST /api/v1/sites/.../confirm  422  38ms  This candidate matches...
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const { method, originalUrl, user } = req;
    const actor = user?.email ?? 'anonymous';
    const start = Date.now();

    this.logger.log(`→ ${method} ${originalUrl}  (${actor})`);

    return next.handle().pipe(
      tap(() => {
        // Not reading res.statusCode here — at this point in the pipeline
        // Nest hasn't written the real status yet (it does that AFTER the
        // interceptor chain resolves), so it would often show a stale
        // default rather than the actual code. "OK" is what we can say
        // reliably; the exact status is logged for the FAILURE path below,
        // where the thrown exception's real status is available directly.
        const ms = Date.now() - start;
        this.logger.log(`← ${method} ${originalUrl}  OK  ${ms}ms`);
      }),
      catchError((err) => {
        const ms = Date.now() - start;
        const status = err?.status ?? 500;
        const message = err?.message ?? String(err);
        // 4xx is expected/handled application behavior (validation,
        // permission checks, business rules like the duplicate-decision
        // requirement) — logged at warn, not error, so real problems
        // (5xx) stand out in the terminal.
        if (status >= 500) {
          this.logger.error(`✗ ${method} ${originalUrl}  ${status}  ${ms}ms  ${message}`);
        } else {
          this.logger.warn(`✗ ${method} ${originalUrl}  ${status}  ${ms}ms  ${message}`);
        }
        throw err;
      }),
    );
  }
}
