import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { authRouter } from "./routes/auth.js";
import { profileRouter } from "./routes/profile.js";
import { plansRouter } from "./routes/plans.js";
import { sessionsRouter } from "./routes/sessions.js";
import { chatRouter } from "./routes/chat.js";
import { insightsRouter } from "./routes/insights.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

app.use("/api/auth", authRouter);
app.use("/api/profile", profileRouter);
app.use("/api/plans", plansRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/chat", chatRouter);
app.use("/api/insights", insightsRouter);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// En production, ce même serveur sert aussi le frontend compilé (même origine :
// pas de souci CORS ni de cookies cross-domain).
const clientDist = path.join(__dirname, "../../client/dist");
app.use(express.static(clientDist));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) {
    next();
    return;
  }
  res.sendFile(path.join(clientDist, "index.html"), (err) => {
    if (err) next();
  });
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`Serveur API démarré sur http://localhost:${port}`);
});
