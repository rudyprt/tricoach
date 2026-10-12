import axios from "axios";

export const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
});

/**
 * Le serveur calcule la semaine d'entraînement et le quota quotidien dans le
 * fuseau de l'athlète : il est transmis à l'inscription et à chaque connexion.
 */
/**
 * URL de la photo de profil. La date de mise à jour sert de cache-buster :
 * l'image est mise en cache un jour par le navigateur, mais une nouvelle photo
 * s'affiche immédiatement.
 */
export function avatarUrl(user: { avatarUpdatedAt: string | null } | null): string | null {
  if (!user?.avatarUpdatedAt) return null;
  return `/api/auth/avatar/me?v=${encodeURIComponent(user.avatarUpdatedAt)}`;
}

export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export interface AthleteProfile {
  id: string;
  userId: string;
  objectif: string;
  objectifDate: string;
  /** Temps visé, texte libre. Vide quand l'athlète vise seulement de finir. */
  objectifTemps: string;
  objectifFinir: boolean;
  tempsNatation: string;
  tempsVelo: string;
  tempsCourse: string;
  heuresSemaine: number;
  contraintes: string;
  /** Date du consentement au traitement des données de santé, null si retiré. */
  consentSanteAt?: string | null;
  ftpWatts: number | null;
  seuilCourseSecParKm: number | null;
  cssSecPer100m: number | null;
  fcSeuil: number | null;
  /** FC au seuil à vélo : quelques battements sous celle de course. */
  fcSeuilVelo: number | null;
  fcMax: number | null;
  /** FC moyenne et max de la course de référence, par discipline. */
  fcMoyNatation?: number | null;
  fcMaxNatation?: number | null;
  fcMoyVelo?: number | null;
  fcMaxVelo?: number | null;
  fcMoyCourse?: number | null;
  fcMaxCourse?: number | null;
  disponibilites: Disponibilites | null;
  materiel: Materiel | null;
}

/** Créneaux d'entraînement, jour par jour. */
export const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;
export type Jour = (typeof JOURS)[number];
export type Moment = "matin" | "midi" | "soir" | "libre";
/** Discipline imposée sur un créneau. « libre » laisse le coach choisir. */
export type Discipline = "libre" | "natation" | "velo" | "course" | "renfo";

export interface JourDisponible {
  disponible: boolean;
  dureeMaxMin?: number | null;
  moment?: Moment;
  discipline?: Discipline;
}

export type Disponibilites = Partial<Record<Jour, JourDisponible>>;

export interface Materiel {
  homeTrainer: boolean;
  capteurPuissance: boolean;
  montreGps: boolean;
  cardiofrequencemetre: boolean;
  tapisCourse: boolean;
  piscine: "aucune" | "25m" | "50m" | "eau_libre";
  velo: "route" | "contre_la_montre" | "vtt" | "aucun";
  /** Matériel de renforcement ; absent des profils enregistrés avant son ajout. */
  renfo?: "poids_du_corps" | "elastiques" | "halteres" | "salle";
}

export type TrainingPhase =
  | "base"
  | "developpement"
  | "specifique"
  | "affutage"
  | "course"
  | "transition";

export interface Periodization {
  phase: TrainingPhase;
  label: string;
  weeksToGoal: number;
}

export interface ZoneRange {
  zone: string;
  label: string;
  value: string;
  /** true si la valeur a été saisie par l'athlète et non calculée. */
  custom?: boolean;
  /** Fréquence cardiaque de la même zone, quand elle est connue. */
  fc?: string;
}

export type ZoneSport = "course" | "natation" | "velo";

/** Corrections manuelles : { course: { Z2: "5:30/km" }, ... }. */
export type ZoneOverrides = Partial<Record<ZoneSport, Record<string, string>>>;

export interface TrainingZones {
  course: ZoneRange[] | null;
  natation: ZoneRange[] | null;
  velo: ZoneRange[] | null;
  /** Repères de vitesse à vélo, faute de puissance et de fréquence cardiaque. */
  veloVitesse: ZoneRange[] | null;
  /** Zones de fréquence cardiaque, communes aux trois disciplines. */
  frequenceCardiaque: ZoneRange[] | null;
  notes: string[];
}

