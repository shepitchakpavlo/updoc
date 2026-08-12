#!/usr/bin/env bash
# A/B harness: run ALL TB-0 tickets through ONE agent in ONE worktree.
# Usage: scripts/ab/run-chain.sh <oc|omp> <worktree-path>
# Runs tickets 01..09 in dependency order, same prompt shape per ticket,
# model pinned to opencode/deepseek-v4-flash. Main repo stays untouched.
set -uo pipefail

AGENT=$1
WT=$2
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ISSUES="$ROOT/.scratch/tb-0/issues"
SPEC="$ROOT/.scratch/tb-0/spec.md"
LOG="$ROOT/scripts/ab/logs/${AGENT}-chain.log"
mkdir -p "$(dirname "$LOG")"

echo "=== [$AGENT] chain start $(date '+%F %T') base=$(git -C "$WT" rev-parse --short main)" | tee -a "$LOG"

for f in "$ISSUES"/[0-9][0-9]-*.md; do
  t=$(basename "$f" .md)
  before=$(git -C "$WT" rev-list --count main..HEAD)
  echo "=== [$AGENT] START $t $(date '+%F %T')" | tee -a "$LOG"
  (
    cd "$WT" || exit 1
    # Ticket + spec embedded in the prompt (not file paths): worktrees can't read
    # files outside themselves in non-interactive mode, and identical bytes for
    # both agents keep the A/B fair.
    PROMPT="You are implementing ticket $t of the UpDoc TB-0 tracer bullet. Read the ticket and spec below, implement EVERY acceptance criterion, run typecheck and relevant tests before committing, then commit your work when done. Do NOT start long-running services (docker compose up, dev servers) — verification is done by the orchestrator. Installed skills are available under .agents/skills (tdd, code-review, implement): follow the tdd skill (red-green-refactor, one seam at a time) and, before committing, follow the code-review skill — review your own diff against coding standards and the ticket's acceptance criteria and fix what fails.

=== TICKET: $t ===
$(cat "$f")

=== PROJECT SPEC (TB-0) ===
$(cat "$SPEC")"
    if [ "$AGENT" = "oc" ]; then
      # thinking.type=disabled у глобальному opencode.json конфліктує з --variant max
      # (reasoning_effort) — run-скоуповий конфіг вмикає thinking для цього запуску.
      OPENCODE_CONFIG="$ROOT/scripts/ab/opencode-thinking.json" \
        opencode run --variant max --model opencode/deepseek-v4-flash "$PROMPT"
    else
      omp -p --thinking max --model opencode/deepseek-v4-flash "$PROMPT"
    fi
  ) >>"$LOG" 2>&1
  rc=$?
  after=$(git -C "$WT" rev-list --count main..HEAD)
  echo "=== [$AGENT] DONE $t rc=$rc commits=$((after-before)) total=$after $(date '+%F %T')" | tee -a "$LOG"
done

echo "=== [$AGENT] chain finished $(date '+%F %T')" | tee -a "$LOG"
