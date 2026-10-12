/**
 * FC moyenne et max de la course de référence, saisies à côté de chaque chrono.
 * Faute de test, elles donnent au coach une estimation du seuil cardiaque
 * bien plus juste qu'un pourcentage de FC max.
 */

export const FC_PAR_DISCIPLINE = {
  tempsNatation: { moy: "fcMoyNatation", max: "fcMaxNatation" },
  tempsVelo: { moy: "fcMoyVelo", max: "fcMaxVelo" },
  tempsCourse: { moy: "fcMoyCourse", max: "fcMaxCourse" },
} as const;

export type CleFcCourse = (typeof FC_PAR_DISCIPLINE)[keyof typeof FC_PAR_DISCIPLINE]["moy" | "max"];

/** Saisie en cours : du texte, pour qu'un champ vide reste vide. */
export type FcCourses = Record<CleFcCourse, string>;

export const FC_COURSES_VIDES: FcCourses = {
  fcMoyNatation: "",
  fcMaxNatation: "",
  fcMoyVelo: "",
  fcMaxVelo: "",
  fcMoyCourse: "",
  fcMaxCourse: "",
};

export function fcCoursesDepuisProfil(profil: Partial<Record<CleFcCourse, number | null>>): FcCourses {
  const valeurs = { ...FC_COURSES_VIDES };
  for (const cle of Object.keys(valeurs) as CleFcCourse[]) {
    const v = profil[cle];
    valeurs[cle] = v ? String(v) : "";
  }
  return valeurs;
}

export function fcCoursesPourApi(fc: FcCourses): Record<CleFcCourse, number | null> {
  const sortie = {} as Record<CleFcCourse, number | null>;
  for (const cle of Object.keys(fc) as CleFcCourse[]) {
    sortie[cle] = fc[cle].trim() === "" ? null : Number(fc[cle]);
  }
  return sortie;
}
