"use client";

// A branded loading indicator: the MGP logo gently bobs while a green arc
// sweeps around it and a soft ring pulses outward.
export default function LoadingLogo({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative flex h-28 w-28 items-center justify-center">
        {/* pulsing halo */}
        <span className="absolute h-24 w-24 rounded-full bg-workshop-500/20 [animation:mgp-pulse-ring_1.8s_ease-out_infinite]" />
        {/* sweeping arc */}
        <span className="absolute inset-0 rounded-full border-4 border-transparent border-t-workshop-500 border-r-workshop-500/50 [animation:mgp-spin_1s_linear_infinite]" />
        {/* counter-rotating faint inner arc */}
        <span className="absolute inset-2 rounded-full border-2 border-transparent border-b-workshop-700/40 [animation:mgp-spin-reverse_1.6s_linear_infinite]" />
        {/* the logo, bobbing */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.svg"
          alt="Manufacturing Green Products"
          className="relative h-[72px] w-[72px] rounded-full shadow-panel [animation:mgp-bob_1.6s_ease-in-out_infinite]"
        />
      </div>
      <p className="mgp-dots text-sm font-black uppercase tracking-wide text-workshop-700">{label}</p>
    </div>
  );
}
