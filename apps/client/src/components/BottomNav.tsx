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
    <nav data-impression="masquer" className="shrink-0 border-t border-zinc-900 bg-black">
      <div className="flex items-stretch justify-around">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors duration-200 ${
                isActive ? "text-red-500" : "text-zinc-500 hover:text-zinc-300"
              }`
            }
          >
            <span className="text-lg leading-none">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
