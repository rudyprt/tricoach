import "dotenv/config";
import { askClaude, isAiConfigured } from "../lib/anthropic.js";
import { buildFirstWeekPrompt, buildSystemPrompt, parseAiPlan } from "../routes/plans.js";
import { computeTrainingZones, periodization } from "../lib/training.js";
import { addDays, startOfWeek, weekDays } from "../lib/week.js";
import { PROFILS, type ProfilEval } from "./profils.js";
import { REGLES, evaluer, type ResultatProfil, type SeanceGeneree } from "./regles.js";

/**
 * Banc d'essai du coach.
 *
 * Sans lui, modifier le prompt est un pari : on regarde une semaine générée,
 * elle paraît correcte, on garde. Un changement qui dégrade les programmes ne
 * se découvre alors que par la plainte d'un athlète.
 *
 * Ici, une dizaine de profils passent par le prompt DE PRODUCTION — les mêmes
 * fonctions que la route de génération, pas une copie qui divergerait — et le
 * résultat est confronté à des règles qu'un coach n'enfreindrait pas.
 *
 *   npm run eval-coach
 *
 * Chaque passage appelle le modèle une fois par profil : quelques dizaines de
 * centimes. C'est le prix d'une réponse à « est-ce que mon changement
 * améliore ou dégrade ? ».
 */

/*
 * Le banc n'ouvre aucune base et ne signe aucun jeton : il construit des
 * prompts et lit des réponses. Mais la configuration du serveur est validée
 * d'un bloc au premier accès, si bien que lancer le banc réclamait une
 * DATABASE_URL et un JWT_SECRET sans rapport — et l'erreur accusait le
 * fichier .env, ce qui envoyait chercher au mauvais endroit.
 *
 * On renseigne donc ici des valeurs inertes pour ce que le banc n'utilise pas,
 * afin que la seule variable réellement exigée soit la clé du modèle.
 */
process.env.DATABASE_URL ||= "postgresql://inutilise:inutilise@127.0.0.1:1/banc-dessai";
process.env.JWT_SECRET ||= "banc-d-essai-aucun-jeton-n-est-signe-ici";

const VERT = "\u001b[32m";
const ROUGE = "\u001b[31m";
const JAUNE = "\u001b[33m";
const GRIS = "\u001b[90m";
const RAZ = "\u001b[0m";

/** Prépare exactement ce que la route de génération enverrait pour ce profil. */
function preparer(cas: ProfilEval) {
  const weekStart = startOfWeek(new Date(), "Europe/Paris");
  const objectifDate = addDays(weekStart, cas.semainesAvantObjectif * 7);
  const profil = { ...cas.profil, objectifDate };

  const phase = periodization(weekStart, objectifDate);
  const zones = computeTrainingZones({
    tempsCourse: profil.tempsCourse,
    tempsNatation: profil.tempsNatation,
    tempsVelo: profil.tempsVelo,
    seuilCourseSecParKm: profil.seuilCourseSecParKm,
    ftpWatts: profil.ftpWatts,
    cssSecPer100m: profil.cssSecPer100m,
    fcSeuil: profil.fcSeuil,
    fcMax: profil.fcMax,
    overrides: {},
  });

  // Même calcul que la première semaine en production.
  const maxVolumeMin = Math.round(profil.heuresSemaine * 60 * phase.volumeFactor);
  const jours = weekDays(weekStart);

  return {
    phase,
    zones,
    maxVolumeMin,
    jours,
    system: buildSystemPrompt(false, phase),
    user: buildFirstWeekPrompt(profil, weekStart, phase, maxVolumeMin, [], [], zones, []),
  };
}

async function passerUnProfil(cas: ProfilEval): Promise<ResultatProfil> {
  const { system, user, zones, maxVolumeMin, jours } = preparer(cas);

  try {
    const reponse = await askClaude({ system, messages: [{ role: "user", content: user }], maxTokens: 4000 });
    const plan = parseAiPlan(reponse.text, jours);
    return evaluer(plan.sessions as SeanceGeneree[], { profil: cas, zones, maxVolumeMin, jours });
  } catch (erreur) {
    /*
     * Une génération qui échoue n'est pas une règle enfreinte : c'est pire. On
     * la compte comme un échec total plutôt que de l'écarter du score, sans
     * quoi un prompt qui casse la réponse afficherait un résultat flatteur.
     */
    return {
      cle: cas.cle,
      intention: cas.intention,
      reussies: 0,
      total: REGLES.length,
      manquements: [],
      erreur: erreur instanceof Error ? erreur.message : String(erreur),
    };
  }
}

function afficher(resultats: ResultatProfil[]): number {
  const reussies = resultats.reduce((t, r) => t + r.reussies, 0);
  const total = resultats.reduce((t, r) => t + r.total, 0);
  const score = Math.round((reussies / total) * 100);

  console.log("");
  for (const r of resultats) {
    const parfait = r.reussies === r.total && !r.erreur;
    const couleur = r.erreur ? ROUGE : parfait ? VERT : JAUNE;
    console.log(`${couleur}${parfait ? "✓" : "✗"}${RAZ} ${r.cle.padEnd(24)} ${r.reussies}/${r.total}`);
    console.log(`  ${GRIS}${r.intention}${RAZ}`);
    if (r.erreur) console.log(`  ${ROUGE}génération échouée : ${r.erreur}${RAZ}`);
    for (const m of r.manquements) console.log(`  ${JAUNE}${m.regle}${RAZ} — ${m.detail}`);
    console.log("");
  }

  const couleur = score >= 95 ? VERT : score >= 80 ? JAUNE : ROUGE;
  console.log(`${couleur}Score : ${score} % (${reussies}/${total} règles respectées sur ${resultats.length} profils)${RAZ}`);
  console.log(`${GRIS}Un score n'est comparable qu'à un autre score : relancez après chaque modification du prompt.${RAZ}`);
  return score;
}

async function principal() {
  if (!isAiConfigured()) {
    console.error("ANTHROPIC_API_KEY n'est pas défini : le banc d'essai appelle le vrai modèle.");
    process.exit(1);
  }

  const filtre = process.argv[2];
  const cas = filtre ? PROFILS.filter((p) => p.cle.includes(filtre)) : PROFILS;
  if (cas.length === 0) {
    console.error(`Aucun profil ne correspond à « ${filtre} ».`);
    process.exit(1);
  }

  console.log(`Banc d'essai du coach — ${cas.length} profil(s), ${REGLES.length} règles chacun.`);
  console.log(`${GRIS}Un appel au modèle par profil.${RAZ}`);

  // En série, pas en parallèle : la limite de débit du fournisseur ferait
  // échouer des profils pour une raison qui n'a rien à voir avec le coach.
  const resultats: ResultatProfil[] = [];
  for (const c of cas) {
    process.stdout.write(`  ${c.cle}… `);
    const r = await passerUnProfil(c);
    console.log(r.erreur ? "échec" : `${r.reussies}/${r.total}`);
    resultats.push(r);
  }

  const score = afficher(resultats);
  // Code de sortie non nul sous 80 % : utilisable tel quel dans une CI.
  process.exit(score >= 80 ? 0 : 1);
}

principal().catch((erreur) => {
  console.error(erreur);
  process.exit(1);
});
