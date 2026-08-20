import { scan } from './audit.js';
import { assertSafePackageName, assertSafeVersion } from './exec.js';

const RISK_ORDER = { low: 0, moderate: 1, high: 2 };

/**
 * Turn an audit report into an ordered list of one-at-a-time fix steps.
 *
 * Step kinds:
 *  - "safe-update":   fix fits inside the existing semver range  -> `npm update <pkg>`   (risk: low)
 *  - "install-update": needs a new top-level version, NOT a major -> `npm install p@v`    (risk: moderate)
 *  - "major-upgrade": needs a breaking major-version change       -> `npm install p@v`    (risk: high, opt-in)
 *
 * Vulnerabilities with no fix at all are returned in `blocked` with guidance.
 */
export function planFix(cwd, { report } = {}) {
  const audit = report ?? scan(cwd);
  const steps = [];
  const blocked = [];
  const byAction = new Map(); // dedupe: one install can fix many advisories

  for (const v of audit.vulnerabilities) {
    if (v.fixAvailable === false) {
      blocked.push({
        package: v.name,
        severity: v.severity,
        reason: 'No fixed version is published yet.',
        guidance:
          `Options: (1) add an "overrides" entry in package.json pinning ${v.name} outside the vulnerable range ` +
          `${v.vulnerableRange ?? ''} once a patched version exists, (2) replace the dependency that pulls it in` +
          (v.causedBy.length ? ` (${v.causedBy.join(', ')})` : '') +
          ', or (3) accept the risk if the vulnerable code path is not reachable in your app.',
      });
      continue;
    }

    let step;
    if (v.fixAvailable === true) {
      assertSafePackageName(v.name);
      step = {
        kind: 'safe-update',
        risk: 'low',
        package: v.name,
        version: null,
        command: `npm update ${v.name}`,
        why: 'Fix fits inside your existing version ranges — no package.json change needed.',
      };
    } else {
      const f = v.fixAvailable;
      assertSafePackageName(f.name);
      assertSafeVersion(f.version);
      step = {
        kind: f.isSemVerMajor ? 'major-upgrade' : 'install-update',
        risk: f.isSemVerMajor ? 'high' : 'moderate',
        package: f.name,
        version: f.version,
        command: `npm install ${f.name}@${f.version}`,
        why: f.isSemVerMajor
          ? `BREAKING: requires major-version change of ${f.name} to ${f.version}. APIs may have been removed — only applied with --include-major, and still test-verified.`
          : `Requires updating top-level dependency ${f.name} to ${f.version} (non-breaking per semver).`,
      };
    }

    const key = `${step.kind}:${step.package}@${step.version ?? 'in-range'}`;
    const existing = byAction.get(key);
    if (existing) {
      existing.fixes.push(vulnSummary(v));
    } else {
      step.fixes = [vulnSummary(v)];
      byAction.set(key, step);
      steps.push(step);
    }
  }

  steps.sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk]);
  return { directory: audit.directory, totals: audit.totals, steps, blocked };
}

function vulnSummary(v) {
  return {
    package: v.name,
    severity: v.severity,
    direct: v.isDirect,
    advisories: v.advisories.map((a) => a.title).filter(Boolean),
  };
}
