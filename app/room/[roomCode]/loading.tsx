export default function RoomRouteLoading() {
  return (
    <main
      className="mx-auto w-full max-w-6xl px-4 pb-28 pt-5 sm:px-6 sm:pt-7"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex items-center gap-2.5 font-display text-sm font-semibold tracking-[0.04em] text-white/70">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--room-accent)] shadow-[0_0_14px_var(--room-accent)]" />
        Opening page…
      </div>

      <div className="mt-5 space-y-4" aria-hidden="true">
        <div className="h-24 animate-pulse rounded-[24px] border border-white/8 bg-white/[0.025]" />
        <div className="h-52 animate-pulse rounded-[24px] border border-white/8 bg-white/[0.02]" />
        <div className="h-36 animate-pulse rounded-[24px] border border-white/8 bg-white/[0.018]" />
      </div>
    </main>
  );
}
