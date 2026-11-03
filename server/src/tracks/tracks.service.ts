import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Prisma, TrackStatus } from '@prisma/client';
import { createWriteStream } from 'node:fs';
import { rename } from 'node:fs/promises';
import { extname, basename } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { NotAudioError, probe } from '../audio/ffmpeg';
import { artistRef } from '../catalog/presenters';
import { fileSize, MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import { TranscodeQueue } from '../queue/transcode-queue';
import type { CreateTrackDto, UpdateTrackDto } from './dto';
import { MAX_CHUNK_BYTES, RECOMMENDED_CHUNK_BYTES } from './limits';
import { presentAdminTrack } from './presenters';

const include = { artist: artistRef } as const;

/** "Feeling Good.FLAC" -> "flac". Anything unusual becomes "bin"; ffprobe decides what it is. */
export function safeExtension(filename: string): string {
  const ext = extname(filename).slice(1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin';
}

/** "01 Feeling Good.flac" -> "01 Feeling Good". */
export function titleFromFilename(filename: string): string {
  const stem = basename(filename, extname(filename)).trim().slice(0, 200);
  return stem || 'Untitled';
}

/** Pass at most `limit` bytes through; fail if the stream carries more. */
function byteLimit(limit: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      if (seen > limit) cb(new PayloadTooLargeException(`This chunk may be at most ${limit} bytes`));
      else cb(null, chunk);
    },
  });
}

/**
 * Track upload lifecycle:
 *   create (UPLOADING) -> PUT chunks at increasing offsets -> complete (ffprobe check)
 *   -> PENDING (queued) -> PROCESSING (worker) -> READY or FAILED
 * The partial file on disk is the source of truth for how much has arrived, so an interrupted
 * upload resumes from GET .../upload. One API replica is assumed: the per-track lock is in memory.
 */
