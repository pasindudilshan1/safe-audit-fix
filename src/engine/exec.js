import { spawnSync } from 'node:child_process';

const TEN_MINUTES = 10 * 60 * 1000;

const PACKAGE_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const VERSION_RE = /^[0-9a-zA-Z.^~<>=|+\- *]+$/;

export function assertSafePackageName(name) {
  if (typeof name !== 'string' || !PACKAGE_NAME_RE.test(name)) {
    throw new Error(`Refusing to use suspicious package name: ${JSON.stringify(name)}`);
  }
  return name;
}

export function assertSafeVersion(version) {
  if (typeof version !== 'string' || !VERSION_RE.test(version)) {
    throw new Error(`Refusing to use suspicious version string: ${JSON.stringify(version)}`);
  }
  return version;
}

/**
 * Run npm with the given args. On Windows npm is npm.cmd, which requires a shell,
 * so the command is built as a single string. Args never contain spaces or shell
 * metacharacters: they are npm subcommands/flags plus package specs validated by
 * assertSafePackageName / assertSafeVersion.
 */
export function runNpm(args, cwd, { timeout = TEN_MINUTES } = {}) {
  for (const a of args) {
    if (!/^[a-zA-Z0-9@/^~<>=.:_-]+$/.test(a)) {
      throw new Error(`Refusing to pass suspicious npm argument: ${JSON.stringify(a)}`);
    }
  }
  const result = spawnSync(`npm ${args.join(' ')}`, {
    cwd,
    timeout,
    encoding: 'utf8',
    shell: true,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  return normalize(result);
}

/**
 * Run an arbitrary user-supplied command string (e.g. their test command) in a shell.
 */
export function runShell(command, cwd, { timeout = TEN_MINUTES } = {}) {
  const result = spawnSync(command, {
    cwd,
    timeout,
    encoding: 'utf8',
    shell: true,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  return normalize(result);
}

function normalize(result) {
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    timedOut: result.error?.code === 'ETIMEDOUT',
    error: result.error ? String(result.error.message ?? result.error) : null,
  };
}

/** Last N lines of combined output — for readable failure reports. */
export function tailOutput(res, lines = 40) {
  const combined = `${res.stdout}\n${res.stderr}`.trim();
  const all = combined.split(/\r?\n/);
  return all.slice(-lines).join('\n');
}
