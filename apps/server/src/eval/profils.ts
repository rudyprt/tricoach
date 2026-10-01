import type { ProfileForPrompt } from "../routes/plans.js";

/**
 * Athlètes fictifs du banc d'essai.
 *
 * Ils ne sont pas tirés au hasard : chacun met à l'épreuve une contrainte que
 * le coach a déjà enfreinte ou pourrait enfreindre — un débutant qu'on charge
 * trop, un athlète sans capteur à qui l'on prescrit des watts, une blessure
 * qu'on ignore, un objectif si lointain que la phase n'est plus respectée.
 *
 * Les durées et temps de référence sont plausibles : un profil absurde ferait
 * échouer le coach pour de mauvaises raisons et le banc perdrait son sens.
 */

export interface ProfilEval {
  /** Identifiant court, affiché dans le rapport. */
  cle: string;
  /** Ce que ce profil met à l'épreuve. */
  intention: string;
  profil: ProfileForPrompt;
  /** Semaines séparant la semaine générée de l'objectif. */
  semainesAvantObjectif: number;
}

const SANS_ZONES = { customZones: null, disponibilites: null, materiel: null };

export const PROFILS: ProfilEval[] = [
  {
    cle: "debutante-sprint",
    intention: "Volume faible à ne pas dépasser, aucune donnée mesurée.",
    semainesAvantObjectif: 14,
    profil: {
      objectif: "Triathlon sprint de Deauville",
      objectifDate: new Date(),
      tempsNatation: "400m en 9min",
      tempsVelo: "20km en 45min",
      tempsCourse: "5km en 32min",
      heuresSemaine: 4,
      contraintes: "Débutante, jamais couru plus de 5 km.",
      ftpWatts: null,
      seuilCourseSecParKm: null,
      cssSecPer100m: null,
      fcSeuil: null,
      fcMax: null,
      ...SANS_ZONES,
    },
  },
  {
    cle: "cadre-ironman",
    intention: "Gros volume, objectif lointain : la phase doit rester de la base.",
    semainesAvantObjectif: 30,
    profil: {
      objectif: "Ironman de Nice",
      objectifDate: new Date(),
      tempsNatation: "1500m en 28min",
      tempsVelo: "40km en 1h10",
      tempsCourse: "10km en 42min",
      heuresSemaine: 12,
      contraintes: "",
      ftpWatts: 265,
      seuilCourseSecParKm: 245,
      cssSecPer100m: 100,
      fcSeuil: 170,
      fcMax: 190,
      ...SANS_ZONES,
    },
  },
  {
    cle: "sans-capteur",
    intention: "Ni FTP ni cardio : aucune cible vélo ne doit être en watts.",
    semainesAvantObjectif: 10,
    profil: {
      objectif: "Triathlon olympique de Paris",
      objectifDate: new Date(),
      tempsNatation: "1500m en 32min",
      tempsVelo: "40km en 1h20",
      tempsCourse: "10km en 48min",
      heuresSemaine: 7,
      contraintes: "",
      ftpWatts: null,
      seuilCourseSecParKm: null,
      cssSecPer100m: null,
      fcSeuil: null,
      fcMax: null,
      ...SANS_ZONES,
    },
  },
  {
    cle: "genou-blesse",
    intention: "Blessure déclarée : la course doit être réduite ou absente.",
    semainesAvantObjectif: 16,
    profil: {
      objectif: "Half Ironman de Vichy",
      objectifDate: new Date(),
      tempsNatation: "1500m en 30min",
      tempsVelo: "40km en 1h15",
      tempsCourse: "10km en 45min",
      heuresSemaine: 8,
      contraintes: "Tendinite au genou droit depuis deux semaines, la course à pied réveille la douleur.",
      ftpWatts: 240,
      seuilCourseSecParKm: 260,
      cssSecPer100m: 105,
      fcSeuil: 168,
      fcMax: 188,
      ...SANS_ZONES,
    },
  },
  {
    cle: "sans-piscine-weekend",
    intention: "Contrainte de créneau : aucune natation le samedi ni le dimanche.",
    semainesAvantObjectif: 12,
    profil: {
      objectif: "Triathlon olympique d'Annecy",
      objectifDate: new Date(),
      tempsNatation: "1500m en 29min",
      tempsVelo: "40km en 1h12",
      tempsCourse: "10km en 44min",
      heuresSemaine: 9,
      contraintes: "Pas d'accès à la piscine le week-end.",
      ftpWatts: 250,
      seuilCourseSecParKm: 250,
      cssSecPer100m: 102,
      fcSeuil: 172,
      fcMax: 192,
      ...SANS_ZONES,
    },
  },
  {
    cle: "affutage",
    intention: "Objectif tout proche : volume réduit, pas de séance épuisante.",
    semainesAvantObjectif: 1,
    profil: {
      objectif: "Triathlon olympique de La Rochelle",
      objectifDate: new Date(),
      tempsNatation: "1500m en 27min",
      tempsVelo: "40km en 1h05",
      tempsCourse: "10km en 40min",
      heuresSemaine: 10,
      contraintes: "",
      ftpWatts: 280,
      seuilCourseSecParKm: 235,
      cssSecPer100m: 96,
      fcSeuil: 174,
      fcMax: 194,
      ...SANS_ZONES,
    },
  },
  {
    cle: "nageuse-faible-velo",
    intention: "Déséquilibre marqué : le vélo ne doit pas être délaissé.",
    semainesAvantObjectif: 18,
    profil: {
      objectif: "Half Ironman de Aix-en-Provence",
      objectifDate: new Date(),
      tempsNatation: "1500m en 23min",
      tempsVelo: "40km en 1h30",
      tempsCourse: "10km en 50min",
      heuresSemaine: 8,
      contraintes: "Ancienne nageuse de club, très faible à vélo.",
      ftpWatts: 180,
      seuilCourseSecParKm: 280,
      cssSecPer100m: 82,
      fcSeuil: 165,
      fcMax: 185,
      ...SANS_ZONES,
    },
  },
  {
    cle: "temps-tres-court",
    intention: "Quatre heures par semaine : le volume ne doit pas déborder.",
    semainesAvantObjectif: 20,
    profil: {
      objectif: "Triathlon sprint de Chartres",
      objectifDate: new Date(),
      tempsNatation: "400m en 8min",
      tempsVelo: "20km en 38min",
      tempsCourse: "5km en 24min",
      heuresSemaine: 4,
      contraintes: "Trois enfants en bas âge, peu de disponibilité.",
      ftpWatts: 230,
      seuilCourseSecParKm: 255,
      cssSecPer100m: 98,
      fcSeuil: 169,
      fcMax: 189,
      ...SANS_ZONES,
    },
  },
];