export interface ZonesResponse {
  zones: TrainingZones;
  /** Zones telles que calculées, sans les corrections : sert à y revenir. */
  computedZones: TrainingZones;
  overrides: ZoneOverrides;
  /** Proposition de FTP tirée des séances importées, jamais appliquée seule. */
  ftpSuggere: { puissanceMoy: number; ftpSuggere: number } | null;
  /** Ce qui décide de l'unité des zones : milieu de nage et capteurs. */
  contexte: {
    bassin: "25m" | "50m" | "eau_libre" | "aucune" | null;
    aCapteurPuissance: boolean;
    aCardio: boolean;
  };
  periodization: Periodization;
  /** D'où vient chaque jeu de zones : mesuré, saisi, estimé ou absent. */
  precision?: PrecisionZone[];
}

export interface PrecisionZone {
  discipline: "course" | "velo" | "natation" | "frequenceCardiaque";
  niveau: "mesuree" | "saisie" | "estimee" | "absente";
  source: string;
  test: "course" | "velo" | "natation" | null;
  aRefaire: boolean;
}

export interface SessionExercise {
  repetitions: string;
  allure: string;
  recuperation?: string;
  /** Renforcement : nom du mouvement et point technique clé. */
  nom?: string;
  consigne?: string;
  /** Fréquence cardiaque de la zone visée, calculée sur les zones de l'athlète. */
  fc?: string;
}

export interface SessionBlock {
  dureeMin: number;
  cible: string;
  description: string;
  exercices?: SessionExercise[];
  /** Fréquence cardiaque de la zone visée, calculée sur les zones de l'athlète. */
  fc?: string;
}

export interface SessionStructure {
  echauffement: SessionBlock;
  corps: SessionBlock;
  retourCalme: SessionBlock;
}

export interface Session {
  id: string;
  planId: string;
  date: string;
  sport: "natation" | "velo" | "course" | "renfo" | "repos";
  titre: string;
  dureeMin: number;
  distanceKm: number | null;
  description: string;
  objectif: string | null;
  structure: SessionStructure | null;
  /** Durée réellement effectuée, si l'athlète l'a corrigée. */
  dureeReelleMin?: number | null;
  status: "planifiee" | "faite" | "manquee";
  ressenti: string | null;
  completedAt: string | null;
}

export interface TrainingPlan {
  id: string;
  userId: string;
  weekStart: string;
  generatedAt: string;
  debrief: string | null;
  phase: TrainingPhase | null;
  sessions: Session[];
  periodization: Periodization;
}

export type GenerationStatus = "en_attente" | "en_cours" | "reussie" | "echouee";

export interface GenerationJob {
  id: string;
  kind: "premiere_semaine" | "semaine_suivante" | "ajustement_semaine";
  status: GenerationStatus;
  planId: string | null;
  error: string | null;
  createdAt: string;
  endedAt: string | null;
}

export function isGenerationRunning(job: GenerationJob | null): boolean {
  return job?.status === "en_attente" || job?.status === "en_cours";
}

/** Ce qui a été fait, comparé à ce qui était prévu — calculé sans IA. */
export interface BilanSeance {
  niveau: "conforme" | "ecart" | "alerte";
  constats: { niveau: "conforme" | "ecart" | "alerte"; texte: string }[];
  proposerReajustement: boolean;
}

/** Une demande faite au coach dans le chat, appliquée aux semaines générées. */
export interface ConsigneCoach {
  id: string;
  texte: string;
  jusquAu: string | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export type Plan = "free" | "standard" | "premium";

export type UserRole = "athlete" | "admin";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  /** Date du dernier changement de photo, ou null si aucune photo. */
  avatarUpdatedAt: string | null;
  plan: Plan;
  role: UserRole;
  timezone: string;
  createdAt: string;
  trialEndsAt: string;
  isTrialActive: boolean;
  /** Durée de l'essai, décidée par le serveur. */
  trialDays: number;
  hasStandardAccess: boolean;
  isPremium: boolean;
  /** false tant qu'aucun paiement n'est branché : l'app ne propose pas d'activer une offre. */
  selfServeBilling: boolean;
  emailVerified: boolean;
  /** true quand les conditions ont changé depuis la dernière acceptation. */
  needsConsent: boolean;
  /** Rappels par e-mail : semaine à générer, séances oubliées, fin d'essai. */
  rappelsEmail: boolean;
  profile: AthleteProfile | null;
}

