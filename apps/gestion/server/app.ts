import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { connexion, deconnexion } from "./auth.js";
import { api } from "./routes.js";
import { isProduction } from "./env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          // Recharts écrit ses dimensions dans des attributs style.
          "style-src": ["'self'", "'unsafe-inline'"],
          "img-src": ["'self'", "data:"],
          "connect-src": ["'self'"],
          "object-src": ["'none'"],
          "base-uri": ["'self'"],
          "form-action": ["'self'"],
          "frame-ancestors": ["'none'"],
        },
      },
      hsts: isProduction() ? { maxAge: 63072000, includeSubDomains: true } : false,
    })
  );
  // Rien ici n'a à être indexé ni mis en cache par un intermédiaire.
  app.use((_req, res, next) => {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    next();
  });
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  app.get("/api/sante", (_req, res) => {
    res.json({ ok: true });
  });
  app.post("/api/connexion", (req, res, next) => {
    connexion(req, res).catch(next);
  });
  app.post("/api/deconnexion", deconnexion);
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api", api);
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Introuvable." });
  });

  const web = path.join(__dirname, "../web");
  app.use(express.static(web, { index: false }));
  app.get("*", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(web, "index.html"), (err) => {
      if (err) next();
    });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur." });
  });

  return app;
}
