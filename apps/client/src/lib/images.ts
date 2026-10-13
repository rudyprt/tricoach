/**
 * Réduit une photo avant envoi : 1568 px de côté au plus, en JPEG.
 *
 * Une photo de téléphone pèse plusieurs mégaoctets, et le coach ne lit pas
 * davantage au-delà de cette taille. La réduire accélère l'envoi sur réseau
 * mobile et convertit au passage les formats que le serveur ne lit pas (HEIC
 * de l'iPhone, que Safari sait décoder). Si le navigateur ne sait pas la lire,
 * la photo part telle quelle et le serveur dira si elle est lisible.
 */
export async function reduireImage(fichier: File, cote = 1568): Promise<Blob> {
  try {
    if (typeof createImageBitmap !== "function") return fichier;
    const image = await createImageBitmap(fichier);
    const echelle = Math.min(1, cote / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * echelle);
    canvas.height = Math.round(image.height * echelle);
    const contexte = canvas.getContext("2d");
    if (!contexte) return fichier;
    contexte.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ?? fichier;
  } catch {
    return fichier;
  }
}
