# Dev/test toolbox image: Node 24 + openssl (Prisma) + ffmpeg (transcoding tests).
FROM node:24-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates ffmpeg git \
  && rm -rf /var/lib/apt/lists/*
