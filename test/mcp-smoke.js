// Smoke test: drive the MCP server over stdio like a real client would.
// Run from anywhere: node test/mcp-smoke.js
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(root, 'test-fixture');

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, 'src', 'mcp-server.js')],
});
const client = new Client({ name: 'smoke-test', version: '0.0.0' });
await client.connect(transport);

const tools = await client.listTools();
console.log('TOOLS:', tools.tools.map((t) => t.name).join(', '));

const scanRes = await client.callTool({
  name: 'scan_vulnerabilities',
  arguments: { directory: fixture },
});
const report = JSON.parse(scanRes.content[0].text);
console.log('SCAN totals:', JSON.stringify(report.totals));

const planRes = await client.callTool({
  name: 'plan_fixes',
  arguments: { directory: fixture },
});
const plan = JSON.parse(planRes.content[0].text);
console.log('PLAN steps:', plan.steps.map((s) => `${s.command} [${s.risk}]`).join(' | '));

const dryRes = await client.callTool({
  name: 'apply_fixes_safely',
  arguments: { directory: fixture, dryRun: true },
});
const dry = JSON.parse(dryRes.content[0].text);
console.log('DRY-RUN:', `dryRun=${dry.dryRun}`, `applied=${dry.applied.length}`, `skippedMajor=${dry.skippedMajor.length}`);

await client.close();
console.log('MCP smoke test passed');
