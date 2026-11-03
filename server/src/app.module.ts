import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { validateEnv } from './config/env';
import { HealthController } from './health/health.controller';
import { MediaModule } from './media/media.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/transcode-queue';
import { StreamModule } from './stream/stream.module';
import { TracksModule } from './tracks/tracks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    PrismaModule,
    MediaModule,
    QueueModule,
    StreamModule,
    AuthModule,
    CatalogModule,
    TracksModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
