import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BACKUP_DIR = '.safe-audit-fix';
const MANIFEST_FILES = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json'];

function backupRoot(cwd) {
  const dir = join(cwd, BACKUP_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    // keep backups out of version control
    writeFileSync(join(dir, '.gitignore'), '*\n');
  }
  return dir;
}

/**
 * Snapshot the dependency manifests into .safe-audit-fix/<label>/.
 * Only package.json + lockfiles are copied — node_modules is re-synced from the
 * lockfile on restore, so no giant directory copies are needed.
 */
export function createBackup(cwd, label) {
  const dir = join(backupRoot(cwd), label);
  mkdirSync(dir, { recursive: true });
  const saved = [];
  for (const file of MANIFEST_FILES) {
    const src = join(cwd, file);
    if (existsSync(src)) {
      copyFileSync(src, join(dir, file));
      saved.push(file);
    }
  }
  return { dir, saved };
}

/** Restore manifests from a backup created by createBackup. */
export function restoreBackup(cwd, backup) {
  for (const file of backup.saved) {
    copyFileSync(join(backup.dir, file), join(cwd, file));
  }
}

export function sessionBackupExists(cwd) {
  const dir = join(cwd, BACKUP_DIR, 'session');
  return existsSync(join(dir, 'package.json'))
    ? { dir, saved: MANIFEST_FILES.filter((f) => existsSync(join(dir, f))) }
    : null;
}
