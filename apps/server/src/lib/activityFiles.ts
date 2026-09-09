import { Decoder, Stream } from "@garmin/fitsdk";
import { XMLParser } from "fast-xml-parser";
import { HttpError } from "./http.js";
import { toSport, type NormalizedActivity } from "./strava.js";

export type ActivityFileFormat = "fit" | "gpx" | "tcx";

/** Un fichier de séance dépasse rarement 2 Mo, même sur une sortie longue. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

export function formatFromFilename(filename: string): ActivityFileFormat | null {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "fit" || ext === "gpx" || ext === "tcx") return ext;
  return null;
}

/** Point de trace : le dénominateur commun des trois formats. */
interface TrackPoint {
  time: Date | null;
  distanceM: number | null;
  altitudeM: number | null;
  heartRate: number | null;
  power: number | null;
}

interface ParsedFile {
  sport: string;
  name: string | null;
  startedAt: Date;
  durationS: number;
  distanceM: number | null;
  points: TrackPoint[];
}

function toNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function moyenne(valeurs: (number | null)[]): number | null {
  const utiles = valeurs.filter((v): v is number => v !== null && v > 0);
  if (utiles.length === 0) return null;
  return Math.round(utiles.reduce((sum, v) => sum + v, 0) / utiles.length);
}

function maximum(valeurs: (number | null)[]): number | null {
  const utiles = valeurs.filter((v): v is number => v !== null && v > 0);
  return utiles.length === 0 ? null : Math.round(Math.max(...utiles));
}

/**
 * Dénivelé positif cumulé. Les variations inférieures à 2 m sont ignorées :
 * le bruit d'un altimètre barométrique gonflerait sinon le total de plusieurs
 * centaines de mètres sur une sortie plate.
 */
function denivelePositif(points: TrackPoint[]): number | null {
  const altitudes = points.map((p) => p.altitudeM).filter((a): a is number => a !== null);
  if (altitudes.length < 2) return null;

  let cumul = 0;
  let reference = altitudes[0];
  for (const altitude of altitudes.slice(1)) {
    const ecart = altitude - reference;
    if (ecart > 2) {
      cumul += ecart;
      reference = altitude;
    } else if (ecart < -2) {
      reference = altitude;
    }
  }
  return Math.round(cumul);
}

/* ------------------------------------------------------------------ */
/* FIT — format binaire des montres Garmin, Wahoo, Coros...            */
/* ------------------------------------------------------------------ */

function parseFit(buffer: Buffer): ParsedFile {
  const stream = Stream.fromBuffer(buffer);
  const decoder = new Decoder(stream);
  if (!decoder.isFIT() || !decoder.checkIntegrity()) {
    throw new HttpError(400, "Ce fichier .fit est illisible ou incomplet.");
  }

  const { messages, errors } = decoder.read();
  if (errors.length > 0 && !messages.sessionMesgs?.length && !messages.recordMesgs?.length) {
    throw new HttpError(400, "Ce fichier .fit n'a pas pu être décodé.");
  }

  const session = messages.sessionMesgs?.[0] ?? {};
  const records: Record<string, unknown>[] = messages.recordMesgs ?? [];

  const points: TrackPoint[] = records.map((r) => ({
    time: toDate(r.timestamp),
    distanceM: toNumber(r.distance),
    altitudeM: toNumber(r.enhancedAltitude ?? r.altitude),
    heartRate: toNumber(r.heartRate),
    power: toNumber(r.power),
  }));

  const startedAt = toDate(session.startTime) ?? points.find((p) => p.time)?.time;
  if (!startedAt) {
    throw new HttpError(400, "Ce fichier .fit ne contient pas de date de début.");
  }

  // Le temps en mouvement reflète mieux l'effort que le temps écoulé.
  const durationS =
    toNumber(session.totalTimerTime) ??
    toNumber(session.totalElapsedTime) ??
    (points.length > 1 && points[points.length - 1].time && points[0].time
      ? (points[points.length - 1].time!.getTime() - points[0].time!.getTime()) / 1000
      : 0);

  return {
    sport: toSport(String(session.sport ?? "")),
    name: typeof session.sportProfileName === "string" ? session.sportProfileName : null,
    startedAt,
    durationS,
    distanceM: toNumber(session.totalDistance) ?? points[points.length - 1]?.distanceM ?? null,
    points,
  };
}

/* ------------------------------------------------------------------ */
/* GPX et TCX — formats XML                                            */
/* ------------------------------------------------------------------ */

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  // Un enregistrement isolé doit rester un tableau, sinon un fichier d'un seul
  // point se parcourt différemment de tous les autres.
  isArray: (name) => ["trkpt", "trkseg", "trk", "Trackpoint", "Track", "Lap", "Activity"].includes(name),
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function parseGpx(contenu: string): ParsedFile {
  const doc = xml.parse(contenu) as Record<string, any>;
  const gpx = doc.gpx;
  if (!gpx) throw new HttpError(400, "Ce fichier .gpx est invalide.");

  const traces = asArray(gpx.trk);
  const points: TrackPoint[] = [];
  let sportBrut = "";
  let nom: string | null = null;

  for (const trace of traces) {
    if (typeof trace?.name === "string" && !nom) nom = trace.name;
    if (typeof trace?.type === "string" && !sportBrut) sportBrut = trace.type;
    for (const segment of asArray(trace?.trkseg)) {
      for (const pt of asArray(segment?.trkpt)) {
        points.push({
          time: toDate(pt?.time),
          distanceM: null,
          altitudeM: toNumber(pt?.ele),
          // Les cardiofréquencemètres écrivent la FC dans une extension.
          heartRate: toNumber(
            pt?.extensions?.["gpxtpx:TrackPointExtension"]?.["gpxtpx:hr"] ??
              pt?.extensions?.TrackPointExtension?.hr
          ),
          power: toNumber(pt?.extensions?.["gpxtpx:TrackPointExtension"]?.["gpxtpx:power"] ?? pt?.extensions?.power),
        });
      }
    }
  }

  if (points.length === 0) throw new HttpError(400, "Ce fichier .gpx ne contient aucun point de trace.");

  const horodates = points.map((p) => p.time).filter((t): t is Date => t !== null);
  if (horodates.length === 0) {
    throw new HttpError(400, "Ce fichier .gpx ne contient pas d'horodatage : la durée est incalculable.");
  }

  const debut = horodates[0];
  const fin = horodates[horodates.length - 1];

  return {
    sport: toSport(sportBrut),
    name: nom,
    startedAt: debut,
    durationS: (fin.getTime() - debut.getTime()) / 1000,
    // Le GPX ne porte pas de distance : elle est calculée depuis les positions.
    distanceM: distanceDepuisPositions(traces),
    points,
  };
}

