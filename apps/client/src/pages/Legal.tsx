import { Link } from "react-router-dom";
import type { ReactNode } from "react";

/**
 * Ces pages décrivent fidèlement ce que l'application fait des données, tel que
 * le code le fait réellement. Les mentions d'identité de l'éditeur restent à
 * compléter, et le texte doit être relu par un professionnel avant exploitation
 * commerciale : le bandeau ci-dessous le rappelle tant que c'est le cas.
 */
const EDITEUR_A_COMPLETER = true;

function Page({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link to="/dashboard" className="text-sm text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline">
        ← Retour
      </Link>
      <h1 className="mt-4 text-2xl font-black italic tracking-wide text-white">{title}</h1>
      <p className="mt-1 text-xs text-zinc-500">Version {updated}</p>

      {EDITEUR_A_COMPLETER && (
        <p className="mt-4 rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          Document à compléter (identité de l'éditeur, contact) et à faire relire avant exploitation commerciale.
        </p>
      )}

      <div className="mt-5 space-y-5 text-sm leading-relaxed text-zinc-300">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-1.5 text-base font-bold text-white">{title}</h2>
      <div className="space-y-2 text-zinc-400">{children}</div>
    </section>
  );
}

export function Conditions() {
  return (
    <Page title="Conditions d'utilisation" updated="2026-09">
      <Section title="Objet">
        <p>
          TriCoach met à disposition un service de génération de programmes d'entraînement en triathlon, assisté par
          intelligence artificielle, ainsi qu'un suivi de séances et un espace de discussion avec un coach virtuel.
        </p>
      </Section>

      <Section title="Éditeur">
        <p className="italic text-zinc-500">
          [À compléter : dénomination, forme juridique, adresse, numéro d'immatriculation, adresse de contact,
          directeur de la publication, hébergeur.]
        </p>
      </Section>

      <Section title="Compte">
        <p>
          La création d'un compte requiert une adresse e-mail valide et un mot de passe d'au moins 8 caractères. Vous
          êtes responsable de la confidentialité de vos identifiants. Un compte est personnel et ne peut être partagé.
        </p>
      </Section>

      <Section title="Offres et essai">
        <p>
          Chaque nouveau compte bénéficie d'une période d'essai de 14 jours donnant accès à la génération de
          programmes.
          Au-delà, l'accès aux fonctions de programmation nécessite une offre payante. Les tarifs affichés dans
          l'application s'entendent toutes taxes comprises, par mois.
        </p>
        <p className="italic text-zinc-500">
          [À compléter : modalités de paiement, de reconduction et de résiliation, droit de rétractation.]
        </p>
      </Section>

      <Section title="Avertissement — santé">
        <p className="text-zinc-300">
          Les programmes proposés sont générés automatiquement à partir des informations que vous déclarez. Ils ne
          constituent ni un avis médical, ni un diagnostic, ni une prescription. Ils ne remplacent pas l'avis d'un
          médecin, d'un kinésithérapeute ou d'un entraîneur diplômé.
        </p>
        <p className="text-zinc-300">
          Consultez un médecin avant de reprendre ou d'intensifier une activité sportive, en particulier en cas de
          douleur, de blessure, de pathologie connue ou de reprise après une interruption prolongée. Interrompez toute
          séance en cas de douleur inhabituelle.
        </p>
      </Section>

      <Section title="Limites du service">
        <p>
          Le service repose sur un modèle d'intelligence artificielle : ses productions peuvent comporter des erreurs
          ou des recommandations inadaptées à votre situation. Vous restez seul juge de leur pertinence. Le service est
          fourni sans garantie de disponibilité continue.
        </p>
      </Section>

      <Section title="Résiliation">
        <p>
          Vous pouvez supprimer votre compte à tout moment depuis la page « Mon compte ». La suppression est
          définitive et entraîne l'effacement de vos données, dans les conditions décrites par la{" "}
          <Link to="/confidentialite" className="text-rose-400 hover:underline">
            politique de confidentialité
          </Link>
          .
        </p>
      </Section>
    </Page>
  );
}

