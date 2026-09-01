import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const port = process.argv[2];

if (!port) {
  throw new Error("The E2E server requires a port argument.");
}

const stopFile = resolve(".next/e2e-stop");
const nextCli = resolve("node_modules/next/dist/bin/next");

rmSync(stopFile, { force: true });

const server = spawn(
  process.execPath,
  [nextCli, "start", "--hostname", "127.0.0.1", "--port", port],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      PANDO_ENABLE_EXPLORE_FIXTURE: "true",
      PANDO_ENABLE_FOCUS_FIXTURE: "true",
      PANDO_ENABLE_PLAN_FIXTURE: "true",
      PANDO_ENABLE_REVIEW_FIXTURE: "true",
    },
  },
);

let stopping = false;

function stopServer() {
  if (stopping) {
    return;
  }

  stopping = true;
  clearInterval(stopWatcher);

  if (server.exitCode === null) {
    server.kill("SIGTERM");
  }
}

const stopWatcher = setInterval(() => {
  if (existsSync(stopFile)) {
    stopServer();
  }
}, 100);

process.once("SIGINT", stopServer);
process.once("SIGTERM", stopServer);

server.once("exit", (code) => {
  clearInterval(stopWatcher);
  rmSync(stopFile, { force: true });
  process.exitCode = code ?? 0;
});
