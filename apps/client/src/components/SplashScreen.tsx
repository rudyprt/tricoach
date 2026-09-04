import { useEffect, useState } from "react";
import { FaPersonSwimming, FaPersonBiking, FaPersonRunning } from "react-icons/fa6";

const ICONS = [FaPersonSwimming, FaPersonBiking, FaPersonRunning];
const STEP_MS = 1150;
const EXIT_MS = 350;

export function SplashScreen({ onFinish }: { onFinish: () => void }) {
  const [step, setStep] = useState(0);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (step >= ICONS.length - 1) {
      const t = setTimeout(() => setExiting(true), STEP_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStep((s) => s + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [step]);

  useEffect(() => {
    if (!exiting) return;
    const t = setTimeout(onFinish, EXIT_MS);
    return () => clearTimeout(t);
  }, [exiting, onFinish]);

  function skip() {
    setExiting(true);
  }

  const Icon = ICONS[step];

  return (
    <div
      onClick={skip}
      role="presentation"
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black transition-opacity duration-300 ease-out ${
        exiting ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-56 w-56 animate-splash-glow rounded-full bg-rose-600/25 blur-3xl sm:h-72 sm:w-72" />

      <div
        key={step}
        className="pointer-events-none relative animate-splash-icon text-rose-500"
        style={{ filter: "drop-shadow(0 0 22px rgba(244,63,94,0.65))" }}
      >
        <Icon className="h-16 w-16 sm:h-20 sm:w-20" />
      </div>

      <div className="pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2 text-xs font-black italic tracking-widest text-zinc-700">
        TRI<span className="text-rose-900">COACH</span>
      </div>
    </div>
  );
}
