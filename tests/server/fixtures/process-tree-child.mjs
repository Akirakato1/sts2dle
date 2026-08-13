import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

const [mode, pidFile] = process.argv.slice(2);
const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  shell: false,
  stdio: ["ignore", "inherit", "inherit"],
  windowsHide: true,
});
if (!Number.isInteger(grandchild.pid) || grandchild.pid <= 0) throw new Error("Missing grandchild PID");
await writeFile(pidFile, String(grandchild.pid));
if (mode === "overflow") {
  while (true) process.stdout.write("x".repeat(4096));
}
setInterval(() => {}, 1000);
