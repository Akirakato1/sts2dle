import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";

const [mode, pidFile] = process.argv.slice(2);
const grandchildScript = mode.includes("overflow")
  ? "process.send?.('ready'); process.disconnect?.(); while (true) process.stdout.write('x'.repeat(4096))"
  : "process.send?.('ready'); process.disconnect?.(); setInterval(() => {}, 1000)";
const grandchild = spawn(process.execPath, ["-e", grandchildScript], {
  shell: false,
  stdio: ["ignore", "inherit", "inherit", "ipc"],
  windowsHide: true,
});
if (!Number.isInteger(grandchild.pid) || grandchild.pid <= 0) throw new Error("Missing grandchild PID");
await once(grandchild, "message");
await writeFile(pidFile, String(grandchild.pid));
await writeFile(`${pidFile}.supervisor`, String(process.ppid));
if (mode === "overflow") {
  while (true) process.stdout.write("x".repeat(4096));
}
if (mode === "parent-exit-overflow") process.stdout.write("x".repeat(4096));
if (mode.startsWith("parent-exit-")) {
  grandchild.unref();
} else {
  setInterval(() => {}, 1000);
}
