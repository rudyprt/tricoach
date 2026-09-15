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
import { calendarRouter } from "./routes/calendar.js";
import { adminRouter } from "./routes/admin.js";
import { privacyRouter } from "./routes/privacy.js";
import { stravaRouter } from "./routes/strava.js";
import { activitiesRouter } from "./routes/activities.js";
import { testsRouter } from "./routes/tests.js";
import { errorHandler, notFoundHandler } from "./lib/http.js";
import { env } from "./lib/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Fabrique l'application Express sans l'écouter : `index.ts` la démarre, les
 * tests d'intégration la montent directement.
 */
export function createApp() {
  const app = express();

  // Render (comme la plupart des hébergeurs) place un proxy devant l'application :
  // sans cela, req.ip vaut l'adresse du proxy et le rate limiting devient global.
  app.set("trust proxy", 1);

  app.use(cors({ origin: env().CLIENT_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.use("/api/auth", authRouter);
  app.use("/api/profile", profileRouter);
  app.use("/api/plans", plansRouter);
  app.use("/api/sessions", sessionsRouter);
  app.use("/api/chat", chatRouter);
  app.use("/api/insights", insightsRouter);
  app.use("/api/calendar", calendarRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/privacy", privacyRouter);
  app.use("/api/strava", stravaRouter);
  app.use("/api/activities", activitiesRouter);
  app.use("/api/tests", testsRouter);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // En production, ce même serveur sert aussi le frontend compilé (même origine :
  // pas de souci CORS ni de cookies cross-domain).
  const clientDist = path.join(__dirname, "../../client/dist");
  app.use(
    express.static(clientDist, {
      setHeaders(res, filePath) {
        // Les fichiers de /assets portent un hachage : leur contenu ne change
        // jamais, ils peuvent être gardés un an.
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          return;
        }
        // Le service worker, lui, doit être revalidé à chaque visite : un
        // exemplaire figé en cache empêcherait toute mise à jour de
        // l'application installée.
        if (filePath.endsWith("sw.js") || filePath.endsWith("manifest.webmanifest")) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    })
  );
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, "index.html"), (err) => {
      if (err) next();
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
