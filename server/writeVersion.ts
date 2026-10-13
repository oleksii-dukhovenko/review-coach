// Writes version.json at image build time, while the .git folder is still there.
import fs from "node:fs";
import path from "node:path";

import { buildInfoFromGit } from "./selfUpdate.ts";

const root = path.join(import.meta.dirname, "..");
const info = await buildInfoFromGit(root);
fs.writeFileSync(path.join(root, "version.json"), JSON.stringify(info));
console.log(`Version ${info.sha ? info.sha.slice(0, 7) : "unknown"} on ${info.branch || "no branch"} of ${info.repo || "no GitHub repo"}`);
