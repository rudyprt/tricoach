import { NavLink } from "react-router-dom";

const items = [
  { to: "/dashboard", label: "Programme", icon: "📅" },
  { to: "/historique", label: "Historique", icon: "📈" },
  { to: "/chat", label: "Coach IA", icon: "💬" },
  { to: "/zones", label: "Zones", icon: "⚡" },
  { to: "/objectif", label: "Objectif", icon: "🎯" },
];

export function BottomNav() {
  return (
    <nav
      data-impression="masquer"
      aria-label="Navigation principale"
      className="shrink-0 border-t border-bordure bg-black lg:hidden"
    >
      <div className="flex items-stretch justify-around">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            /*
             * La bande de l'indicateur d'accueil appartient aux liens, et non
             * à la barre : portée par le parent, elle formait en bas de l'écran
             * une trentaine de pixels qui ne répondaient à aucun geste, juste
             * là où le pouce arrive.
             */
            style={{ paddingBottom: "calc(0.5rem + var(--marge-basse))" }}
            className={({ isActive }) =>
              `flex min-h-cible flex-1 flex-col items-center justify-center gap-1 pt-2 text-xs font-medium transition-colors duration-200 ${
                isActive ? "text-accent-clair" : "text-doux hover:text-fort"
              }`
            }
          >
            <span className="text-lg leading-none" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