/** Distance cumulée par la formule de haversine, à partir des coordonnées. */
function distanceDepuisPositions(traces: any[]): number | null {
  const coords: { lat: number; lon: number }[] = [];
  for (const trace of traces) {
    for (const segment of asArray(trace?.trkseg)) {
      for (const pt of asArray(segment?.trkpt)) {
        const lat = toNumber(pt?.["@lat"]);
        const lon = toNumber(pt?.["@lon"]);
        if (lat !== null && lon !== null) coords.push({ lat, lon });
      }
    }
  }
  if (coords.length < 2) return null;

  const R = 6_371_000;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const dLat = rad(b.lat - a.lat);
    const dLon = rad(b.lon - a.lon);
    const h =
      Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    total += 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  return Math.round(total);
}

function parseTcx(contenu: string): ParsedFile {
  const doc = xml.parse(contenu) as Record<string, any>;
  const activite = asArray(doc?.TrainingCenterDatabase?.Activities?.Activity)[0];
  if (!activite) throw new HttpError(400, "Ce fichier .tcx est invalide.");

  const laps = asArray(activite.Lap);
  const points: TrackPoint[] = [];
  let dureeTotale = 0;
  let distanceTotale = 0;

  for (const lap of laps) {
    dureeTotale += toNumber(lap?.TotalTimeSeconds) ?? 0;
    distanceTotale += toNumber(lap?.DistanceMeters) ?? 0;
    for (const track of asArray(lap?.Track)) {
      for (const tp of asArray(track?.Trackpoint)) {
        points.push({
          time: toDate(tp?.Time),
          distanceM: toNumber(tp?.DistanceMeters),
          altitudeM: toNumber(tp?.AltitudeMeters),
          heartRate: toNumber(tp?.HeartRateBpm?.Value),
          power: toNumber(tp?.Extensions?.["ns3:TPX"]?.["ns3:Watts"] ?? tp?.Extensions?.TPX?.Watts),
        });
      }
    }
  }

  const debut = toDate(activite["@Id"]) ?? points.find((p) => p.time)?.time;
  if (!debut) throw new HttpError(400, "Ce fichier .tcx ne contient pas de date de début.");

  return {
    sport: toSport(String(activite["@Sport"] ?? "")),
    name: null,
    startedAt: debut,
    durationS: dureeTotale,
    distanceM: distanceTotale > 0 ? distanceTotale : null,
    points,
  };
}

/* ------------------------------------------------------------------ */
/* Point d'entrée                                                      */
/* ------------------------------------------------------------------ */

/**
 * Transforme un fichier exporté d'une montre en activité exploitable, dans la
 * même forme que celles importées depuis un service tiers : le reste de
 * l'application ne fait aucune différence entre les deux.
 */
export function parseActivityFile(
  buffer: Buffer,
  filename: string
): NormalizedActivity & { format: ActivityFileFormat } {
  const format = formatFromFilename(filename);
  if (!format) {
    throw new HttpError(400, "Format non reconnu. Déposez un fichier .fit, .gpx ou .tcx.");
  }
  if (buffer.length === 0) {
    throw new HttpError(400, "Le fichier est vide.");
  }

  const parsed =
    format === "fit" ? parseFit(buffer) : format === "gpx" ? parseGpx(buffer.toString("utf8")) : parseTcx(buffer.toString("utf8"));

  const durationS = Math.max(0, Math.round(parsed.durationS));
  if (durationS < 30) {
    throw new HttpError(400, "Cette séance dure moins de 30 secondes : elle n'a pas été importée.");
  }

  const distanceKm = parsed.distanceM && parsed.distanceM > 0 ? parsed.distanceM / 1000 : null;

  return {
    format,
    // L'identifiant est déterministe : réimporter le même fichier ne crée pas
    // de doublon, même s'il a été renommé entre-temps.
    externalId: `${parsed.startedAt.toISOString()}-${durationS}`,
    sport: parsed.sport,
    name: parsed.name ?? `Séance du ${parsed.startedAt.toISOString().slice(0, 10)}`,
    startedAt: parsed.startedAt,
    dureeMin: Math.max(1, Math.round(durationS / 60)),
    distanceKm: distanceKm ? Math.round(distanceKm * 100) / 100 : null,
    denivelePosM: denivelePositif(parsed.points),
    fcMoyenne: moyenne(parsed.points.map((p) => p.heartRate)),
    fcMax: maximum(parsed.points.map((p) => p.heartRate)),
    puissanceMoy: moyenne(parsed.points.map((p) => p.power)),
    allureSecParKm: distanceKm && distanceKm > 0.1 ? Math.round(durationS / distanceKm) : null,
  };
}
