import { Outlet, useLocation } from "react-router-dom";
import { TopBar } from "./TopBar";
import { BottomNav } from "./BottomNav";

export function Layout() {
  const location = useLocation();

  return (
    <div className="flex min-h-screen w-full items-center justify-center sm:py-6">
      <div className="flex h-screen w-full flex-col overflow-hidden bg-black text-zinc-100 sm:h-[820px] sm:max-h-[92vh] sm:w-[420px] sm:rounded-[2.5rem] sm:border sm:border-zinc-800 sm:shadow-2xl">
        <TopBar />
        <div key={location.pathname} className="animate-fade-in-up flex-1 overflow-y-auto px-4 py-5">
          <Outlet />
        </div>
        <BottomNav />
      </div>
    </div>
  );
}
