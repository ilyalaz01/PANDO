import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runDatabaseGateCli } from "./verify-database-core.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
process.exitCode = await runDatabaseGateCli({ root });
