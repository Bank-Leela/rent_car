#!/usr/bin/env bash
# PreToolUse(Bash) hook: block pipe-to-shell and equivalent remote-code execution.
#
# Catches:
#   curl|wget|fetch ... | [sudo] [env ...] sh|bash|zsh|dash|ksh   (incl. chained pipes)
#   sh|bash <(curl|wget|fetch ...)                                 (process substitution)
#   eval "$(curl ...)" / eval `wget ...`                           (eval of a download)
#
# Does NOT block downloads to a file (curl -o, wget -O) — only execution of fetched code.
# Blocks by emitting a PreToolUse "deny" decision. Never blocks on parse failure (fail-open
# for availability; the deny rules in settings.local.json remain the hard floor).

set -uo pipefail

input="$(cat)"

# Extract .tool_input.command robustly. python3 is a project dependency.
cmd="$(printf '%s' "$input" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get("tool_input", {}).get("command", "") or "")
except Exception:
    print("")
' 2>/dev/null || true)"

[ -z "$cmd" ] && exit 0

deny() {
  # Emit PreToolUse deny decision with a JSON-escaped reason, then exit 0.
  reason="$1"
  esc="$(printf '%s' "$reason" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')"
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' "$esc"
  exit 0
}

# 1) downloader piped into a shell interpreter (allow optional sudo/env, any chained pipes between)
if printf '%s' "$cmd" | grep -Eiq '\b(curl|wget|fetch)\b.*\|[[:space:]]*(sudo[[:space:]]+)?(env[[:space:]]+[^|]*)?\b(bash|zsh|dash|ksh|sh)\b'; then
  deny "Blocked pipe-to-shell: piping a network download into a shell executes unreviewed remote code. Download to a file (curl -o / wget -O), inspect it, then run it."
fi

# 2) shell run on a process substitution of a downloader: bash <(curl ...)
if printf '%s' "$cmd" | grep -Eiq '\b(bash|zsh|dash|ksh|sh)\b[^<]*<\([[:space:]]*(curl|wget|fetch)\b'; then
  deny "Blocked shell-from-process-substitution: bash <(curl ...) executes unreviewed remote code. Save the script, inspect it, then run it."
fi

# 3) eval of a command substitution containing a downloader
if printf '%s' "$cmd" | grep -Eiq '\beval\b[^|;&]*(\$\(|`)[[:space:]]*(sudo[[:space:]]+)?(curl|wget|fetch)\b'; then
  deny "Blocked eval-of-download: eval on a network download executes unreviewed remote code."
fi

exit 0
