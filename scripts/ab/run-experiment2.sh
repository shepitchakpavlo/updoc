#!/usr/bin/env bash
# Experiment 2: same as exp1 (subagents off, forced artifact) PLUS concrete
# pre-commit gates — exact executable checks instead of behavioral instruction.
# Usage: run-experiment2.sh <worktree-path> <ticket-file>
set -uo pipefail
WT=$1
F=$2
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SPEC="$ROOT/.scratch/tb-0/spec.md"
LOG="$ROOT/scripts/ab/logs/exp2-oc-chain.log"
t=$(basename "$F" .md)
echo "=== [exp2-oc] START $t $(date '+%F %T')" | tee -a "$LOG"
(
  cd "$WT" || exit 1
  PROMPT="You are implementing ticket $t of the UpDoc TB-0 tracer bullet. Read the ticket and spec below, implement EVERY acceptance criterion, run typecheck and relevant tests before committing, then commit your work when done. Do NOT start long-running services (docker compose up, dev servers) — verification is done by the orchestrator. Installed skills are available under .agents/skills (tdd, code-review, implement): follow the tdd skill (red-green-refactor, one seam at a time).

### MANDATORY PRE-COMMIT GATES — execute each one as actual tool calls, fix every failure, and only then commit:

GATE 1 (logs/PII): ensure no raw access token can ever appear in server logs. The access token travels in the URL path of routes. Check the Fastify logger configuration in apps/api/src/app.ts: if it uses logger: true (or anything that logs request URLs), change it to disable request logging or add redaction so token-bearing URLs are not logged. Verify with: grep -rn \"logger\" apps/api/src/app.ts

GATE 2 (web tests): apps/web must contain at least one test file (in apps/web/test/ or apps/web/src/**/__tests__/). The root package.json \"test\" script must run tests for BOTH workspaces (use --workspaces, or explicitly add the web workspace).

GATE 3 (build): the root package.json must have a \"build\" script that builds both apps (e.g. npm run build --workspaces or per-workspace calls). Run: npm run build — it must pass.

GATE 4: run: npm run typecheck  and  npm test — both must pass.

GATE 5 (report): after gates 1-4 pass, write .ab-gates.md to the repo root: for each gate, one line — what you checked, what you found, what you fixed (or 'already ok'). Then commit EVERYTHING (code, tests, .ab-gates.md).

=== TICKET: $t ===
$(cat "$F")

=== PROJECT SPEC (TB-0) ===
$(cat "$SPEC")"
  OPENCODE_CONFIG="$ROOT/scripts/ab/opencode-experiment.json" \
    opencode run --variant max --model opencode/deepseek-v4-flash "$PROMPT"
)
rc=$?
echo "=== [exp2-oc] DONE $t rc=$rc commits=$(git -C "$WT" rev-list --count main..HEAD) $(date '+%F %T')" | tee -a "$LOG"
exit $rc
