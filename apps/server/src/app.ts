import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
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
import { pausesRouter } from "./routes/pauses.js";
import { racesRouter } from "./routes/races.js";
import { pushRouter } from "./routes/push.js";
import { partageRouter } from "./routes/partage.js";
import { errorHandler, notFoundHandler } from "./lib/http.js";
import { env, isProduction } from "./lib/env.js";

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

  /*
   * En-têtes de sécurité.
   *
   * Il n'y en avait aucun : la page pouvait être encadrée par un site tiers
   * pour piéger les clics, le navigateur devinait le type des fichiers servis,
   * et rien n'empêchait l'exécution d'un script injecté.
   *
   * La politique de contenu peut être stricte parce que l'application ne charge
   * rien d'extérieur : ni police, ni script, ni image d'un autre domaine. Seule
   * exception, les styles en ligne, que React écrit dans les attributs `style`
   * pour les marges des zones de sécurité.
   */
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          // `data:` pour l'aperçu d'une photo de profil avant son envoi.
          "img-src": ["'self'", "data:"],
          "font-src": ["'self'"],
          "connect-src": ["'self'"],
          "manifest-src": ["'self'"],
          "worker-src": ["'self'"],
          "object-src": ["'none'"],
          "base-uri": ["'self'"],
          "form-action": ["'self'"],
          "frame-ancestors": ["'none'"],
          ...(isProduction() ? { "upgrade-insecure-requests": [] } : {}),
        },
      },
      // L'isolation d'origine n'apporte rien ici et casse le chargement des
      // ressources servies par le même serveur sur certains navigateurs.
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      hsts: isProduction() ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
    })
  );

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
  app.use("/api/pauses", pausesRouter);
  app.use("/api/races", racesRouter);
  app.use("/api/push", pushRouter);
  app.use("/api/partage", partageRouter);

  /*
   * La version déployée, lisible sans outil ni connexion.
   *
   * Trois jours ont été perdus à chercher dans le code un défaut déjà corrigé,
   * faute de pouvoir répondre à « le serveur tourne-t-il sur le dernier
   * commit ? ». Render expose le commit construit ; le dire ici rend la
   * question vérifiable en une seconde.
   */
  app.get("/api/health", (_req, res) => {
    const commit = process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? null;
    res.json({ ok: true, version: commit ? commit.slice(0, 7) : "dev" });
  });

  // En production, ce même serveur sert aussi le frontend compilé (même origine :
  // pas de souci CORS ni de cookies cross-domain).
  const clientDist = path.join(__dirname, "../../client/dist");
  app.use(
    express.static(clientDist, {
      // /conditions sert conditions.html : les pages légales sont du HTML
      // statique, lisible sans JavaScript, et non des routes de l'application.
      extensions: ["html"],
      setHeaders(res, filePath) {
        // Les fichiers de /assets portent un hachage : leur contenu ne change
        // jamais, ils peuvent être gardés un an.
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          return;
        }
        // Le service worker, lui, doit être revalidé à chaque visite : un
        // exemplaire figé en cache empêcherait toute mise à jour de
        // l'application installée. Idem pour les pages HTML, dont les pages
        // légales : une version périmée serait une version opposable.
        if (
          filePath.endsWith("sw.js") ||
          filePath.endsWith("manifest.webmanifest") ||
          filePath.endsWith(".html")
        ) {
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
    // La coquille ne doit jamais être servie depuis un cache intermédiaire :
    // elle seule désigne les fragments du déploiement courant.
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(clientDist, "index.html"), (err) => {
      if (err) next();
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
