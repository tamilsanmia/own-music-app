-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "originalExt" TEXT,
ADD COLUMN     "originalFilename" TEXT,
ADD COLUMN     "sizeBytes" INTEGER,
ADD COLUMN     "sourceInfo" TEXT,
ALTER COLUMN "status" SET DEFAULT 'UPLOADING';
