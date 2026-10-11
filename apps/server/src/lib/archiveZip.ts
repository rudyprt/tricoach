import { inflateRawSync } from "node:zlib";
import { HttpError } from "./http.js";
import { MAX_FILE_BYTES, formatFromFilename } from "./activityFiles.js";

/**
 * Archives .zip, telles que Garmin Connect les produit.
 *
 * « Exporter l'original » livre `123456789.zip`, qui contient le `.fit` de la
 * montre. L'athlète devait le décompresser avant de le déposer — sur un
 * téléphone, autant dire qu'il abandonnait. L'archive est désormais ouverte
 * ici, et seuls les fichiers d'activité qu'elle contient sont retenus.
 *
 * Lecture volontairement minimale : le répertoire central, puis chaque entrée,
 * stockée ou compressée en « deflate ». Les tailles sont bornées pour qu'une
 * archive piégée ne puisse pas épuiser la mémoire du serveur.
 */

const SIGNATURE_FIN = 0x06054b50;
const SIGNATURE_CENTRALE = 0x02014b50;
const SIGNATURE_LOCALE = 0x04034b50;
const MAX_ENTREES = 20;

export interface FichierExtrait {
  nom: string;
  contenu: Buffer;
}

export function estUneArchive(nom: string): boolean {
  return nom.toLowerCase().endsWith(".zip");
}

export function extraireActivites(archive: Buffer): FichierExtrait[] {
  // L'enregistrement de fin se trouve dans les 64 Ko finaux (commentaire compris).
  let fin = -1;
  for (let i = archive.length - 22; i >= Math.max(0, archive.length - 65557); i--) {
    if (archive.readUInt32LE(i) === SIGNATURE_FIN) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new HttpError(400, "Cette archive .zip est illisible.");

  const nombre = archive.readUInt16LE(fin + 10);
  let position = archive.readUInt32LE(fin + 16);
  const extraits: FichierExtrait[] = [];

  for (let k = 0; k < Math.min(nombre, MAX_ENTREES); k++) {
    if (position + 46 > archive.length || archive.readUInt32LE(position) !== SIGNATURE_CENTRALE) break;
    const methode = archive.readUInt16LE(position + 10);
    const tailleCompressee = archive.readUInt32LE(position + 20);
    const taille = archive.readUInt32LE(position + 24);
    const longueurNom = archive.readUInt16LE(position + 28);
    const longueurExtra = archive.readUInt16LE(position + 30);
    const longueurCommentaire = archive.readUInt16LE(position + 32);
    const decalageLocal = archive.readUInt32LE(position + 42);
    const nomComplet = archive.toString("utf8", position + 46, position + 46 + longueurNom);
    position += 46 + longueurNom + longueurExtra + longueurCommentaire;

    // Dossiers, fichiers cachés de macOS et formats inconnus : ignorés.
    const nom = nomComplet.split("/").pop() ?? "";
    if (!nom || nomComplet.startsWith("__MACOSX/") || nom.startsWith(".") || !formatFromFilename(nom)) continue;
    if (taille > MAX_FILE_BYTES) throw new HttpError(400, `« ${nom} » dépasse la taille autorisée.`);

    if (decalageLocal + 30 > archive.length || archive.readUInt32LE(decalageLocal) !== SIGNATURE_LOCALE) {
      throw new HttpError(400, "Cette archive .zip est endommagée.");
    }
    const debut = decalageLocal + 30 + archive.readUInt16LE(decalageLocal + 26) + archive.readUInt16LE(decalageLocal + 28);
    const donnees = archive.subarray(debut, debut + tailleCompressee);

    let contenu: Buffer;
    if (methode === 0) contenu = Buffer.from(donnees);
    else if (methode === 8) {
      try {
        contenu = inflateRawSync(donnees, { maxOutputLength: MAX_FILE_BYTES });
      } catch {
        throw new HttpError(400, `« ${nom} » n'a pas pu être décompressé.`);
      }
    } else throw new HttpError(400, `« ${nom} » utilise une compression non prise en charge.`);

    extraits.push({ nom, contenu });
  }

  if (extraits.length === 0) {
    throw new HttpError(400, "Cette archive ne contient aucun fichier .fit, .gpx ou .tcx.");
  }
  return extraits;
}
