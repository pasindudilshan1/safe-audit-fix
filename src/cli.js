#!/usr/bin/env node
import { resolve } from 'node:path';
import { scan, planFix, fixAll, revertSession, detectTestCommand } from './engine/index.js';

const SEVERITY_ICON = { critical: '🔴', high: '🟠', moderate: '🟡', low: '🟢', info: 'ℹ️ ' };
const RISK_ICON = { low: '🟢 low', moderate: '🟡 moderate', high: '🔴 HIGH (breaking)' };

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--test') {
      args.flags.test = argv[++i];
      if (!args.flags.test) fail('--test requires a command, e.g. --test "npm test"');
    }
    else if (a === '--dir') args.flags.dir = argv[++i];
    else if (a === '--no-test') args.flags.noTest = true;
    else if (a === '--include-major') args.flags.includeMajor = true;
    else if (a === '--dry-run') args.flags.dryRun = true;
    else if (a === '--json') args.flags.json = true;
    else if (a === '--help' || a === '-h') args.flags.help = true;
    else if (a.startsWith('--')) fail(`Unknown option: ${a}`);
    else args._.push(a);
  }
  return args;
}

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

function usage() {
  console.log(`safe-audit-fix — fix npm vulnerabilities one at a time, with tests and auto-revert

Usage:
  safe-audit-fix scan   [--dir <path>] [--json]     Show vulnerabilities
  safe-audit-fix plan   [--dir <path>] [--json]     Show the fix plan with risk levels (changes nothing)
  safe-audit-fix fix    [--dir <path>] [options]    Apply fixes one at a time, testing after each
  safe-audit-fix revert [--dir <path>]              Undo the entire last "fix" run

Options for fix:
  --test "<command>"   Test command to run after every fix (default: "npm test" if the project has one)
  --no-test            Skip testing (fixes are still applied one at a time and install failures still revert)
  --include-major      Also apply BREAKING major-version upgrades (still test-verified and reverted on failure)
  --dry-run            Show what would happen without changing anything
  --json               Machine-readable output (scan/plan)

Unlike "npm audit fix --force", a breaking change can never silently land:
every step is tested, and any step that fails is automatically reverted.`);
}

function printScan(report) {
  const t = report.totals;
  console.log(`\nAudit of ${report.directory}`);
  console.log(
    `Found ${t.total} vulnerabilit${t.total === 1 ? 'y' : 'ies'}: ` +
      `${t.critical} critical, ${t.high} high, ${t.moderate} moderate, ${t.low} low\n`
  );
  for (const v of report.vulnerabilities) {
    const icon = SEVERITY_ICON[v.severity] ?? '•';
    const fix =
      v.fixAvailable === false
        ? 'no fix published'
        : v.fixAvailable === true
          ? 'fixable in-range (safe)'
          : `fix via ${v.fixAvailable.name}@${v.fixAvailable.version}${v.fixAvailable.isSemVerMajor ? ' (BREAKING major)' : ''}`;
    console.log(`${icon} ${v.name}  ${v.severity}  ${v.isDirect ? '(direct)' : '(transitive)'}  → ${fix}`);
    for (const a of v.advisories) console.log(`     ${a.title ?? ''} ${a.url ?? ''}`.trimEnd());
  }
  if (report.vulnerabilities.length === 0) console.log('✅ No known vulnerabilities.');
}

function printPlan(plan) {
  console.log(`\nFix plan for ${plan.directory} — ${plan.steps.length} step(s), safest first:\n`);
  plan.steps.forEach((s, i) => {
    console.log(`${i + 1}. [${RISK_ICON[s.risk]}] ${s.command}`);
    console.log(`   ${s.why}`);
    console.log(`   fixes: ${s.fixes.map((f) => `${f.package} (${f.severity})`).join(', ')}`);
  });
  if (plan.steps.some((s) => s.kind === 'major-upgrade')) {
    console.log('\n⚠ Major upgrades are only applied when you pass --include-major.');
  }
  for (const b of plan.blocked) {
    console.log(`\n⛔ ${b.package} (${b.severity}): ${b.reason}\n   ${b.guidance}`);
  }
  if (plan.steps.length === 0 && plan.blocked.length === 0) console.log('✅ Nothing to fix.');
}

function main() {
  const { _, flags } = parseArgs(process.argv.slice(2));
  const command = _[0];
  if (flags.help || !command) return usage();
  const cwd = resolve(flags.dir ?? process.cwd());

  switch (command) {
    case 'scan': {
      const report = scan(cwd);
      if (flags.json) console.log(JSON.stringify(report, null, 2));
      else printScan(report);
      break;
    }
    case 'plan': {
      const plan = planFix(cwd);
      if (flags.json) console.log(JSON.stringify(plan, null, 2));
      else printPlan(plan);
      break;
    }
    case 'fix': {
      const testCommand = flags.noTest ? null : (flags.test ?? detectTestCommand(cwd));
      if (!testCommand && !flags.noTest) {
        console.log('ℹ No test script found — proceeding without test verification (pass --test "<cmd>" to add one).');
      } else if (testCommand) {
        console.log(`ℹ Verifying every fix with: ${testCommand}`);
      }
      const result = fixAll(cwd, {
        testCommand,
        includeMajor: Boolean(flags.includeMajor),
        dryRun: Boolean(flags.dryRun),
        onProgress: ({ index, total, step, status, result }) => {
          const tag = `[${index}/${total}]`;
          if (status === 'applying') console.log(`${tag} ▶ ${step.command} ...`);
          else if (status === 'applied') console.log(`${tag} ✅ kept — ${result.detail}`);
          else if (status === 'reverted') {
            console.log(`${tag} ↩ reverted — ${result.detail}`);
            if (result.output) console.log(indent(result.output));
          } else if (status === 'skipped-major') console.log(`${tag} ⏭ skipped (major upgrade): ${step.command}`);
          else if (status === 'dry-run') console.log(`${tag} (dry-run) would run: ${step.command}`);
        },
      });

      console.log('\n— Summary —');
      console.log(`Applied: ${result.applied.length}   Reverted: ${result.failed.length}   Skipped major: ${result.skippedMajor.length}   No fix available: ${result.blocked.length}`);
      if (result.after) {
        console.log(`Vulnerabilities: ${result.before.total} before → ${result.after.total} after`);
      } else if (result.afterScanError) {
        console.log(`⚠ Could not re-scan after fixing (${result.afterScanError.split('\n')[0]}) — run "safe-audit-fix scan" to see the current state.`);
      }
      if (result.skippedMajor.length) {
        console.log('Re-run with --include-major to attempt the breaking upgrades (still test-protected).');
      }
      if (result.applied.length) {
        console.log('To undo everything from this run: safe-audit-fix revert');
      }
      break;
    }
    case 'revert': {
      const res = revertSession(cwd);
      console.log(`✅ Reverted last fix session. Restored: ${res.restored.join(', ')}`);
      break;
    }
    default:
      fail(`Unknown command: ${command}. Run with --help for usage.`);
  }
}

function indent(text) {
  return text
    .split('\n')
    .map((l) => `      ${l}`)
    .join('\n');
}

try {
  main();
} catch (err) {
  fail(err.message);
}