/**
 * Quota du chat, tel que le serveur le calcule.
 *
 * La limite n'est pas répliquée ici : le navigateur ignore le fuseau de
 * référence et l'offre de l'athlète, et deux valeurs à maintenir finissent par
 * diverger — l'interface annonçait un reste que le serveur refusait.
 */
export interface ChatQuota {
  utilises: number;
  limite: number;
  /**
   * Ce qui empêche d'écrire. « quota » se lève à minuit, « abonnement » non :
   * les annoncer de la même façon enverrait l'athlète attendre pour rien.
   */
  bloque: "quota" | "abonnement" | null;
}

export function apiErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err) && err.response?.data && typeof err.response.data === "object") {
    const data = err.response.data as { error?: string };
    if (data.error) return data.error;
  }
  return fallback;
}

/** Le code HTTP d'une erreur, quand l'interface doit y réagir et pas seulement l'afficher. */
export function isHttpStatus(err: unknown, status: number): boolean {
  return axios.isAxiosError(err) && err.response?.status === status;
}

function hasErrorCode(err: unknown, code: string): boolean {
  return (
    axios.isAxiosError(err) &&
    typeof err.response?.data === "object" &&
    (err.response?.data as { code?: string })?.code === code
  );
}

export function isSubscriptionRequiredError(err: unknown): boolean {
  return hasErrorCode(err, "SUBSCRIPTION_REQUIRED");
}

/** Quota quotidien de messages épuisé : rien à acheter, il faut attendre minuit. */
export function isChatQuotaError(err: unknown): boolean {
  return hasErrorCode(err, "CHAT_QUOTA_REACHED");
}

export function isBillingUnavailableError(err: unknown): boolean {
  return hasErrorCode(err, "BILLING_UNAVAILABLE");
}

export function isRateLimitError(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 429;
}


/* ------------------------------------------------------------------ */
/* Administration                                                      */
/* ------------------------------------------------------------------ */

export interface StravaStatus {
  /** false si l'application n'a pas d'identifiants Strava : rien ne s'affiche. */
  disponible: boolean;
  relie: boolean;
  athleteName: string | null;
  lastSyncAt: string | null;
  activitesImportees: number;
}

export interface Activity {
  id: string;
  sport: string;
  name: string;
  startedAt: string;
  dureeMin: number;
  distanceKm: number | null;
  denivelePosM: number | null;
  fcMoyenne: number | null;
  puissanceMoy: number | null;
  allureSecParKm: number | null;
  sessionId: string | null;
}

export function formatAllure(secParKm: number): string {
  const minutes = Math.floor(secParKm / 60);
  const secondes = secParKm % 60;
  return `${minutes}:${String(secondes).padStart(2, "0")}/km`;
}

export interface SessionPage {
  sessions: Session[];
  nextCursor: string | null;
}

export interface ChatPage {
  messages: ChatMessage[];
  hasMore: boolean;
  oldestAt: string | null;
  quota: ChatQuota;
}

export interface AdminOverview {
  comptes: {
    total: number;
    parOffre: Record<Plan, number>;
    payants: number;
    tauxConversionPct: number;
    essaisEnCours: number;
    essaisExpiresNonConvertis: number;
    inscriptions7j: number;
    inscriptions30j: number;
  };
  frequentation: {
    actifs24h: number;
    actifs7j: number;
    actifs30j: number;
    jamaisRevenus: number;
    retention30jPct: number;
  };
  activite: {
    programmesGeneres30j: number;
    athletesAvecObjectifAVenir: number;
  };
  configuration: {
    emailsActifs: boolean;
    coachIaActif: boolean;
    paiementEnLigneActif: boolean;
    stravaActif: boolean;
  };
  coutIa: {
    totalMicroUsd: number;
    total30jMicroUsd: number;
    appelsTotal: number;
    appels30j: number;
    tokensEntree: number;
    tokensSortie: number;
    coutMoyenParPayant30jMicroUsd: number;
    parType: { kind: string; appels: number; coutMicroUsd: number }[];
    tarifsMisAJourLe: string;
  };
}

