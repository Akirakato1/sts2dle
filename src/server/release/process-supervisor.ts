import { spawn, type ChildProcess } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

interface LaunchMessage {
  type: "launch";
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

interface TerminateMessage {
  type: "prepare-termination";
}

type SupervisorMessage = LaunchMessage | TerminateMessage;

function isDirectExecution(): boolean {
  const entryPoint = process.argv[1];
  if (typeof entryPoint !== "string") return false;
  try {
    const entry = realpathSync(resolve(entryPoint));
    const module = realpathSync(fileURLToPath(import.meta.url));
    return process.platform === "win32"
      ? entry.toLocaleLowerCase("en-US") === module.toLocaleLowerCase("en-US")
      : entry === module;
  } catch {
    return false;
  }
}

function runSupervisor(): void {
  let command: ChildProcess | undefined;
  let heldOpen: NodeJS.Timeout | undefined;
  let resultReported = false;

  const holdOpen = (): void => {
    heldOpen ??= setInterval(() => undefined, 60_000);
  };
  const reportResult = (succeeded: boolean): void => {
    if (resultReported) return;
    resultReported = true;
    holdOpen();
    process.send?.({ type: "result", succeeded });
  };
  const reportResultAfterOutput = (succeeded: boolean): void => {
    process.stdout.write("", () => process.stderr.write("", () => reportResult(succeeded)));
  };

  process.on("message", (untrusted: unknown) => {
    const message = parseMessage(untrusted);
    if (!message) {
      reportResult(false);
      return;
    }
    if (message.type === "prepare-termination") {
      holdOpen();
      process.send?.({ type: "termination-ready" });
      return;
    }
    if (command) {
      reportResult(false);
      return;
    }
    try {
      command = spawn(message.command, message.args, {
        cwd: message.cwd,
        env: message.env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      command.stdout?.pipe(process.stdout, { end: false });
      command.stderr?.pipe(process.stderr, { end: false });
      command.once("error", () => reportResultAfterOutput(false));
      command.once("close", (code, signal) => reportResultAfterOutput(code === 0 && signal === null));
    } catch {
      reportResult(false);
    }
  });
}

function parseMessage(value: unknown): SupervisorMessage | undefined {
  if (typeof value !== "object" || value === null || !("type" in value)) return undefined;
  if (value.type === "prepare-termination") return { type: "prepare-termination" };
  if (
    value.type !== "launch" ||
    !("command" in value) || typeof value.command !== "string" || value.command === "" ||
    !("args" in value) || !Array.isArray(value.args) || value.args.some((arg) => typeof arg !== "string") ||
    !("cwd" in value) || typeof value.cwd !== "string" || value.cwd === "" ||
    !("env" in value) || typeof value.env !== "object" || value.env === null
  ) return undefined;
  const env: NodeJS.ProcessEnv = {};
  for (const [key, entry] of Object.entries(value.env)) {
    if (typeof entry === "string") env[key] = entry;
  }
  return { type: "launch", command: value.command, args: [...value.args], cwd: value.cwd, env };
}

if (isDirectExecution()) runSupervisor();
