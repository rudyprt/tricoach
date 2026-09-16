import { Outlet, useLocation } from "react-router-dom";
import { TopBar } from "./TopBar";
import { BottomNav } from "./BottomNav";
import { ConsentGate } from "./ConsentGate";

export function Layout() {
  const location = useLocation();

  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center sm:py-6">
      {/* Premier élément focusable : sauter la barre de navigation. */}
      <a
        href="#contenu"
        className="lien-evitement rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white"
      >
        Aller au contenu
      </a>

      {/*
       * `100dvh` et non `100vh` : sur Safari mobile, la barre d'adresse rogne
       * le bas et la navigation se retrouvait hors écran.
       * Sur grand écran, le cadre s'élargit au lieu de laisser les deux tiers
       * de l'écran vides.
       */}
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-black text-zinc-100 sm:h-[860px] sm:max-h-[92vh] sm:w-[440px] sm:rounded-[2.5rem] sm:border sm:border-bordure sm:shadow-2xl lg:w-[680px]">
        <TopBar />
        <main
          id="contenu"
          key={location.pathname}
          className="animate-fade-in-up flex-1 overflow-y-auto px-4 py-5 lg:px-6"
        >
          <ConsentGate />
          <Outlet />
        </main>
        <BottomNav />
      </div>
    </div>
  );
}
