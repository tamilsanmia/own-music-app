import { Global, Module } from '@nestjs/common';
import { ActiveUserCache } from './active-user.cache';
import { StreamController, StreamUrlController } from './stream.controller';
import { StreamTokenService } from './stream-token.service';

@Global()
@Module({
  controllers: [StreamUrlController, StreamController],
  providers: [StreamTokenService, ActiveUserCache],
  exports: [StreamTokenService, ActiveUserCache],
})
export class StreamModule {}
