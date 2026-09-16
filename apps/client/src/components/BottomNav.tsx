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
      className="shrink-0 border-t border-bordure bg-black"
      /* Sans cette marge, la barre passe sous l'indicateur d'accueil de
         l'iPhone dès que l'application est installée. */
      style={{ paddingBottom: "var(--marge-basse)" }}
    >
      <div className="flex items-stretch justify-around">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex min-h-cible flex-1 flex-col items-center justify-center gap-1 py-2 text-xs font-medium transition-colors duration-200 ${
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
