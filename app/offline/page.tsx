export default function OfflinePage() {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-6 bg-app">
      <div className="w-full max-w-md bg-surface rounded-2xl shadow-card p-6 space-y-3 border border-teal-500 text-center">
        <h1 className="text-2xl font-semibold text-foreground">You are offline</h1>
        <p className="text-sm text-muted">
          No network connection right now. Reconnect and refresh to continue.
        </p>
      </div>
    </div>
  );
}
