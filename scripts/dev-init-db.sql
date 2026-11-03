-- Runs once when the dev Postgres volume is first created. The e2e suite uses its own database.
CREATE DATABASE music_test OWNER music;
