export default function OfflinePage() {
  return (
    <div className="min-h-[100dvh] bg-app px-5 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto flex min-h-[60vh] w-full max-w-2xl items-center justify-center">
        <div className="relative w-full overflow-hidden rounded-[34px] border border-white/10 bg-[linear-gradient(155deg,rgba(13,18,31,0.98),rgba(31,14,42,0.96)_55%,rgba(57,24,13,0.94))] p-8 text-center shadow-[0_32px_90px_rgba(5,4,18,0.55)] sm:p-10">
          <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
          <div className="pointer-events-none absolute left-0 top-12 h-48 w-48 rounded-full bg-fuchsia-400/10 blur-3xl" />
          <div className="pointer-events-none absolute bottom-0 right-0 h-56 w-56 rounded-full bg-orange-400/10 blur-3xl" />
          <div className="relative z-[1] space-y-4">
            <div className="font-display text-[0.72rem] font-semibold uppercase tracking-[0.3em] text-white/55">Offline</div>
            <h1 className="font-display text-3xl font-semibold text-foreground sm:text-4xl">No connection available</h1>
            <p className="mx-auto max-w-md text-sm leading-7 text-white/62 sm:text-base">
              The app cannot reach live services right now. Reconnect to the network, then refresh to continue.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
