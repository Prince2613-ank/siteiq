import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ANALYSIS_QUEUE, PROPERTY_MATCH_QUEUE, redisConnectionOptions } from './redis-connection';
import { MatchInput } from '../modules/matching/matching.service';

export interface PropertyMatchJobData {
  siteId: string;
  input: MatchInput;
  triggeredById: string;
}

export interface AnalysisJobData {
  runId: string;
}

/**
 * Producer side of the queues (API process). The consumer side lives in
 * worker.ts + matching.processor / analysis processing — separate process,
 * so a slow/queued job never blocks an API request (docs/01 §9).
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private propertyMatchQueue = new Queue<PropertyMatchJobData>(PROPERTY_MATCH_QUEUE, {
    connection: redisConnectionOptions(),
  });
  private analysisQueue = new Queue<AnalysisJobData>(ANALYSIS_QUEUE, {
    connection: redisConnectionOptions(),
  });

  enqueuePropertyMatch(data: PropertyMatchJobData) {
    return this.propertyMatchQueue.add('match', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
  }

  enqueueAnalysis(data: AnalysisJobData) {
    return this.analysisQueue.add('analyze', data, {
      attempts: 1, // AnalysisService.runAnalysis already catches its own errors and marks FAILED — retry is a deliberate user action (POST .../retry), not automatic
    });
  }

  async onModuleDestroy() {
    await Promise.all([this.propertyMatchQueue.close(), this.analysisQueue.close()]);
  }
}
