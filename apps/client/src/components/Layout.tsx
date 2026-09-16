import { Outlet, useLocation } from "react-router-dom";
import { TopBar } from "./TopBar";
import { BottomNav } from "./BottomNav";
import { SideNav } from "./SideNav";
import { ConsentGate } from "./ConsentGate";

export function Layout() {
  const location = useLocation();

  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center sm:py-6 lg:items-stretch lg:py-0">
      {/* Premier élément focusable : sauter la navigation. */}
      <a
        href="#contenu"
        className="lien-evitement rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white"
      >
        Aller au contenu
      </a>

      {/*
       * Deux mises en page, pas une mise à l'échelle.
       *
       * Jusqu'à la tablette, l'application garde son cadre de téléphone —
       * `100dvh` et non `100vh`, la barre d'adresse de Safari rognant sinon la
       * navigation du bas. À partir du grand écran, le cadre disparaît : barre
       * latérale à gauche, contenu large à droite, car deux tiers de l'écran
       * restaient noirs pour rien.
       */}
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-black text-zinc-100 sm:h-[860px] sm:max-h-[92vh] sm:w-[440px] sm:rounded-[2.5rem] sm:border sm:border-bordure sm:shadow-2xl lg:h-[100dvh] lg:max-h-none lg:w-full lg:flex-row lg:rounded-none lg:border-0 lg:shadow-none">
        <SideNav />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <TopBar />
          <main
            id="contenu"
            key={location.pathname}
            className="animate-fade-in-up flex-1 overflow-y-auto px-4 py-5 lg:px-8 lg:py-8"
          >
            {/* Le contenu ne s'étire pas indéfiniment : au-delà, les lignes
                deviennent trop longues pour être lues confortablement. */}
            <div className="mx-auto w-full max-w-3xl lg:max-w-5xl">
              <ConsentGate />
              <Outlet />
            </div>
          </main>
        </div>

        <BottomNav />
      </div>
    </div>
  );
}
