#!/usr/bin/env node
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { scan, planFix, fixAll, revertSession, detectTestCommand } from './engine/index.js';

const server = new McpServer({
  name: 'safe-audit-fix',
  version: '0.1.0',
});

const directorySchema = z
  .string()
  .describe('Absolute path to the npm project (the folder containing package.json).');

function jsonResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function errorResult(err) {
  return { isError: true, content: [{ type: 'text', text: `Error: ${err.message}` }] };
}

server.registerTool(
  'scan_vulnerabilities',
  {
    title: 'Scan for npm vulnerabilities',
    description:
      'Run npm audit on a project and return a structured vulnerability report: severity, direct vs transitive, and whether a fix is available (and whether that fix is a breaking major upgrade). Read-only.',
    inputSchema: { directory: directorySchema },
  },
  async ({ directory }) => {
    try {
      return jsonResult(scan(resolve(directory)));
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  'plan_fixes',
  {
    title: 'Plan vulnerability fixes',
    description:
      'Build an ordered, risk-labeled fix plan (safest first) without changing anything. Each step is one npm command; breaking major upgrades are flagged. Also lists vulnerabilities with no published fix, with guidance (overrides, replacement, reachability). Read-only.',
    inputSchema: { directory: directorySchema },
  },
  async ({ directory }) => {
    try {
      return jsonResult(planFix(resolve(directory)));
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  'apply_fixes_safely',
  {
    title: 'Apply vulnerability fixes safely',
    description:
      'Fix vulnerabilities ONE AT A TIME. After each fix the project test command runs; if installation or tests fail, that fix is automatically reverted (package.json + lockfile restored, node_modules re-synced). Breaking major upgrades are skipped unless includeMajor is true. Use dryRun first to preview. Modifies the project.',
    inputSchema: {
      directory: directorySchema,
      testCommand: z
        .string()
        .optional()
        .describe(
          'Command to verify each fix (e.g. "npm test"). Defaults to "npm test" when the project defines a real test script. Pass an empty string to skip testing.'
        ),
      includeMajor: z
        .boolean()
        .optional()
        .describe('Also attempt breaking major-version upgrades (still test-verified and auto-reverted on failure). Default false.'),
      dryRun: z.boolean().optional().describe('Preview the steps without changing anything. Default false.'),
    },
  },
  async ({ directory, testCommand, includeMajor, dryRun }) => {
    try {
      const cwd = resolve(directory);
      const resolvedTest =
        testCommand === undefined ? detectTestCommand(cwd) : testCommand === '' ? null : testCommand;
      const result = fixAll(cwd, {
        testCommand: resolvedTest,
        includeMajor: Boolean(includeMajor),
        dryRun: Boolean(dryRun),
      });
      return jsonResult(result);
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  'revert_last_session',
  {
    title: 'Revert the last fix session',
    description:
      'Undo everything done by the most recent apply_fixes_safely run: restores package.json and the lockfile from the session backup and re-syncs node_modules.',
    inputSchema: { directory: directorySchema },
  },
  async ({ directory }) => {
    try {
      return jsonResult(revertSession(resolve(directory)));
    } catch (err) {
      return errorResult(err);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('safe-audit-fix MCP server running on stdio');
