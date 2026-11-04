-- Genres on albums, lyrics and a lossless flag on tracks.
ALTER TABLE "Album" ADD COLUMN     "genres" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Track" ADD COLUMN     "lossless" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lyrics" TEXT;

CREATE INDEX "Album_genres_idx" ON "Album" USING GIN ("genres");
