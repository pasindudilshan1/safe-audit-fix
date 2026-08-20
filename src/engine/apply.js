import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scan } from './audit.js';
import { planFix } from './plan.js';
import { createBackup, restoreBackup, sessionBackupExists } from './backup.js';
import { runNpm, runShell, tailOutput } from './exec.js';

/**
 * Detect a usable test command: `npm test` if the project defines a real test
 * script (not npm's "no test specified" placeholder). Returns null otherwise.
 */
export function detectTestCommand(cwd) {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    const script = pkg.scripts?.test;
    if (script && !/no test specified/i.test(script)) return 'npm test';
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Apply a single fix step with a safety net:
 *   backup manifests -> run the npm command -> run tests -> keep, or revert everything.
 */
export function applyStep(cwd, step, { testCommand = null, backupLabel = 'last-step' } = {}) {
  const backup = createBackup(cwd, backupLabel);

  const rollBack = () => {
    restoreBackup(cwd, backup);
    // re-sync node_modules to the restored lockfile
    runNpm(['install'], cwd);
  };

  const args =
    step.kind === 'safe-update'
      ? ['update', step.package]
      : ['install', `${step.package}@${step.version}`];

  const installRes = runNpm(args, cwd);
  if (installRes.status !== 0) {
    rollBack();
    return {
      ok: false,
      stage: 'install',
      reverted: true,
      detail: `"npm ${args.join(' ')}" failed — change reverted.`,
      output: tailOutput(installRes),
    };
  }

  if (testCommand) {
    const testRes = runShell(testCommand, cwd);
    if (testRes.status !== 0) {
      rollBack();
      return {
        ok: false,
        stage: 'test',
        reverted: true,
        detail: `Tests failed after "${step.command}" — change reverted. This fix likely introduces a breaking change; review it manually.`,
        output: tailOutput(testRes),
      };
    }
  }

  return {
    ok: true,
    stage: 'done',
    reverted: false,
    detail: testCommand
      ? `Applied "${step.command}" and tests passed.`
      : `Applied "${step.command}" (no test command configured — verify manually).`,
  };
}

/**
 * The main loop: plan, then apply each step one at a time.
 * Major (breaking) upgrades are skipped unless includeMajor is true.
 * Each applied step is verified by re-running the test command; failures revert.
 * A session backup lets the user undo the entire run with revertSession().
 */
export function fixAll(
  cwd,
  { testCommand, includeMajor = false, dryRun = false, onProgress = () => {} } = {}
) {
  if (testCommand === undefined) testCommand = detectTestCommand(cwd);

  const plan = planFix(cwd);
  const applied = [];
  const failed = [];
  const skippedMajor = [];

  // Baseline: if tests already fail before any change, every fix would be
  // wrongly blamed and reverted — refuse to start instead.
  if (!dryRun && testCommand && plan.steps.length > 0) {
    const baseline = runShell(testCommand, cwd);
    if (baseline.status !== 0) {
      throw new Error(
        `Your tests already fail BEFORE any fixes ("${testCommand}" exited with ${baseline.status}). ` +
          `Fix your tests first, or run with --no-test.\n${tailOutput(baseline)}`
      );
    }
  }

  if (!dryRun && plan.steps.length > 0) {
    createBackup(cwd, 'session');
  }

  let index = 0;
  for (const step of plan.steps) {
    index += 1;
    if (step.kind === 'major-upgrade' && !includeMajor) {
      skippedMajor.push(step);
      onProgress({ index, total: plan.steps.length, step, status: 'skipped-major' });
      continue;
    }
    if (dryRun) {
      onProgress({ index, total: plan.steps.length, step, status: 'dry-run' });
      continue;
    }

    onProgress({ index, total: plan.steps.length, step, status: 'applying' });
    const result = applyStep(cwd, step, { testCommand, backupLabel: `step-${index}` });
    onProgress({ index, total: plan.steps.length, step, status: result.ok ? 'applied' : 'reverted', result });
    (result.ok ? applied : failed).push({ step, result });
  }

  // The final re-scan is informational — a transient registry error here must
  // not discard the record of what was applied and reverted.
  let after = null;
  let afterScanError = null;
  if (!dryRun) {
    try {
      after = scan(cwd);
    } catch (err) {
      afterScanError = err.message;
    }
  }
  return {
    afterScanError,
    directory: cwd,
    testCommand,
    dryRun,
    before: plan.totals,
    after: after?.totals ?? null,
    applied,
    failed,
    skippedMajor,
    blocked: plan.blocked,
  };
}

/** Undo the entire last fixAll run: restore session manifests + re-sync node_modules. */
export function revertSession(cwd) {
  const backup = sessionBackupExists(cwd);
  if (!backup) {
    throw new Error('No session backup found (.safe-audit-fix/session). Nothing to revert.');
  }
  restoreBackup(cwd, backup);
  const res = runNpm(['install'], cwd);
  if (res.status !== 0) {
    throw new Error(`Manifests restored, but "npm install" failed:\n${tailOutput(res)}`);
  }
  return { reverted: true, restored: backup.saved };
}
