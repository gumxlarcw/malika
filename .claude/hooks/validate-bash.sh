#!/bin/bash
# PreToolUse(Bash) guard — hard-denies catastrophic shell commands before they run.
# Wired from .claude/settings.json. Receives the tool call as JSON on stdin and
# emits a PreToolUse permission decision. jq is required (already used by
# session-start.sh); if jq is missing we fail OPEN so the session isn't bricked.
#
# Matching a pattern => "deny" (the command never runs). No match => stay silent
# and let Claude Code's normal permission flow decide.
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')
[ -z "$cmd" ] && exit 0

# ─── DANGEROUS-COMMAND POLICY ────────────────────────────────────────────────
# Extended-regex patterns. If the command matches ANY of these, it is blocked.
# This is the one part worth tuning to MALIKA's workflow — see the note in the
# session summary. Legitimate project commands (pm2 reload, git push origin main,
# rm -rf node_modules/.next) are intentionally NOT matched here.
deny_patterns=(
  'rm[[:space:]]+-[a-zA-Z]*[rf][a-zA-Z]*[[:space:]]+(--no-preserve-root[[:space:]]+)*(/|~|/\*|\$HOME|\$\{HOME\})([[:space:]]|$)'  # rm -rf of / ~ /* $HOME
  'rm[[:space:]]+--no-preserve-root'                                   # explicit root nuke
  'git[[:space:]]+push[[:space:]].*(--force([[:space:]]|=|$)|[[:space:]]-f([[:space:]]|$))'  # force push (any branch)
  'git[[:space:]]+reset[[:space:]]+--hard'                             # destructive reset on a shared tree
  ':[[:space:]]*\(\)[[:space:]]*\{[^}]*\|[^}]*&[[:space:]]*\}'         # fork bomb :(){ :|:& };:
  'mkfs([.][[:alnum:]]+)?[[:space:]]'                                  # format a filesystem
  'dd[[:space:]]+.*of=/dev/(sd|nvme|vd|hd)'                            # raw write to a block device
  '>[[:space:]]*/dev/(sd|nvme|vd|hd)[a-z0-9]'                          # redirect over a block device
  'chmod[[:space:]]+-[a-zA-Z]*R[a-zA-Z]*[[:space:]]+0*777'            # recursive world-writable
  '(curl|wget)[[:space:]].*\|[[:space:]]*(sudo[[:space:]]+)?(ba|z|d)?sh' # pipe remote script straight into a shell
)
# ─────────────────────────────────────────────────────────────────────────────

for pat in "${deny_patterns[@]}"; do
  if printf '%s' "$cmd" | grep -Eq "$pat"; then
    jq -n --arg p "$pat" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: ("Blocked by validate-bash.sh — command matches a dangerous pattern (/" + $p + "/). If this is intentional, edit .claude/hooks/validate-bash.sh.")
      }
    }'
    exit 0
  fi
done

exit 0
