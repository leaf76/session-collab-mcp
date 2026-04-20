import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const VERSIONED_MIGRATION_PATTERN = /^\d{4}_.+\.sql$/;

export function listMigrationFiles(migrationsDir: string): string[] {
  return readdirSync(migrationsDir)
    .filter((file) => VERSIONED_MIGRATION_PATTERN.test(file))
    .sort((left, right) => left.localeCompare(right, 'en'));
}

export function loadMigrationsFromDir(migrationsDir: string): string[] {
  return listMigrationFiles(migrationsDir).map((file) =>
    readFileSync(join(migrationsDir, file), 'utf-8')
  );
}

export function splitMigrationStatements(migration: string): string[] {
  const withoutCommentLines = migration
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  return withoutCommentLines
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