export interface AdminActivityDay {
  date: string;
  inscriptions: number;
  actifs: number;
  coutMicroUsd: number;
}

/** Un athlète et son assiduité sur la période observée. */
export interface AdminAssidu {
  id: string;
  email: string;
  name: string;
  plan: Plan;
  createdAt: string;
  lastSeenAt: string | null;
  joursActifs: number;
  semainesGenerees: number;
  seancesRenseignees: number;
  messagesCoach: number;
  derniereActivite: string | null;
}

export interface AdminAssidus {
  periodeJours: number;
  inactifs: number;
  total: number;
  comptes: AdminAssidu[];
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  plan: Plan;
  role: UserRole;
  timezone: string;
  createdAt: string;
  lastSeenAt: string | null;
  trialEndsAt: string;
  isTrialActive: boolean;
  /** Durée de l'essai, décidée par le serveur. */
  trialDays: number;
  hasStandardAccess: boolean;
  coutIaMicroUsd: number;
  profile: { objectif: string; objectifDate: string } | null;
  _count: { sessions: number; trainingPlans: number; chatMessages: number };
}

export interface AdminUserList {
  total: number;
  page: number;
  perPage: number;
  pages: number;
  users: AdminUserRow[];
}

export interface AdminAuditEntry {
  id: string;
  action: string;
  details: Record<string, unknown> | null;
  createdAt: string;
  admin: { id: string; email: string; name: string };
  targetUser: { id: string; email: string; name: string } | null;
}

/** Les montants circulent en micro-dollars pour éviter les arrondis flottants. */
export function formatUsd(microUsd: number): string {
  const dollars = microUsd / 1_000_000;
  if (dollars > 0 && dollars < 0.01) return "< 0,01 $";
  return `${dollars.toFixed(2).replace(".", ",")} $`;
}

/**
 * Test de terrain programmé par le coach. Son résultat sert à recaler les
 * valeurs de seuil, donc toutes les zones, sur le niveau réel du moment.
 */
export interface FitnessTest {
  id: string;
  sport: "course" | "velo" | "natation";
  kind: string;
  date: string;
  status: "planifie" | "realise" | "abandonne";
  titre: string;
  protocole: string;
  mesures: string;
  resultat: {
    distanceM: number | null;
    puissanceMoy: number | null;
    temps400S: number | null;
    temps200S: number | null;
    fcMoyenne: number | null;
  };
  resume: string | null;
}

export interface FitnessTestsResponse {
  enCours: FitnessTest[];
  historique: FitnessTest[];
}

/** Interruption d'entraînement : blessure, maladie, indisponibilité. */
export type RaisonPause = "blessure" | "maladie" | "indisponibilite";

export interface PauseEnCours {
  id: string;
  raison: RaisonPause;
  libelle: string;
  detail: string;
  debut: string;
  finPrevue: string | null;
  joursEcoules: number;
}

export interface Reprise {
  semaine: number;
  total: number;
  facteurVolume: number;
  joursArret: number;
  raison: string;
}

export interface EtatEntrainement {
  etat: "normal" | "en_pause" | "en_reprise";
  pause: PauseEnCours | null;
  reprise: Reprise | null;
}

/** Une course inscrite au calendrier. La priorité décide de l'affûtage. */
export type PrioriteCourse = "A" | "B" | "C";
export type FormatCourse = "sprint" | "olympique" | "half" | "ironman" | "autre";
/** Un triathlon, ou une épreuve d'une seule discipline (10 km, cyclosportive, traversée). */
export type DisciplineCourse = "triathlon" | "course" | "velo" | "natation";

