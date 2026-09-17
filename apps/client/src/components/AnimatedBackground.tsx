export function AnimatedBackground() {
  return (
    <div data-impression="masquer" className="fixed inset-0 -z-10 overflow-hidden bg-black">
      <div className="absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-red-600/10 blur-[120px] animate-float-slow" />
      <div className="absolute -right-32 top-1/3 h-[28rem] w-[28rem] rounded-full bg-red-900/15 blur-[120px] animate-float-slower" />
      <div className="absolute bottom-[-10rem] left-1/4 h-[26rem] w-[26rem] rounded-full bg-zinc-800/20 blur-[120px] animate-float-slow" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.04)_1px,transparent_0)] bg-[size:32px_32px] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_85%)]" />
    </div>
  );
}