export function Confidentialite() {
  return (
    <Page title="Politique de confidentialité" updated="2026-09">
      <Section title="Responsable du traitement">
        <p className="italic text-zinc-500">[À compléter : identité et coordonnées du responsable de traitement.]</p>
      </Section>

      <Section title="Données collectées">
        <p>Le service enregistre uniquement les données que vous fournissez ou qui découlent de votre usage :</p>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            <strong className="text-zinc-300">Compte</strong> — adresse e-mail, nom d'utilisateur, photo de profil si
            vous en ajoutez une, fuseau horaire, mot de passe (conservé sous forme chiffrée irréversible).
          </li>
          <li>
            <strong className="text-zinc-300">Profil sportif</strong> — objectif et sa date, temps de référence par
            discipline, FTP, heures disponibles, zones d'entraînement.
          </li>
          <li>
            <strong className="text-zinc-300">Données de santé déclarées</strong> — blessures, douleurs et contraintes
            que vous signalez, ressenti après chaque séance. Ces informations sont sensibles : elles ne sont
            enregistrées que parce que vous les saisissez, et uniquement pour adapter vos programmes.
          </li>
          <li>
            <strong className="text-zinc-300">Entraînement</strong> — programmes générés, séances, statut et
            historique.
          </li>
          <li>
            <strong className="text-zinc-300">Échanges</strong> — messages envoyés au coach virtuel et ses réponses.
          </li>
          <li>
            <strong className="text-zinc-300">Usage</strong> — date de dernière connexion et volume de sollicitation du
            modèle, à des fins de suivi technique et de facturation interne.
          </li>
        </ul>
        <p>
          Aucun traceur publicitaire n'est utilisé. Le seul cookie déposé est celui de votre session, nécessaire au
          fonctionnement du service.
        </p>
      </Section>

      <Section title="Finalités et bases légales">
        <ul className="ml-4 list-disc space-y-1">
          <li>Fournir le service et générer vos programmes — exécution du contrat.</li>
          <li>
            Traiter vos données de santé déclarées — votre consentement explicite, donné à l'inscription et
            retirable à tout moment en supprimant ces informations ou votre compte.
          </li>
          <li>Sécuriser les accès et prévenir les abus — intérêt légitime.</li>
          <li>Gérer les abonnements — exécution du contrat et obligations comptables.</li>
        </ul>
      </Section>

      <Section title="Destinataires">
        <p>
          Vos données ne sont ni vendues ni cédées. Elles sont transmises aux seuls prestataires techniques
          nécessaires au fonctionnement :
        </p>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            <strong className="text-zinc-300">Anthropic</strong> — les éléments de votre profil et de votre historique
            utiles à la génération sont transmis au modèle Claude pour produire vos programmes et les réponses du
            coach.
          </li>
          <li>
            <strong className="text-zinc-300">Hébergeur et base de données</strong>{" "}
            <span className="italic text-zinc-500">[à compléter : prestataires et localisation des serveurs]</span>.
          </li>
        </ul>
      </Section>

      <Section title="Durée de conservation">
        <p>
          Vos données sont conservées tant que votre compte existe. Elles sont effacées lors de sa suppression. Les
          jetons de réinitialisation et de vérification expirent automatiquement.
        </p>
      </Section>

      <Section title="Vos droits">
        <p>
          Vous disposez d'un droit d'accès, de rectification, d'effacement, de limitation, d'opposition et de
          portabilité. Deux d'entre eux s'exercent directement dans l'application, sans démarche :
        </p>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            <strong className="text-zinc-300">Portabilité et accès</strong> — téléchargez l'intégralité de vos données
            au format JSON depuis{" "}
            <Link to="/compte" className="text-rose-400 hover:underline">
              Mon compte
            </Link>
            .
          </li>
          <li>
            <strong className="text-zinc-300">Effacement</strong> — supprimez définitivement votre compte et toutes vos
            données depuis la même page.
          </li>
        </ul>
        <p>
          Vous pouvez également introduire une réclamation auprès de la CNIL (
          <span className="text-zinc-300">www.cnil.fr</span>).
        </p>
        <p className="italic text-zinc-500">[À compléter : adresse de contact pour l'exercice des autres droits.]</p>
      </Section>

      <Section title="Sécurité">
        <p>
          Les mots de passe sont conservés hachés et jamais en clair. Les échanges sont chiffrés en transit. L'accès
          aux données d'un compte est strictement limité à son titulaire et, pour la gestion des abonnements, aux
          administrateurs du service, dont les actions sont journalisées.
        </p>
      </Section>
    </Page>
  );
}
