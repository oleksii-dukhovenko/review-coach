import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import path from "node:path";

import { config } from "./config.ts";
import { resetUnfinishedJobs } from "./db.ts";
import { startInboxWatcher } from "./inbox.ts";
import { buildRoutes } from "./routes.ts";

const webRoot = path.relative(process.cwd(), config.webDistDir);

const app = new Hono();
app.route("/api", buildRoutes());
app.use("/*", serveStatic({ root: webRoot }));
app.get("/*", serveStatic({ path: path.join(webRoot, "index.html") }));

resetUnfinishedJobs();
startInboxWatcher(config.pollMinutes);

serve({ fetch: app.fetch, hostname: "127.0.0.1", port: config.port }, (info) => {
  console.log(`Review Coach on http://127.0.0.1:${info.port}`);
});
