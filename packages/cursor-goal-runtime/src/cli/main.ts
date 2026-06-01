import {
  handleCompile,
  handleDiscovery,
  handleGoal,
  handleInit,
  handlePhase,
  handleUnits,
} from "./goal.js";
import {
  handleDispatch,
  handleDoctor,
  handleExplain,
  handleIncidents,
  handleLogs,
  handleNext,
  handlePause,
  handleResume,
  handleRun,
  handleSessionEnd,
  handleStatus,
  handleUpgrade,
  handleVerify,
} from "./operator.js";
import { handleMode } from "./mode.js";
import { printUsage } from "./shared.js";

export { operatorOptionsFromArgv } from "./shared.js";

export async function runCli(argv: string[]): Promise<void> {
  const [, , cmd, ...rest] = argv;
  switch (cmd) {
    case "init":
      await handleInit(rest);
      break;
    case "compile":
      await handleCompile(rest);
      break;
    case "verify":
      await handleVerify(rest);
      break;
    case "run":
      await handleRun(rest);
      break;
    case "check":
      await handleRun(rest, "cursor-goal check");
      break;
    case "next":
      await handleNext(rest);
      break;
    case "dispatch":
      await handleDispatch(rest);
      break;
    case "logs":
      await handleLogs(rest);
      break;
    case "upgrade":
      await handleUpgrade(rest);
      break;
    case "explain":
      await handleExplain(rest);
      break;
    case "session-end":
      await handleSessionEnd(rest);
      break;
    case "incidents":
      await handleIncidents(rest);
      break;
    case "goal":
      await handleGoal(rest);
      break;
    case "doctor":
      await handleDoctor(rest);
      break;
    case "pause":
      await handlePause(rest);
      break;
    case "resume":
      await handleResume(rest);
      break;
    case "phase":
      await handlePhase(rest);
      break;
    case "discovery":
      await handleDiscovery(rest);
      break;
    case "units":
      await handleUnits(rest);
      break;
    case "status":
      await handleStatus(rest);
      break;
    case "mode":
      await handleMode(rest);
      break;
    default:
      if (cmd && cmd !== "--help" && cmd !== "-h" && cmd !== "help") {
        console.error(`Unknown command: ${cmd}`);
        printUsage();
        process.exit(1);
      }
      printUsage();
  }
}
