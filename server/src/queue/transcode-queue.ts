import { Global, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, type ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import type { Env } from '../config/env';

export const TRANSCODE_QUEUE = 'transcode';
/** 1 try + 2 retries, as in the plan. */
export const TRANSCODE_ATTEMPTS = 3;

export interface TranscodeJob {
  trackId: string;
}

export function redisConnection(config: ConfigService<Env, true>): IORedis {
  // maxRetriesPerRequest: null is required by BullMQ workers; harmless for queues.
  return new IORedis(config.get('REDIS_URL', { infer: true }), { maxRetriesPerRequest: null });
}

/**
 * Producer side of the transcoding queue. The job id is the track id, so enqueueing a track
 * that is already queued is a no-op. Finished jobs are removed: the outcome lives on the Track.
 */
@Injectable()
export class TranscodeQueue implements OnModuleDestroy {
  private readonly logger = new Logger(TranscodeQueue.name);
  private readonly connection: IORedis;
  readonly queue: Queue<TranscodeJob>;
  readonly prefix: string;

  constructor(config: ConfigService<Env, true>) {
    this.connection = redisConnection(config);
    this.prefix = config.get('QUEUE_PREFIX', { infer: true });
    this.queue = new Queue<TranscodeJob>(TRANSCODE_QUEUE, {
      connection: this.connection as ConnectionOptions,
      prefix: this.prefix,
    });
  }

  async enqueue(trackId: string): Promise<void> {
    await this.queue.add(
      'transcode',
      { trackId },
      {
        jobId: trackId,
        attempts: TRANSCODE_ATTEMPTS,
        backoff: { type: 'exponential', delay: 15_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  async isQueued(trackId: string): Promise<boolean> {
    return (await this.queue.getJob(trackId)) !== undefined;
  }

  /** Drop a waiting job. A job that is already running is left to finish and clean up. */
  async remove(trackId: string): Promise<void> {
    const job = await this.queue.getJob(trackId);
    if (!job) return;
    try {
      await job.remove();
    } catch (e) {
      this.logger.debug(`Job ${trackId} not removed (probably running): ${(e as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.connection.quit().catch(() => undefined);
  }
}

@Global()
@Module({ providers: [TranscodeQueue], exports: [TranscodeQueue] })
export class QueueModule {}