export interface Course {
  id: string;
  nom: string;
  date: string;
  format: FormatCourse;
  discipline?: DisciplineCourse;
  /** Distance d'une épreuve d'une seule discipline, en kilomètres. */
  distanceKm?: number | null;
  priorite: PrioriteCourse;
  lieu: string;
  objectifTemps: string;
  formatLabel: string;
  prioriteLabel: string;
  /** Une analyse de la course existe (offre Premium). */
  analysee?: boolean;
}

/** Ce que l'athlète saisit après sa course. Durées au format h:mm:ss ou mm:ss. */
export interface ResultatCourse {
  natation: string;
  t1: string;
  velo: string;
  t2: string;
  course: string;
  total: string;
  distances?: { natationM?: number; veloKm?: number; courseKm?: number };
  fcNatation?: number | null;
  fcVelo?: number | null;
  fcCourse?: number | null;
  classementGeneral: string;
  classementCategorie: string;
  conditions: string;
  ressenti: string;
}

export type SegmentCourse = "natation" | "t1" | "velo" | "t2" | "course";

/** Chiffres calculés par le serveur à partir du résultat. */
export interface ChiffresCourse {
  segments: {
    segment: SegmentCourse;
    libelle: string;
    duree: string;
    part: number | null;
    allure: string | null;
    fcMoyenne: number | null;
  }[];
  total: string | null;
  ecartObjectifS: number | null;
}

export interface AnalyseCourse {
  resume: string;
  segments: { segment: SegmentCourse; constat: string; conseil: string }[];
  pointsForts: string[];
  axesProgres: { titre: string; pourquoi: string; travail: string }[];
  prochaineCourse: string;
}

export interface AnalyseCourseReponse {
  resultat: ResultatCourse | null;
  chiffres: ChiffresCourse | null;
  analyse: AnalyseCourse | null;
  genereLe: string | null;
}

/** Charge d'entraînement : condition acquise, fatigue récente et fraîcheur. */
export interface PointDeCharge {
  date: string;
  charge: number;
  forme: number;
  fatigue: number;
  fraicheur: number;
}

export interface BilanDeCharge {
  points: PointDeCharge[];
  forme: number;
  fatigue: number;
  fraicheur: number;
  lecture: {
    etat: "frais" | "equilibre" | "charge" | "surcharge";
    titre: string;
    message: string;
  };
  seancesEstimees: number;
  seancesTotal: number;
}

/** Plan de course : allures, nutrition, hydratation, transitions. */
export interface BlocCourse {
  titre: string;
  allure: string;
  nutrition: string;
  hydratation: string;
  erreurs: string;
}

export interface PlanCourse {
  resume: string;
  veille: string;
  matin: string;
  natation: BlocCourse;
  transition1: string;
  velo: BlocCourse;
  transition2: string;
  course: BlocCourse;
  reperes: string[];
}

/** Progression des valeurs de seuil, test après test. */
export interface PointProgression {
  date: string;
  valeur: number;
  libelle: string;
}

export interface ProgressionSeuils {
  sens: Record<"course" | "velo" | "natation", "plus_bas_mieux" | "plus_haut_mieux">;
  series: Record<"course" | "velo" | "natation", PointProgression[]>;
}

/** Régularité, jalons et records personnels. */
export interface SemaineTenue {
  weekStart: string;
  prevuMin: number;
  realiseMin: number;
  seancesPrevues: number;
  seancesFaites: number;
  tenue: boolean;
  /** Semaine encore en cours : ni tenue, ni manquée. */
  enCours: boolean;
}

export interface Jalon {
  cle: string;
  titre: string;
  detail: string;
  atteintLe: string;
}

export interface RecordPersonnel {
  sport: string;
  libelle: string;
  valeur: string;
  date: string;
}

export interface BilanRegularite {
  serie: number;
  meilleureSerie: number;
  semaines: SemaineTenue[];
  totalSeances: number;
  totalHeures: number;
  jalons: Jalon[];
  records: RecordPersonnel[];
}
