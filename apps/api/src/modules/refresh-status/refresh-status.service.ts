import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RefreshStatusService {
  constructor(private prisma: PrismaService) {}

  /** The client's two operational questions, answered per source/municipality:
   * "when was this last successfully refreshed" and "did the latest attempt
   * succeed, fail, or partially succeed." Deliberately simple — the latest
   * log row per (source, municipality) pair, plus the most recent SUCCESS
   * for comparison when the latest attempt failed. */
  async listLatestPerSource() {
    const logs = await this.prisma.sourceRefreshLog.findMany({
      orderBy: { completedAt: 'desc' },
    });

    const latestByKey = new Map<string, (typeof logs)[number]>();
    const lastSuccessByKey = new Map<string, (typeof logs)[number]>();
    for (const log of logs) {
      const key = `${log.source}|${log.municipality ?? ''}`;
      if (!latestByKey.has(key)) latestByKey.set(key, log);
      if (log.status === 'SUCCESS' && !lastSuccessByKey.has(key)) lastSuccessByKey.set(key, log);
    }

    return Array.from(latestByKey.entries()).map(([key, latest]) => ({
      source: latest.source,
      municipality: latest.municipality,
      latestStatus: latest.status,
      latestRecordCount: latest.recordCount,
      latestErrorMessage: latest.errorMessage,
      latestAttemptAt: latest.completedAt,
      lastSuccessfulRefreshAt: lastSuccessByKey.get(key)?.completedAt ?? (latest.status === 'SUCCESS' ? latest.completedAt : null),
    }));
  }
}
