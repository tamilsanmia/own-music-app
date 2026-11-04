import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TrackStatus } from '@prisma/client';
import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import { access, mkdtemp, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CommandError,
  isLosslessCodec,
  LOSSLESS_DIR,
  LOSSLESS_PLAYLIST,
  probe,
  transcodeLossless,
  transcodeToHls,
} from '../audio/ffmpeg';
import type { Env } from '../config/env';
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import { redisConnection, TRANSCODE_ATTEMPTS, TRANSCODE_QUEUE, TranscodeQueue, type TranscodeJob } from '../queue/transcode-queue';

/** How often to look for PENDING tracks whose job went missing. */
const RECONCILE_EVERY_MS = 5 * 60_000;
/** Only re-queue PENDING tracks that have been waiting at least this long. */
const RECONCILE_MIN_AGE_MS = 2 * 60_000;

/**
 * Consumes transcode jobs one at a time: original -> HLS (96k/160k/320k, plus FLAC for lossless
 * originals) in a temp directory, then an atomic rename into hls/<trackId>/ and status READY. Redis isn't persisted, so on start
 * and every few minutes the worker re-queues tracks whose jobs were lost.
 */
@Injectable()
export class TranscodeProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TranscodeProcessor.name);
  private worker?: Worker<TranscodeJob>;
  private connection?: IORedis;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly queue: TranscodeQueue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.connection = redisConnection(this.config);
    this.worker = new Worker<TranscodeJob>(TRANSCODE_QUEUE, (job) => this.process(job), {
      connection: this.connection as ConnectionOptions,
      prefix: this.queue.prefix,
      concurrency: 1,
    });
    this.worker.on('error', (e) => this.logger.error(`Worker error: ${e.message}`));
    await this.reconcile(true);
    this.timer = setInterval(() => void this.reconcile(false), RECONCILE_EVERY_MS);
    this.logger.log('Transcode worker started');
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.worker?.close(); // waits for the running job
    await this.connection?.quit().catch(() => undefined);
  }

  /** Re-queue tracks that should have a job but don't. On startup PROCESSING counts too. */
  async reconcile(startup: boolean): Promise<void> {
    try {
      const statuses = startup ? [TrackStatus.PENDING, TrackStatus.PROCESSING] : [TrackStatus.PENDING];
      const stale = await this.prisma.track.findMany({
        where: {
          status: { in: statuses },
          ...(startup ? {} : { updatedAt: { lt: new Date(Date.now() - RECONCILE_MIN_AGE_MS) } }),
        },
        select: { id: true },
      });
      for (const { id } of stale) {
        if (!(await this.queue.isQueued(id))) {
          this.logger.warn(`Re-queueing track ${id}`);
          await this.queue.enqueue(id);
        }
      }
    } catch (e) {
      this.logger.error(`Reconcile failed: ${(e as Error).message}`);
    }
  }

  async process(job: Job<TranscodeJob>): Promise<void> {
    const { trackId } = job.data;
    const track = await this.prisma.track.findUnique({ where: { id: trackId } });
    if (!track || !track.originalExt) return; // deleted meanwhile
    if (track.status !== TrackStatus.PENDING && track.status !== TrackStatus.PROCESSING) return;

    await this.prisma.track.update({ where: { id: trackId }, data: { status: TrackStatus.PROCESSING } });
    const started = Date.now();
    const work = await mkdtemp(join(this.media.tmpDir, `hls-${trackId}-`));
    try {
      const original = this.media.originalPath(trackId, track.originalExt);
      await transcodeToHls(original, work);
      await access(join(work, 'master.m3u8'));
      const lossless = await this.tryLossless(trackId, original, work);

      const dest = this.media.hlsDir(trackId);
      await rm(dest, { recursive: true, force: true });
      await rename(work, dest);

      // Only mark READY if the track still exists and nobody changed its state meanwhile.
      const { count } = await this.prisma.track.updateMany({
        where: { id: trackId, status: TrackStatus.PROCESSING },
        data: { status: TrackStatus.READY, errorMessage: null, lossless },
      });
      if (count === 0) {
        await rm(dest, { recursive: true, force: true });
        return;
      }
      this.logger.log(`Track ${trackId} ready in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } catch (err) {
      await rm(work, { recursive: true, force: true });
      const attempts = job.opts.attempts ?? TRANSCODE_ATTEMPTS;
      const final = job.attemptsMade + 1 >= attempts;
      const message = describe(err);
      this.logger.warn(`Track ${trackId} attempt ${job.attemptsMade + 1}/${attempts} failed: ${message}`);
      await this.prisma.track.updateMany({
        where: { id: trackId },
        data: { status: final ? TrackStatus.FAILED : TrackStatus.PENDING, errorMessage: message },
      });
      throw err;
    }
  }

  /**
   * For lossless originals (FLAC, WAV, ALAC…), also write a FLAC stream. A failure here only
   * loses the lossless option; the AAC streams still make the track playable.
   */
  private async tryLossless(trackId: string, original: string, work: string): Promise<boolean> {
    try {
      const info = await probe(original);
      if (!isLosslessCodec(info.codec)) return false;
      await transcodeLossless(original, work, info);
      return true;
    } catch (err) {
      this.logger.warn(`Track ${trackId}: lossless stream failed, AAC only: ${describe(err)}`);
      await rm(join(work, LOSSLESS_DIR), { recursive: true, force: true });
      await rm(join(work, LOSSLESS_PLAYLIST), { force: true });
      return false;
    }
  }
}

function describe(err: unknown): string {
  if (err instanceof CommandError) {
    const tail = err.stderrTail.split('\n').filter(Boolean).slice(-3).join(' | ');
    return (tail ? `${err.message}: ${tail}` : err.message).slice(0, 1000);
  }
  return ((err as Error)?.message ?? String(err)).slice(0, 1000);
}
