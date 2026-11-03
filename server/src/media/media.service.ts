import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Env } from '../config/env';

// Small images, one at a time: keep libvips memory low inside the pod's limit.
sharp.cache(false);
sharp.concurrency(1);

/** Raster formats accepted for cover art. SVG is rejected on purpose. */
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'heif']);
export const COVER_SIZES = [300, 600] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Reject absurd dimensions before decoding (decompression bombs). */
const MAX_INPUT_PIXELS = 50_000_000;

export interface CoverUrls {
  small: string;
  large: string;
}

/** Public URL path for a cover image. Files are immutable, so URLs can be cached forever. */
export function coverUrls(id: string | null | undefined): CoverUrls | null {
  if (!id) return null;
  return { small: `/media/covers/${id}-300.webp`, large: `/media/covers/${id}-600.webp` };
}

/**
 * Files under MEDIA_ROOT:
 *   covers/  public, square WebP covers (served at /media/covers)
 *   tmp/     scratch space; writes land here first and are renamed into place
 * originals/ and hls/ are added in Task 6 and are never served statically.
 */
@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger(MediaService.name);
  readonly root: string;
  readonly coversDir: string;
  readonly tmpDir: string;

  constructor(config: ConfigService<Env, true>) {
    this.root = config.get('MEDIA_ROOT', { infer: true });
    this.coversDir = join(this.root, 'covers');
    this.tmpDir = join(this.root, 'tmp');
  }

  async onModuleInit(): Promise<void> {
    await mkdir(this.coversDir, { recursive: true });
    await mkdir(this.tmpDir, { recursive: true });
  }

  /** Validate an uploaded image, write 300px and 600px square WebP versions, return the new id. */
  async saveCover(input: Buffer): Promise<string> {
    let format: string | undefined;
    try {
      ({ format } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata());
    } catch {
      throw new BadRequestException('The file is not a readable image');
    }
    if (!format || !ACCEPTED_FORMATS.has(format)) {
      throw new BadRequestException('Use a JPEG, PNG, WebP, GIF or AVIF image');
    }

    const id = randomUUID();
    const written: string[] = [];
    try {
      for (const size of COVER_SIZES) {
        const data = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
          .rotate() // honour EXIF orientation; metadata is stripped on output
          .resize(size, size, { fit: 'cover', position: 'attention' })
          .webp({ quality: 82 })
          .toBuffer();
        const tmp = join(this.tmpDir, `${id}-${size}.webp`);
        await writeFile(tmp, data);
        const final = this.coverPath(id, size);
        await rename(tmp, final);
        written.push(final);
      }
    } catch (err) {
      await Promise.all(written.map((f) => rm(f, { force: true })));
      if (err instanceof BadRequestException) throw err;
      this.logger.warn(`Cover processing failed: ${(err as Error).message}`);
      throw new BadRequestException('The image could not be processed');
    }
    return id;
  }

  /** Remove a cover's files. Missing files are fine. */
  async deleteCover(id: string | null | undefined): Promise<void> {
    if (!id) return;
    await Promise.all(COVER_SIZES.map((s) => rm(this.coverPath(id, s), { force: true })));
  }

  coverPath(id: string, size: number): string {
    return join(this.coversDir, `${id}-${size}.webp`);
  }
}
