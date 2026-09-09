import { z } from "zod";
import { env } from "./env.js";
import { prisma } from "./prisma.js";
import { HttpError } from "./http.js";

const STRAVA_AUTH_URL = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
const STRAVA_API = "https://www.strava.com/api/v3";

/** Marge avant expiration : on rafraîchit un peu en avance plutôt qu'au bord. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export function isStravaConfigured(): boolean {
  const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET } = env();
  return Boolean(STRAVA_CLIENT_ID && STRAVA_CLIENT_SECRET);
}

function requireConfig() {
  if (!isStravaConfigured()) {
    throw new HttpError(
      503,
      "La connexion Strava n'est pas configurée. Renseignez STRAVA_CLIENT_ID et STRAVA_CLIENT_SECRET."
    );
  }
  return env();
}

export function redirectUri(): string {
  return `${env().APP_URL.replace(/\/$/, "")}/strava/retour`;
}

/**
 * URL d'autorisation. `state` porte un jeton anti-CSRF : sans lui, un tiers
 * pourrait faire relier son propre compte Strava à la session d'un athlète.
 */
export function authorizationUrl(state: string): string {
  const config = requireConfig();
  const params = new URLSearchParams({
    client_id: config.STRAVA_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    approval_prompt: "auto",
    // activity:read_all inclut les activités privées ; l'athlète les a
    // enregistrées pour lui, son coach doit pouvoir en tenir compte.
    scope: "read,activity:read_all",
    state,
  });
  return `${STRAVA_AUTH_URL}?${params}`;
}

const tokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_at: z.number(),
  athlete: z
    .object({
      id: z.number(),
      firstname: z.string().nullable().optional(),
      lastname: z.string().nullable().optional(),
    })
    .optional(),
});

export type StravaTokens = z.infer<typeof tokenSchema>;

async function postToken(body: Record<string, string>): Promise<StravaTokens> {
  const config = requireConfig();
  const response = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.STRAVA_CLIENT_ID,
      client_secret: config.STRAVA_CLIENT_SECRET,
      ...body,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new HttpError(502, `Strava a refusé la demande (${response.status}). ${detail.slice(0, 200)}`);
  }

  const parsed = tokenSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new HttpError(502, "Réponse inattendue de Strava.");
  }
  return parsed.data;
}

export function exchangeCode(code: string): Promise<StravaTokens> {
  return postToken({ code, grant_type: "authorization_code" });
}

/**
 * Renvoie un jeton d'accès valide, en le rafraîchissant si nécessaire. Les
 * jetons Strava expirent au bout de six heures : sans rafraîchissement, un
 * import échouerait dès le lendemain.
 */
export async function validAccessToken(userId: string): Promise<string> {
  const account = await prisma.stravaAccount.findUnique({ where: { userId } });
  if (!account) {
    throw new HttpError(400, "Aucun compte Strava relié.");
  }

  if (account.expiresAt.getTime() - REFRESH_MARGIN_MS > Date.now()) {
    return account.accessToken;
  }

  const refreshed = await postToken({
    grant_type: "refresh_token",
    refresh_token: account.refreshToken,
  });

  await prisma.stravaAccount.update({
    where: { userId },
    data: {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      expiresAt: new Date(refreshed.expires_at * 1000),
    },
  });
  return refreshed.access_token;
}

const activitySchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.string(),
  sport_type: z.string().optional(),
  start_date: z.string(),
  elapsed_time: z.number(),
  moving_time: z.number().optional(),
  distance: z.number().optional(),
  total_elevation_gain: z.number().optional(),
  average_heartrate: z.number().optional(),
  max_heartrate: z.number().optional(),
  average_watts: z.number().optional(),
});

export type StravaActivity = z.infer<typeof activitySchema>;

/** Correspondance des types Strava vers les disciplines de l'application. */
export function toSport(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("swim")) return "natation";
  if (t.includes("ride") || t.includes("cycl") || t.includes("bike")) return "velo";
  if (t.includes("run") || t.includes("walk") || t.includes("hike")) return "course";
  if (t.includes("weight") || t.includes("workout") || t.includes("crossfit")) return "renfo";
  return "autre";
}

export async function fetchActivities(userId: string, since: Date): Promise<StravaActivity[]> {
  const token = await validAccessToken(userId);
  const params = new URLSearchParams({
    after: String(Math.floor(since.getTime() / 1000)),
    per_page: "100",
  });

  const response = await fetch(`${STRAVA_API}/athlete/activities?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 429) {
    throw new HttpError(429, "Strava limite temporairement les requêtes. Réessayez dans quelques minutes.");
  }
  if (!response.ok) {
    throw new HttpError(502, `Strava a refusé la lecture des activités (${response.status}).`);
  }

  const brut = await response.json();
  if (!Array.isArray(brut)) return [];

  // Une activité au format inattendu est ignorée plutôt que de faire échouer
  // tout l'import.
  return brut.flatMap((item) => {
    const parsed = activitySchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export interface NormalizedActivity {
  externalId: string;
  sport: string;
  name: string;
  startedAt: Date;
  dureeMin: number;
  distanceKm: number | null;
  denivelePosM: number | null;
  fcMoyenne: number | null;
  fcMax: number | null;
  puissanceMoy: number | null;
  allureSecParKm: number | null;
}

export function normalize(activity: StravaActivity): NormalizedActivity {
  // Le temps en mouvement reflète mieux l'effort que le temps écoulé, qui
  // inclut les arrêts.
  const seconds = activity.moving_time ?? activity.elapsed_time;
  const distanceKm = activity.distance ? activity.distance / 1000 : null;

  return {
    externalId: String(activity.id),
    sport: toSport(activity.sport_type ?? activity.type),
    name: activity.name,
    startedAt: new Date(activity.start_date),
    dureeMin: Math.max(1, Math.round(seconds / 60)),
    distanceKm: distanceKm ? Math.round(distanceKm * 100) / 100 : null,
    denivelePosM: activity.total_elevation_gain ? Math.round(activity.total_elevation_gain) : null,
    fcMoyenne: activity.average_heartrate ? Math.round(activity.average_heartrate) : null,
    fcMax: activity.max_heartrate ? Math.round(activity.max_heartrate) : null,
    puissanceMoy: activity.average_watts ? Math.round(activity.average_watts) : null,
    allureSecParKm: distanceKm && distanceKm > 0.1 ? Math.round(seconds / distanceKm) : null,
  };
}
