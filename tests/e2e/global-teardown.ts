import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export default async function stopE2EServer() {
  await writeFile(resolve(".next/e2e-stop"), "stop", "utf8");
}
