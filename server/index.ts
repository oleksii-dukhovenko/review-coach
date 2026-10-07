import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import path from "node:path";

import { config } from "./config.ts";
import { resetUnfinishedJobs } from "./db.ts";
import { startInboxWatcher } from "./inbox.ts";
import { stopAllServers } from "./languageServers.ts";
import { buildRoutes } from "./routes.ts";

const webRoot = path.relative(process.cwd(), config.webDistDir);

const app = new Hono();
app.route("/api", buildRoutes());
app.use("/*", serveStatic({ root: webRoot }));
app.get("/*", serveStatic({ path: path.join(webRoot, "index.html") }));

function shutDown(): void {
  stopAllServers();
  process.exit(0);
}

process.on("SIGTERM", shutDown);
process.on("SIGINT", shutDown);

resetUnfinishedJobs();
startInboxWatcher(config.pollMinutes);

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`Review Coach on http://${config.host}:${info.port}`);
});
