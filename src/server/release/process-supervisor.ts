import { spawn, type ChildProcess } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, isAbsolute, resolve } from "node:path";

interface LaunchMessage {
  type: "launch";
  token: string;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

interface TerminateMessage {
  type: "prepare-termination" | "terminate-self";
  token: string;
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
  let token: string | undefined;
  let selfTerminationStarted = false;

  const holdOpen = (): void => {
    heldOpen ??= setInterval(() => undefined, 60_000);
  };
  const reportResult = (code: number | null, signal: NodeJS.Signals | null): void => {
    if (resultReported) return;
    resultReported = true;
    holdOpen();
    process.send?.({
      type: "result",
      token,
      code,
      signal,
    });
  };
  const reportResultAfterOutput = (code: number | null, signal: NodeJS.Signals | null): void => {
    process.stdout.write("", () => process.stderr.write("", () => reportResult(code, signal)));
  };

  process.on("message", (untrusted: unknown) => {
    const message = parseMessage(untrusted);
    if (!message) {
      reportResult(1, null);
      return;
    }
    if (message.type === "prepare-termination" || message.type === "terminate-self") {
      if (!token || message.token !== token) {
        reportResult(1, null);
        return;
      }
      holdOpen();
      if (message.type === "prepare-termination") {
        process.send?.({ type: "termination-ready", token });
      } else {
        beginSelfTermination();
      }
      return;
    }
    if (message.type !== "launch") return;
    token = message.token;
    if (command) {
      reportResult(1, null);
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
      command.once("error", () => reportResultAfterOutput(1, null));
      command.once("close", (code, signal) => reportResultAfterOutput(code, signal));
    } catch {
      reportResult(1, null);
    }
  });

  process.once("disconnect", () => beginSelfTermination());

  const beginSelfTermination = (): void => {
    if (selfTerminationStarted) return;
    selfTerminationStarted = true;
    holdOpen();
    try {
      const windowsRoot = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
      if (!isAbsolute(windowsRoot)) throw new Error();
      const taskkillPath = realpathSync(resolve(windowsRoot, "System32", "taskkill.exe"));
      if (basename(taskkillPath).toLocaleLowerCase("en-US") !== "taskkill.exe" || !lstatSync(taskkillPath).isFile()) {
        throw new Error();
      }
      const taskkill = spawn(taskkillPath, [
        "/PID", String(process.pid), "/T", "/F",
      ], { shell: false, stdio: "ignore", windowsHide: true });
      taskkill.once("error", fallbackExit);
    } catch {
      fallbackExit();
    }
    setTimeout(fallbackExit, 1_000);
  };

  function fallbackExit(): void {
    command?.kill("SIGKILL");
    setTimeout(() => process.exit(1), 50);
  }
}

function parseMessage(value: unknown): SupervisorMessage | undefined {
  if (typeof value !== "object" || value === null || !("type" in value)) return undefined;
  if (value.type === "prepare-termination" || value.type === "terminate-self") {
    if (!("token" in value) || typeof value.token !== "string" || value.token === "") return undefined;
    return { type: value.type, token: value.token };
  }
  if (
    value.type !== "launch" ||
    !("token" in value) || typeof value.token !== "string" || value.token === "" ||
    !("command" in value) || typeof value.command !== "string" || value.command === "" ||
    !("args" in value) || !Array.isArray(value.args) || value.args.some((arg) => typeof arg !== "string") ||
    !("cwd" in value) || typeof value.cwd !== "string" || value.cwd === "" ||
    !("env" in value) || typeof value.env !== "object" || value.env === null
  ) return undefined;
  const env: NodeJS.ProcessEnv = {};
  for (const [key, entry] of Object.entries(value.env)) {
    if (typeof entry === "string") env[key] = entry;
  }
  return { type: "launch", token: value.token, command: value.command, args: [...value.args], cwd: value.cwd, env };
}

if (isDirectExecution()) runSupervisor();
