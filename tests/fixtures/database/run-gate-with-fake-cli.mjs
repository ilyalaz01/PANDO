import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runDatabaseGateCli } from "../../../scripts/database/verify-database-core.mjs";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const supabaseCli = fileURLToPath(new URL("./fake-supabase-cli.mjs", import.meta.url));

process.on("message", (message) => {
  if (message?.signal !== "SIGINT" && message?.signal !== "SIGTERM") return;
  process.emit(message.signal);
  if (process.connected) process.disconnect();
});

try {
  process.exitCode = await runDatabaseGateCli({
    root,
    supabaseCli,
    terminateGraceMilliseconds: 250,
  });
} finally {
  if (process.connected) process.disconnect();
}
