import { appendFile, rm, writeFile } from "node:fs/promises";

const logPath = process.env.PANDO_FAKE_SUPABASE_LOG;
const markerPath = process.env.PANDO_FAKE_SUPABASE_MARKER;
const readyPath = process.env.PANDO_FAKE_SUPABASE_READY;
if (!logPath || !markerPath || !readyPath) throw new Error("Missing fake Supabase fixture paths");

const rawArguments = process.argv.slice(2);
const workdirIndex = rawArguments.indexOf("--workdir");
const command = rawArguments.slice(workdirIndex + 2);
await appendFile(logPath, `${JSON.stringify(command)}\n`);

if (command[0] === "db" && command[1] === "start") {
  await writeFile(markerPath, "simulated container and volume");
  await writeFile(readyPath, "ready");
  const keepAlive = setInterval(() => {}, 1_000);
  await new Promise((resolveSignal) => {
    const finish = (exitCode) => {
      clearInterval(keepAlive);
      process.exitCode = exitCode;
      resolveSignal();
    };
    process.once("SIGINT", () => finish(130));
    process.once("SIGTERM", () => finish(143));
  });
} else if (command[0] === "stop") {
  await rm(markerPath, { force: true });
}
