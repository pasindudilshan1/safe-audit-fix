# safe-audit-fix

**Fix npm vulnerabilities without breaking your app.**

`npm audit fix --force` can silently jump major versions, downgrade packages, and break your build. `safe-audit-fix` takes the opposite approach — like a careful surgeon instead of a sledgehammer:

1. **Plan first** — every fix is risk-labeled (`low` / `moderate` / `high-breaking`) before anything changes.
2. **One fix at a time** — never a big-bang change.
3. **Test after every fix** — your own test command runs after each step.
4. **Auto-revert** — if install or tests fail, that fix is instantly undone (package.json + lockfile restored, node_modules re-synced).
5. **Breaking upgrades are opt-in** — major-version jumps are skipped unless you pass `--include-major`, and even then they are test-protected.
6. **Full undo** — `safe-audit-fix revert` restores everything from before the run.

It works two ways from one shared engine:

```
                 ┌────────────────────┐
   you ──────────►      CLI            │
                 ├────────────────────┤──► core engine: scan → plan → fix one → test → keep/revert
   AI assistant ─►   MCP server        │
   (Claude Code, └────────────────────┘
    Cursor, ...)
```

## Requirements

- Node.js ≥ 18, npm ≥ 7 (needs the modern `npm audit --json` format)
- A `package-lock.json` in the target project (run `npm install` once if missing)

## Install

```bash
git clone <this-repo> && cd safe-audit-fix
npm install
npm link        # makes the `safe-audit-fix` command available globally
```

## CLI usage

```bash
safe-audit-fix scan                 # show vulnerabilities + whether each fix is safe or breaking
safe-audit-fix plan                 # show the ordered fix plan (changes nothing)
safe-audit-fix fix                  # apply fixes one at a time, testing after each
safe-audit-fix fix --include-major  # also attempt breaking upgrades (test-protected)
safe-audit-fix fix --dry-run        # preview only
safe-audit-fix fix --test "npm run test:unit"   # custom verify command
safe-audit-fix fix --no-test        # skip test verification (install failures still revert)
safe-audit-fix revert               # undo the entire last fix run
```

All commands accept `--dir <path>` to target another project, and `scan`/`plan` accept `--json`.

Before any fix is applied, your tests are run once as a **baseline** — if they already fail, the tool refuses to start (otherwise every fix would be wrongly blamed and reverted).

## MCP server (use it from Claude Code, Cursor, etc.)

Register the server, then just ask your AI assistant: *"safely fix the vulnerabilities in my project"*.

**Claude Code:**

```bash
claude mcp add safe-audit-fix -- node <absolute-path>/src/mcp-server.js
```

**Or via `.mcp.json` / MCP config file:**

```json
{
  "mcpServers": {
    "safe-audit-fix": {
      "command": "node",
      "args": ["<absolute-path>/src/mcp-server.js"]
    }
  }
}
```

Exposed tools:

| Tool | What it does | Changes files? |
|---|---|---|
| `scan_vulnerabilities` | Structured audit report | No |
| `plan_fixes` | Ordered, risk-labeled fix plan | No |
| `apply_fixes_safely` | The fix-test-revert loop (`dryRun`, `includeMajor`, `testCommand` options) | Yes |
| `revert_last_session` | Undo the last fix run | Yes |

## How it compares

| | `npm audit fix` | `npm audit fix --force` | Asking an AI in chat | **safe-audit-fix** |
|---|---|---|---|---|
| Fixes in-range vulns | ✅ | ✅ | manual | ✅ |
| Fixes breaking (major) vulns | ❌ | ✅ silently | manual | ✅ opt-in |
| Runs your tests after each change | ❌ | ❌ | ❌ | ✅ |
| Auto-reverts a bad fix | ❌ | ❌ | ❌ | ✅ |
| Shows a risk-labeled plan first | ❌ | ❌ | ⚠️ | ✅ |
| One-command full undo | ❌ | ❌ | ❌ | ✅ |
| Usable by AI assistants (MCP) | ❌ | ❌ | — | ✅ |

## Library usage

The engine is importable directly:

```js
import { scan, planFix, fixAll, revertSession } from 'safe-audit-fix';

const result = fixAll('/path/to/project', { includeMajor: false });
console.log(result.applied, result.failed, result.blocked);
```

## Roadmap

- `--explain`: use an LLM to summarize the changelog/breaking changes of a planned major upgrade
- Reachability analysis: skip vulnerabilities whose vulnerable code path is never called from your code
- Automatic `overrides` suggestions for transitive vulnerabilities with no parent fix
- Support for pnpm / yarn

## License

MIT
