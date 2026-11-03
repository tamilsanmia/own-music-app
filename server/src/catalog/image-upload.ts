import { BadRequestException, UseInterceptors, applyDecorators } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MAX_IMAGE_BYTES } from '../media/media.service';

/** Multipart upload of one image in the field "image", held in memory (max 10 MB). */
export const ImageUpload = () =>
  applyDecorators(
    UseInterceptors(
      FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0 } }),
    ),
  );

export function requireFile(file: Express.Multer.File | undefined): Buffer {
  if (!file?.buffer?.length) throw new BadRequestException('Attach an image in the "image" field');
  return file.buffer;
}
