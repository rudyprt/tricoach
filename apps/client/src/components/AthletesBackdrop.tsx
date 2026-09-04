import { FaPersonSwimming, FaPersonBiking, FaPersonRunning } from "react-icons/fa6";

export function AthletesBackdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-black">
      <div className="absolute -left-32 top-0 h-[38rem] w-[38rem] rounded-full bg-red-600/30 blur-[130px]" />
      <div className="absolute -right-32 top-0 h-[38rem] w-[38rem] rounded-full bg-blue-600/30 blur-[130px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.04)_1px,transparent_0)] bg-[size:32px_32px]" />

      <div className="absolute inset-x-0 top-[8vh] flex items-end justify-center gap-3 sm:gap-6">
        <FaPersonBiking
          className="h-28 w-28 -rotate-6 text-zinc-200 sm:h-40 sm:w-40"
          style={{ filter: "drop-shadow(-16px 4px 24px rgba(220,38,38,0.6))" }}
        />
        <FaPersonSwimming
          className="h-36 w-36 -translate-y-4 text-white sm:h-48 sm:w-48"
          style={{
            filter:
              "drop-shadow(-10px 0 22px rgba(220,38,38,0.55)) drop-shadow(10px 0 22px rgba(37,99,235,0.55))",
          }}
        />
        <FaPersonRunning
          className="h-28 w-28 rotate-6 text-zinc-200 sm:h-40 sm:w-40"
          style={{ filter: "drop-shadow(16px 4px 24px rgba(37,99,235,0.6))" }}
        />
      </div>

      <div className="absolute inset-x-0 bottom-0 h-[70vh] bg-gradient-to-t from-black via-black/85 to-transparent" />
    </div>
  );
}
