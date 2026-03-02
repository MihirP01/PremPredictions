"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "../components/AuthProvider";
import AuthEntryForm from "../components/AuthEntryForm";

function LoadingDeck() {
  return (
    <div className="min-h-screen bg-app px-5 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto flex min-h-[60vh] w-full max-w-2xl items-center justify-center rounded-[34px] border border-white/10 bg-[linear-gradient(155deg,rgba(13,18,31,0.98),rgba(31,14,42,0.96)_55%,rgba(57,24,13,0.94))] px-6 text-sm text-white/65 shadow-[0_32px_90px_rgba(5,4,18,0.55)]">
        <span className="inline-flex items-center gap-2 font-display text-[0.78rem] font-semibold uppercase tracking-[0.24em]">
          <Loader2 size={16} className="animate-spin" />
          Loading Session
        </span>
      </div>
    </div>
  );
}

export default function Page() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (user) router.replace("/room-gate");
  }, [loading, user, router]);

  if (loading) return <LoadingDeck />;
  if (user) return <LoadingDeck />;
  return <AuthEntryForm />;
}
