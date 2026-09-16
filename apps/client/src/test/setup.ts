import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Sans cela, chaque test hérite du DOM laissé par le précédent, et les
// requêtes par texte trouvent deux éléments au lieu d'un.
afterEach(cleanup);

// Les dates rendues dépendent du fuseau : sans consigne, une machine de CI en
// UTC afficherait un jour d'écart sur les tests de formatage. Le fuseau est
// fixé par le script de test, pas ici, pour rester lisible depuis package.json.
