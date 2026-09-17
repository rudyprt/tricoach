import { NavLink, useNavigate } from "react-router-dom";
import {
  FaCalendarDays,
  FaChartLine,
  FaComments,
  FaBolt,
  FaFlagCheckered,
  FaGear,
  FaRightFromBracket,
  FaShieldHalved,
} from "react-icons/fa6";
import { useAuth } from "../lib/AuthContext";
import { avatarUrl } from "../lib/api";

const ENTREES = [
  { to: "/dashboard", label: "Programme", Icone: FaCalendarDays },
  { to: "/historique", label: "Historique", Icone: FaChartLine },
  { to: "/chat", label: "Coach IA", Icone: FaComments },
  { to: "/zones", label: "Zones", Icone: FaBolt },
  { to: "/objectif", label: "Objectif", Icone: FaFlagCheckered },
];

/**
 * Navigation latérale, affichée à partir des grands écrans.
 *
 * Sur ordinateur, l'application se réduisait à un cadre de téléphone au milieu
 * d'une page noire : les deux tiers de l'écran ne servaient à rien, alors qu'une
 * semaine d'entraînement s'y lit bien mieux qu'en colonne unique. Les icônes
 * sont ici vectorielles, et non en émojis comme sur la barre du bas, dont le
 * rendu varie d'un système à l'autre.
 */
export function SideNav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const photo = avatarUrl(user);

  async function deconnexion() {
    await logout();
    navigate("/login");
  }

  return (
    <nav
      data-impression="masquer"
      aria-label="Navigation principale"
      className="hidden w-60 shrink-0 flex-col border-r border-bordure bg-fond px-3 py-5 lg:flex"
    >
      <button
        onClick={() => navigate("/dashboard")}
        className="mb-7 px-2 text-left text-xl font-black italic tracking-wide text-fort"
      >
        TRI<span className="text-accent">COACH</span>
      </button>

      <ul className="flex flex-1 flex-col gap-1">
        {ENTREES.map(({ to, label, Icone }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                `flex min-h-cible items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-accent-sombre/25 text-accent-clair"
                    : "text-doux hover:bg-surface hover:text-fort"
                }`
              }
            >
              <Icone size={15} aria-hidden="true" />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="mt-4 border-t border-bordure pt-3">
        <NavLink
          to="/compte"
          className={({ isActive }) =>
            `flex min-h-cible items-center gap-2.5 rounded-xl px-2 text-sm transition-colors ${
              isActive ? "bg-surface text-fort" : "text-doux hover:bg-surface hover:text-fort"
            }`
          }
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent text-xs font-bold text-white">
            {photo ? (
              <img src={photo} alt="" className="h-full w-full object-cover" />
            ) : (
              user?.name?.[0]?.toUpperCase() ?? "?"
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-left">{user?.name ?? "Mon compte"}</span>
          {user && !user.emailVerified && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-attention"
              title="Adresse e-mail non confirmée"
            />
          )}
        </NavLink>

        {user?.role === "admin" && (
          <NavLink
            to="/admin"
            className="flex min-h-cible items-center gap-3 rounded-xl px-3 text-sm text-attention transition-colors hover:bg-surface"
          >
            <FaShieldHalved size={14} aria-hidden="true" />
            Administration
          </NavLink>
        )}

        <NavLink
          to="/abonnement"
          className="flex min-h-cible items-center gap-3 rounded-xl px-3 text-sm text-doux transition-colors hover:bg-surface hover:text-fort"
        >
          <FaGear size={14} aria-hidden="true" />
          Mon abonnement
        </NavLink>

        <button
          onClick={() => void deconnexion()}
          className="flex min-h-cible w-full items-center gap-3 rounded-xl px-3 text-sm text-danger transition-colors hover:bg-surface"
        >
          <FaRightFromBracket size={14} aria-hidden="true" />
          Déconnexion
        </button>
      </div>
    </nav>
  );
}
