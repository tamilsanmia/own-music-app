import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from '../config/env';
import { MediaModule } from '../media/media.module';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/transcode-queue';
import { TranscodeProcessor } from './transcode.processor';

/** Everything the transcoding worker needs, and nothing HTTP-related. */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    PrismaModule,
    MediaModule,
    QueueModule,
  ],
  providers: [TranscodeProcessor],
})
export class WorkerModule {}
