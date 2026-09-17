#!/usr/bin/env python3
"""Génère les icônes PNG de l'application (manifeste PWA et écran d'accueil iOS).

Aucune dépendance : l'environnement de build n'a ni Pillow ni outil de
rasterisation SVG, et ajouter une dépendance native pour trois images figées
serait disproportionné. Les icônes sont donc dessinées ici, puis versionnées.

Motif : trois barres ascendantes — la progression d'un athlète — sur le fond
sombre de l'application, dans son rose de marque.

Usage : python3 apps/client/scripts/icones.py
"""

import struct
import zlib
from pathlib import Path

FOND = (9, 9, 11)          # zinc-950, le fond de l'application
BARRES = [
    (244, 63, 94),         # rose-500
    (225, 29, 72),         # rose-600
    (190, 18, 60),         # rose-700
]
# Suréchantillonnage : le lissage des bords vient de la moyenne des sous-pixels.
SS = 4


def rect_arrondi(x0, y0, x1, y1, r):
    """Prédicat d'appartenance à un rectangle aux coins arrondis."""

    def dedans(x, y):
        if not (x0 <= x <= x1 and y0 <= y <= y1):
            return False
        cx = min(max(x, x0 + r), x1 - r)
        cy = min(max(y, y0 + r), y1 - r)
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

    return dedans


def dessine(taille, marge_relative):
    """Rend l'icône en RGB. `marge_relative` réserve la zone de sécurité des
    icônes « maskable », qu'Android rogne en cercle."""
    n = taille * SS
    marge = int(n * marge_relative)
    utile = n - 2 * marge

    # Trois barres de hauteurs croissantes, alignées sur le bas de la zone utile.
    largeur = int(utile * 0.22)
    ecart = int((utile - 3 * largeur) / 2)
    bas = marge + utile
    hauteurs = [0.45, 0.72, 1.0]
    rayon = largeur // 2

    formes = []
    for i, h in enumerate(hauteurs):
        x0 = marge + i * (largeur + ecart)
        y0 = bas - int(utile * h)
        formes.append((rect_arrondi(x0, y0, x0 + largeur, bas, rayon), BARRES[i]))

    # Rendu par sous-pixel, puis moyenne sur chaque bloc SS x SS.
    lignes = []
    for py in range(taille):
        ligne = bytearray()
        for px in range(taille):
            r = v = b = 0
            for sy in range(SS):
                y = py * SS + sy
                for sx in range(SS):
                    x = px * SS + sx
                    couleur = FOND
                    for dedans, c in formes:
                        if dedans(x, y):
                            couleur = c
                            break
                    r += couleur[0]
                    v += couleur[1]
                    b += couleur[2]
            total = SS * SS
            ligne += bytes((r // total, v // total, b // total))
        lignes.append(bytes(ligne))
    return lignes


def ecrit_png(chemin, lignes):
    brut = b"".join(b"\x00" + ligne for ligne in lignes)
    hauteur = len(lignes)
    largeur = len(lignes[0]) // 3

    def bloc(nom, data):
        contenu = nom + data
        return struct.pack(">I", len(data)) + contenu + struct.pack(">I", zlib.crc32(contenu))

    png = b"\x89PNG\r\n\x1a\n"
    png += bloc(b"IHDR", struct.pack(">IIBBBBB", largeur, hauteur, 8, 2, 0, 0, 0))
    png += bloc(b"IDAT", zlib.compress(brut, 9))
    png += bloc(b"IEND", b"")
    chemin.write_bytes(png)
    print(f"{chemin.name} — {largeur}x{hauteur}, {len(png) // 1024} Ko")


if __name__ == "__main__":
    public = Path(__file__).resolve().parent.parent / "public"
    # Icônes classiques : peu de marge, le motif occupe l'image.
    ecrit_png(public / "icon-192.png", dessine(192, 0.18))
    ecrit_png(public / "icon-512.png", dessine(512, 0.18))
    # Icône « maskable » : Android rogne jusqu'à 20 % de chaque bord.
    ecrit_png(public / "icon-maskable-512.png", dessine(512, 0.28))
    # iOS applique lui-même le masque arrondi et n'accepte que du PNG.
    ecrit_png(public / "apple-touch-icon.png", dessine(180, 0.18))
