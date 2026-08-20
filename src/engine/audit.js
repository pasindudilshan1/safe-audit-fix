import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runNpm, tailOutput } from './exec.js';

/**
 * Run `npm audit --json` and return a structured, simplified report.
 *
 * npm exits non-zero when vulnerabilities exist — that is expected and not an error.
 */
export function scan(cwd) {
  if (!existsSync(join(cwd, 'package.json'))) {
    throw new Error(`No package.json found in ${cwd}`);
  }
  if (!existsSync(join(cwd, 'package-lock.json')) && !existsSync(join(cwd, 'npm-shrinkwrap.json'))) {
    throw new Error(
      `No package-lock.json found in ${cwd}. npm audit needs a lockfile — run "npm install" (or "npm i --package-lock-only") first.`
    );
  }

  // Registry hiccups are common enough that one retry is worth it.
  let data;
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = runNpm(['audit', '--json'], cwd);
    try {
      data = JSON.parse(res.stdout);
    } catch {
      lastError = new Error(`npm audit did not return JSON. Output:\n${tailOutput(res)}`);
      continue;
    }
    if (data.error) {
      const e = data.error;
      const msg = [e.code, e.summary, e.detail].filter(Boolean).join(' — ');
      lastError = new Error(`npm audit failed: ${msg || tailOutput(res) || 'unknown error'}`);
      data = undefined;
      continue;
    }
    break;
  }
  if (!data) throw lastError;

  const vulnerabilities = Object.values(data.vulnerabilities ?? {}).map((v) => ({
    name: v.name,
    severity: v.severity,
    isDirect: Boolean(v.isDirect),
    vulnerableRange: v.range,
    // `via` mixes advisory objects and plain package-name strings (transitive causes)
    advisories: (v.via ?? [])
      .filter((x) => typeof x === 'object' && x !== null)
      .map((a) => ({ title: a.title, severity: a.severity, range: a.range, url: a.url })),
    causedBy: (v.via ?? []).filter((x) => typeof x === 'string'),
    // false = no fix | true = fixable within current semver ranges |
    // { name, version, isSemVerMajor } = fixed by installing name@version at the top level
    fixAvailable: v.fixAvailable,
  }));

  const counts = data.metadata?.vulnerabilities ?? {};
  return {
    directory: cwd,
    totals: {
      total: counts.total ?? vulnerabilities.length,
      critical: counts.critical ?? 0,
      high: counts.high ?? 0,
      moderate: counts.moderate ?? 0,
      low: counts.low ?? 0,
      info: counts.info ?? 0,
    },
    vulnerabilities,
  };
}