@Injectable()
export class TracksService {
  private readonly logger = new Logger(TracksService.name);
  private readonly busy = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly queue: TranscodeQueue,
  ) {}

  async create(dto: CreateTrackDto) {
    const track = await this.prisma.$transaction(async (tx) => {
      // Lock the album row so parallel uploads to one album get distinct default numbers.
      const locked = await tx.$queryRaw<{ artistId: string }[]>`
        SELECT "artistId" FROM "Album" WHERE id = ${dto.albumId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new BadRequestException('Album not found');

      if (dto.artistId && !(await tx.artist.count({ where: { id: dto.artistId } }))) {
        throw new BadRequestException('Artist not found');
      }
      let trackNumber = dto.trackNumber;
      if (trackNumber === undefined) {
        const max = await tx.track.aggregate({ where: { albumId: dto.albumId }, _max: { trackNumber: true } });
        trackNumber = (max._max.trackNumber ?? 0) + 1;
      }
      return tx.track.create({
        data: {
          albumId: dto.albumId,
          artistId: dto.artistId ?? locked[0].artistId,
          title: dto.title ?? titleFromFilename(dto.filename),
          trackNumber,
          status: TrackStatus.UPLOADING,
          originalFilename: dto.filename,
          originalExt: safeExtension(dto.filename),
          sizeBytes: dto.sizeBytes,
        },
        include,
      });
    });
    return {
      track: presentAdminTrack(track),
      upload: { chunkBytes: RECOMMENDED_CHUNK_BYTES, maxChunkBytes: MAX_CHUNK_BYTES, receivedBytes: 0 },
    };
  }

  async get(id: string) {
    return presentAdminTrack(await this.mustExist(id));
  }

  async uploadStatus(id: string) {
    const track = await this.mustExist(id);
    const receivedBytes =
      track.status === TrackStatus.UPLOADING ? await fileSize(this.media.partPath(id)) : track.sizeBytes ?? 0;
    return { status: track.status, receivedBytes, sizeBytes: track.sizeBytes };
  }

  /** Append one chunk. `offset` must equal the bytes received so far. */
  async appendChunk(id: string, offset: number, body: Readable, contentLength?: number) {
    try {
      return await this.withLock(id, async () => {
        const track = await this.mustExist(id);
        if (track.status !== TrackStatus.UPLOADING) throw new ConflictException('This upload is already complete');

        const part = this.media.partPath(id);
        const received = await fileSize(part);
        if (offset !== received) {
          throw new ConflictException({ message: 'Offset does not match the bytes received', receivedBytes: received });
        }
        const remaining = (track.sizeBytes ?? 0) - received;
        if (remaining <= 0) throw new ConflictException({ message: 'All bytes already received', receivedBytes: received });

        const limit = Math.min(MAX_CHUNK_BYTES, remaining);
        // Reject oversized chunks before reading them, so the client gets a clean 413. The byte
        // limit below still guards bodies sent without a Content-Length.
        if (contentLength !== undefined && contentLength > limit) {
          throw new PayloadTooLargeException(`This chunk may be at most ${limit} bytes`);
        }
        try {
          await pipeline(body, byteLimit(limit), createWriteStream(part, { flags: 'a' }));
        } catch (e) {
          if (e instanceof PayloadTooLargeException) throw e;
          throw new BadRequestException('The chunk was interrupted; resume from receivedBytes');
        }
        return { receivedBytes: await fileSize(part), sizeBytes: track.sizeBytes };
      });
    } finally {
      // If we rejected the chunk without reading it, drain it so the connection can close cleanly.
      if (!body.readableEnded) body.resume();
    }
  }

  /** Check the finished file is audio and queue it for transcoding. Non-audio uploads are discarded. */
  async complete(id: string) {
    return this.withLock(id, async () => {
      const track = await this.mustExist(id);
      if (track.status !== TrackStatus.UPLOADING) throw new ConflictException('This upload is already complete');

      const part = this.media.partPath(id);
      const received = await fileSize(part);
      if (received !== track.sizeBytes) {
        throw new ConflictException({ message: 'The upload is not finished yet', receivedBytes: received });
      }

      let info;
      try {
        info = await probe(part);
      } catch (e) {
        if (!(e instanceof NotAudioError)) throw e;
        await this.prisma.track.delete({ where: { id } });
        await this.media.deleteTrackFiles(id, track.originalExt);
        throw new BadRequestException(`Not a playable audio file (${e.message}). The upload was discarded.`);
      }

      await rename(part, this.media.originalPath(id, track.originalExt ?? 'bin'));
      const updated = await this.prisma.track.update({
        where: { id },
        data: { status: TrackStatus.PENDING, durationMs: info.durationMs, sourceInfo: info.summary, errorMessage: null },
        include,
      });
      await this.enqueueQuietly(id);
      return presentAdminTrack(updated);
    });
  }

  async update(id: string, dto: UpdateTrackDto) {
    await this.mustExist(id);
    if (dto.artistId && !(await this.prisma.artist.count({ where: { id: dto.artistId } }))) {
      throw new BadRequestException('Artist not found');
    }
    const track = await this.prisma.track.update({
      where: { id },
      data: { title: dto.title, trackNumber: dto.trackNumber, artistId: dto.artistId },
      include,
    });
    return presentAdminTrack(track);
  }

  /** Re-queue a track that failed, or one whose job was lost (e.g. Redis restarted). */
  async retry(id: string) {
    const track = await this.mustExist(id);
    if (track.status !== TrackStatus.FAILED && track.status !== TrackStatus.PENDING) {
      throw new ConflictException(`Only failed or pending tracks can be retried (this one is ${track.status})`);
    }
    const updated = await this.prisma.track.update({
      where: { id },
      data: { status: TrackStatus.PENDING, errorMessage: null },
      include,
    });
    await this.queue.enqueue(id);
    return presentAdminTrack(updated);
  }

  async delete(id: string): Promise<void> {
    const track = await this.mustExist(id);
    await this.queue.remove(id);
    try {
      await this.prisma.track.delete({ where: { id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new NotFoundException();
      throw e;
    }
    await this.media.deleteTrackFiles(id, track.originalExt);
  }

  private async enqueueQuietly(id: string): Promise<void> {
    try {
      await this.queue.enqueue(id);
    } catch (e) {
      // The worker re-queues PENDING tracks it doesn't know about, so this heals itself.
      this.logger.error(`Could not queue track ${id}: ${(e as Error).message}`);
    }
  }

  private async mustExist(id: string) {
    const track = await this.prisma.track.findUnique({ where: { id }, include });
    if (!track) throw new NotFoundException('Track not found');
    return track;
  }

  private async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    if (this.busy.has(id)) throw new ConflictException('Another request for this upload is still running');
    this.busy.add(id);
    try {
      return await fn();
    } finally {
      this.busy.delete(id);
    }
  }
}
