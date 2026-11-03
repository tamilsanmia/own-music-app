-- Separate migration: Postgres can't use a new enum value in the transaction that adds it.
ALTER TYPE "TrackStatus" ADD VALUE 'UPLOADING' BEFORE 'PENDING';
