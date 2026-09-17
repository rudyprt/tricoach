/*
 * Service worker de TriCoach.
 *
 * Objectif : que le programme de la semaine reste lisible au bord du bassin ou
 * au départ d'une sortie, là où le réseau manque. Rien de plus — aucune
 * synchronisation en arrière-plan, aucune écriture hors ligne : une séance
 * validée sans réseau donnerait une fausse confirmation à l'athlète.
 */

const VERSION = "v1";
const COQUILLE = `tricoach-coquille-${VERSION}`;
/* Les fichiers de /assets portent un hachage dans leur nom : leur contenu ne
 * change jamais. Ce cache n'est donc pas versionné, sans quoi chaque
 * déploiement effacerait les fragments que les onglets ouverts référencent
 * encore. */
const ASSETS = "tricoach-assets";
const DONNEES = `tricoach-donnees-${VERSION}`;

/* Seules ces lectures sont conservées : ce qu'il faut pour afficher la semaine
 * et les allures. Jamais l'administration, jamais le chat. */
const LECTURES_HORS_LIGNE = ["/api/plans/current", "/api/profile", "/api/profile/zones", "/api/tests", "/api/auth/me"];

const COQUILLE_FICHIERS = ["/", "/manifest.webmanifest", "/favicon.svg", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  /* Pas de skipWaiting automatique : remplacer le code sous les pieds de
     quelqu'un en pleine saisie lui ferait perdre ce qu'il écrit. La nouvelle
     version attend, l'interface propose de recharger, et c'est le message
     ci-dessous qui déclenche la bascule. */
  event.waitUntil(caches.open(COQUILLE).then((cache) => cache.addAll(COQUILLE_FICHIERS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((noms) =>
        Promise.all(
          noms
            .filter((nom) => nom.startsWith("tricoach-") && nom !== COQUILLE && nom !== ASSETS && nom !== DONNEES)
            .map((nom) => caches.delete(nom))
        )
      )
      .then(() => self.clients.claim())
  );
});

/* Se déconnecter doit effacer les données mises en cache : sur un téléphone
 * partagé, elles resteraient lisibles par le suivant. */
self.addEventListener("message", (event) => {
  if (event.data === "purge-donnees") {
    event.waitUntil(caches.delete(DONNEES));
  }
  if (event.data === "activer-maintenant") {
    self.skipWaiting();
  }
});

function estLectureHorsLigne(url) {
  return LECTURES_HORS_LIGNE.some((chemin) => url.pathname === chemin);
}

async function reseauPuisCache(request, nomCache) {
  const cache = await caches.open(nomCache);
  try {
    const reponse = await fetch(request);
    if (reponse.ok) cache.put(request, reponse.clone());
    return reponse;
  } catch (erreur) {
    const enCache = await cache.match(request);
    if (enCache) {
      /* L'en-tête dit à l'interface que ces données datent : elle peut le
       * signaler plutôt que de laisser croire qu'elles sont à jour. */
      const entetes = new Headers(enCache.headers);
      entetes.set("X-TriCoach-Cache", "1");
      return new Response(await enCache.blob(), {
        status: enCache.status,
        statusText: enCache.statusText,
        headers: entetes,
      });
    }
    throw erreur;
  }
}

async function cachePuisReseau(request) {
  const cache = await caches.open(ASSETS);
  const enCache = await cache.match(request);
  if (enCache) return enCache;
  const reponse = await fetch(request);
  if (reponse.ok) cache.put(request, reponse.clone());
  return reponse;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  /* Navigation : l'application est une SPA, toute URL sert la même coquille.
   * Hors ligne, on la ressort du cache pour que le routeur prenne la main. */
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match("/")) ?? Response.error())
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cachePuisReseau(request));
    return;
  }

  if (estLectureHorsLigne(url)) {
    event.respondWith(reseauPuisCache(request, DONNEES));
    return;
  }

  if (COQUILLE_FICHIERS.includes(url.pathname)) {
    event.respondWith(cachePuisReseau(request));
  }
});

/* ------------------------------------------------------------------ */
/* Notifications poussées                                              */
/* ------------------------------------------------------------------ */

self.addEventListener("push", (event) => {
  let donnees = { titre: "TriCoach", corps: "", url: "/", tag: "tricoach" };
  try {
    if (event.data) donnees = { ...donnees, ...event.data.json() };
  } catch {
    /* Charge illisible : on affiche quand même quelque chose plutôt que rien,
       sinon le navigateur affiche sa propre notification générique. */
  }

  event.waitUntil(
    self.registration.showNotification(donnees.titre, {
      body: donnees.corps,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      /* Regroupe les rappels de même nature : deux relances « séances
         oubliées » remplacent l'ancienne au lieu de s'empiler. */
      tag: donnees.tag,
      data: { url: donnees.url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const cible = event.notification.data?.url ?? "/";

  event.waitUntil(
    (async () => {
      const fenetres = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      /* Réutiliser un onglet déjà ouvert plutôt que d'en empiler un nouveau à
         chaque notification. */
      for (const fenetre of fenetres) {
        if (new URL(fenetre.url).origin === self.location.origin) {
          await fenetre.focus();
          return fenetre.navigate ? fenetre.navigate(cible) : undefined;
        }
      }
      return self.clients.openWindow(cible);
    })()
  );
});
