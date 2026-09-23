import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, Module } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { PrismaModule } from './prisma/prisma.module';
import { ActivityModule } from './modules/activity/activity.module';
import { MatchingModule } from './modules/matching/matching.module';
import { MatchingService } from './modules/matching/matching.service';
import { AnalysisModule } from './modules/analysis/analysis.module';
import { AnalysisService } from './modules/analysis/analysis.service';
import { ANALYSIS_QUEUE, PROPERTY_MATCH_QUEUE, redisConnectionOptions } from './queue/redis-connection';
import { AnalysisJobData, PropertyMatchJobData } from './queue/queue.service';

/**
 * Standalone worker process — docs/01 §9 / ADR-0001: slow jobs (property
 * matching, investigation analysis) run here, never on the API's
 * request-handling process. Started with `npm run start:worker` (prod) /
 * `npm run start:worker:dev` (dev, separate terminal from the API).
 */
@Module({
  imports: [PrismaModule, ActivityModule, MatchingModule, AnalysisModule],
})
class WorkerModule {}

async function bootstrap() {
  const logger = new Logger('Worker');
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const matchingService = app.get(MatchingService);
  const analysisService = app.get(AnalysisService);

  const matchWorker = new Worker<PropertyMatchJobData>(
    PROPERTY_MATCH_QUEUE,
    async (job: Job<PropertyMatchJobData>) => {
      logger.log(`Processing property-match job ${job.id} for site ${job.data.siteId}`);
      await matchingService.runMatchAttempt(job.data.siteId, job.data.input, job.data.triggeredById);
    },
    { connection: redisConnectionOptions(), concurrency: 4 },
  );
  matchWorker.on('failed', (job, err) => {
    logger.error(`property-match job ${job?.id} failed: ${err.message}`);
  });

  const analysisWorker = new Worker<AnalysisJobData>(
    ANALYSIS_QUEUE,
    async (job: Job<AnalysisJobData>) => {
      logger.log(`Processing analysis job ${job.id} (run ${job.data.runId})`);
      // runAnalysis catches its own errors internally and marks the run
      // FAILED (docs/01 §10's retry-not-auto-loop rule) — it never throws
      // back up to BullMQ, so this queue intentionally has no retry.
      await analysisService.runAnalysis(job.data.runId);
    },
    { connection: redisConnectionOptions(), concurrency: 4 },
  );
  analysisWorker.on('failed', (job, err) => {
    logger.error(`analysis job ${job?.id} failed: ${err.message}`);
  });

  logger.log('SiteIQ worker listening on queues: property-match, analysis');
}

bootstrap();
