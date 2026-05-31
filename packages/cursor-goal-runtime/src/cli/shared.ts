export function operatorOptionsFromArgv(
  args: string[],
): { conversation_id?: string } | undefined {
  const i = args.indexOf("--conversation");
  if (i >= 0 && args[i + 1]) return { conversation_id: args[i + 1] };
  const env = process.env.CURSOR_CONVERSATION_ID;
  if (typeof env === "string" && env.trim()) return { conversation_id: env.trim() };
  return undefined;
}

export function printUsage(): void {
  console.log(`cursor-goal — governance runtime for cursor-goal

Usage:
  cursor-goal init [--interactive] [--force] [--detect] [--compile]
  cursor-goal compile [--watch]
  cursor-goal verify
  cursor-goal explain [--json] [--conversation <id>]
  cursor-goal next [--json|--verbose] [--conversation <id>]
  cursor-goal goal lint
  cursor-goal dispatch [--verify] [--spawn] [--unit <id>] [--record-response <id> --from <file>] [--dry-run|--run]
  cursor-goal logs [N]
  cursor-goal upgrade
  cursor-goal doctor [--json|--fix]
  cursor-goal pause|resume
  cursor-goal mode [chat|governed|auto|set auto|chat|governed|why]
  cursor-goal mode why [--conversation <id>]
  cursor-goal phase advance IMPLEMENT
  cursor-goal discovery complete [notes]
  cursor-goal units list
  cursor-goal units done <id>
  cursor-goal status
  cursor-goal status --json [--conversation <id>]
`);
}
