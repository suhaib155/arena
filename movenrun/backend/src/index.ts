import express from "express";
import { getConfig } from "./config.js";
import gpsRouter from "./routes/gps.js";
import zonesRouter from "./routes/zones.js";
import battlesRouter from "./routes/battles.js";
import usersRouter from "./routes/users.js";

const app = express();
const config = getConfig();

app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => res.json({ status: "ok", ts: Date.now() }));

app.use("/gps", gpsRouter);
app.use("/zones", zonesRouter);
app.use("/battles", battlesRouter);
app.use("/users", usersRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(config.PORT, () => {
  console.log(`MovenRun API running on port ${config.PORT} (${config.NODE_ENV})`);
});

export default app;
