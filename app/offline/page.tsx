export default function OfflinePage() {
  return (
    <div className="min-h-[100dvh] bg-app px-5 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto flex min-h-[60vh] w-full max-w-2xl items-center justify-center">
        <div className="relative w-full overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(9,18,34,0.98),rgba(11,24,41,0.96))] p-8 text-center shadow-[0_24px_56px_rgba(3,8,20,0.4)] sm:p-10">
          <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent" />
          <div className="relative z-[1] space-y-4">
            <div className="font-display text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-white/50">
              Offline
            </div>
            <h1 className="font-display text-3xl font-semibold text-foreground sm:text-4xl">
              You are offline
            </h1>
            <p className="mx-auto max-w-md text-sm leading-7 text-white/58 sm:text-base">
              No network connection right now. Reconnect and refresh to
              continue.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
