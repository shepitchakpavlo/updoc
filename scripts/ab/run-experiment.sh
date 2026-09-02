#!/usr/bin/env bash
# A/B experiment: one ticket on opencode with subagents disabled (task=deny)
# and a forced code-review artifact (.ab-review.md), same prompt shape as run-chain.sh.
# Usage: run-experiment.sh <worktree-path> <ticket-file>
set -uo pipefail
WT=$1
F=$2
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SPEC="$ROOT/.scratch/tb-0/spec.md"
LOG="$ROOT/scripts/ab/logs/exp-oc-chain.log"
t=$(basename "$F" .md)
echo "=== [exp-oc] START $t $(date '+%F %T')" | tee -a "$LOG"
(
  cd "$WT" || exit 1
  PROMPT="You are implementing ticket $t of the UpDoc TB-0 tracer bullet. Read the ticket and spec below, implement EVERY acceptance criterion, run typecheck and relevant tests before committing, then commit your work when done. Do NOT start long-running services (docker compose up, dev servers) — verification is done by the orchestrator. Installed skills are available under .agents/skills (tdd, code-review, implement): follow the tdd skill (red-green-refactor, one seam at a time). After implementing, follow the code-review skill: review your own diff against TWO axes — Standards (documented repo standards + Fowler smells) and Spec (the ticket's acceptance criteria) — and WRITE your findings to a file named .ab-review.md at the repo root (structure: two sections ## Standards and ## Spec, each finding with file path and line numbers). Then commit everything including .ab-review.md.

=== TICKET: $t ===
$(cat "$F")

=== PROJECT SPEC (TB-0) ===
$(cat "$SPEC")"
  OPENCODE_CONFIG="$ROOT/scripts/ab/opencode-experiment.json" \
    opencode run --variant max --model opencode/deepseek-v4-flash "$PROMPT"
)
rc=$?
echo "=== [exp-oc] DONE $t rc=$rc commits=$(git -C "$WT" rev-list --count main..HEAD) $(date '+%F %T')" | tee -a "$LOG"
exit $rc
