#!/usr/bin/env bash
# run-hypothesis.sh — parameterized hypothesis runner.
# Usage: run-hypothesis.sh <agent:oc|omp> <model:flash|pro> <mode:gates|nogates> <worktree>
set -uo pipefail
AGENT=$1
MODEL=$2
MODE=$3
WT=$4
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SPEC="$ROOT/.scratch/tb-0/spec.md"
F="$ROOT/.scratch/tb-0/issues/05-spa-form.md"
LOG="$ROOT/scripts/ab/logs/hyp-${AGENT}-${MODEL}-${MODE}.log"
t=$(basename "$F" .md)
echo "=== [${AGENT}/${MODEL}/${MODE}] START $t $(date '+%F %T')" | tee -a "$LOG"
(
  cd "$WT" || exit 1
  BASE="You are implementing ticket $t of the UpDoc TB-0 tracer bullet. Read the ticket and spec below, implement EVERY acceptance criterion, run typecheck and relevant tests before committing, then commit your work when done. Do NOT start long-running services (docker compose up, dev servers) — verification is done by the orchestrator. Installed skills are available under .agents/skills (tdd, code-review, implement): follow the tdd skill (red-green-refactor, one seam at a time)."
  GATES="
### MANDATORY PRE-COMMIT GATES — execute each one as actual tool calls, fix every failure, and only then commit:

GATE 1 (logs/PII): ensure no raw access token can ever appear in server logs. The access token travels in the URL path of routes. Check the Fastify logger configuration in apps/api/src/app.ts: if it uses logger: true (or anything that logs request URLs), change it to disable request logging or add redaction so token-bearing URLs are not logged. Verify with: grep -rn \"logger\" apps/api/src/app.ts

GATE 2 (web tests): apps/web must contain at least one test file (in apps/web/test/ or apps/web/src/**/__tests__/). The root package.json \"test\" script must run tests for BOTH workspaces (use --workspaces, or explicitly add the web workspace).

GATE 3 (build): the root package.json must have a \"build\" script that builds both apps (e.g. npm run build --workspaces or per-workspace calls). Run: npm run build — it must pass.

GATE 4: run: npm run typecheck  and  npm test — both must pass.

GATE 5 (report): after gates 1-4 pass, write .ab-gates.md to the repo root: for each gate, one line — what you checked, what you found, what you fixed (or 'already ok'). Then commit EVERYTHING (code, tests, .ab-gates.md)."
  if [ "$MODE" = "gates" ]; then EXTRA="$GATES"; else EXTRA=""; fi
  PROMPT="${BASE}${EXTRA}

=== TICKET: $t ===
$(cat "$F")

=== PROJECT SPEC (TB-0) ===
$(cat "$SPEC")"
  if [ "$AGENT" = "oc" ]; then
    case "$MODEL" in
      pro) M="opencode/deepseek-v4-pro" ;;
      *)   M="opencode/deepseek-v4-flash" ;;
    esac
    if [ "$MODE" = "h1subs" ]; then
      OPENCODE_CONFIG="$ROOT/scripts/ab/opencode-h1.json" \
        opencode run --variant max --model "$M" "$PROMPT"
    else
      OPENCODE_CONFIG="$ROOT/scripts/ab/opencode-experiment.json" \
        opencode run --variant max --model "$M" "$PROMPT"
    fi
  else
    omp -p --thinking max --model opencode/deepseek-v4-flash "$PROMPT"
  fi
)
rc=$?
echo "=== [${AGENT}/${MODEL}/${MODE}] DONE $t rc=$rc commits=$(git -C "$WT" rev-list --count main..HEAD) $(date '+%F %T')" | tee -a "$LOG"
exit $rc
