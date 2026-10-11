import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { extraireActivites, estUneArchive } from "../lib/archiveZip.js";

/**
 * Garmin Connect livre ses exports dans une archive .zip : elle doit pouvoir
 * être déposée telle quelle, sans que l'athlète ait à la décompresser.
 */

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

/** Archive minimale, une entrée compressée, comme en produisent la plupart des outils. */
function archive(nom: string, contenu: Buffer): Buffer {
  const compresse = deflateRawSync(contenu);
  const nomOctets = Buffer.from(nom);
  const locale = Buffer.alloc(30);
  locale.writeUInt32LE(0x04034b50, 0);
  locale.writeUInt16LE(8, 8);
  locale.writeUInt32LE(compresse.length, 18);
  locale.writeUInt32LE(contenu.length, 22);
  locale.writeUInt16LE(nomOctets.length, 26);
  const centrale = Buffer.alloc(46);
  centrale.writeUInt32LE(0x02014b50, 0);
  centrale.writeUInt16LE(8, 10);
  centrale.writeUInt32LE(compresse.length, 20);
  centrale.writeUInt32LE(contenu.length, 24);
  centrale.writeUInt16LE(nomOctets.length, 28);
  centrale.writeUInt32LE(0, 42);
  const debutCentrale = locale.length + nomOctets.length + compresse.length;
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(1, 8);
  fin.writeUInt16LE(1, 10);
  fin.writeUInt32LE(centrale.length + nomOctets.length, 12);
  fin.writeUInt32LE(debutCentrale, 16);
  return Buffer.concat([locale, nomOctets, compresse, centrale, nomOctets, fin]);
}

describe("archive .zip", () => {
  it("reconnaît une archive à son extension", () => {
    expect(estUneArchive("123456789.zip")).toBe(true);
    expect(estUneArchive("course.fit")).toBe(false);
  });

  it("extrait le .fit d'un export Garmin, sans les fichiers parasites de macOS", () => {
    const extraits = extraireActivites(fs.readFileSync(path.join(fixtures, "garmin-export.zip")));
    expect(extraits.map((e) => e.nom)).toEqual(["123456789_ACTIVITY.fit"]);
    expect(extraits[0].contenu.equals(fs.readFileSync(path.join(fixtures, "course.fit")))).toBe(true);
  });

  it("décompresse une entrée deflate", () => {
    const gpx = Buffer.from("<gpx>contenu de trace</gpx>");
    expect(extraireActivites(archive("sortie.gpx", gpx))[0].contenu.toString()).toBe(gpx.toString());
  });

  it("refuse une archive sans fichier d'activité", () => {
    expect(() => extraireActivites(archive("photo.jpg", Buffer.from("image")))).toThrow(/aucun fichier/);
  });

  it("refuse un fichier qui n'est pas une archive", () => {
    expect(() => extraireActivites(Buffer.from("pas une archive du tout, vraiment pas"))).toThrow(/illisible/);
  });
});
