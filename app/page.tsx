"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../components/AuthProvider";
import AuthEntryForm from "../components/AuthEntryForm";

export default function Page() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (user) router.replace("/room-gate");
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-app flex items-center justify-center">
        <div className="text-sm text-muted">Loading…</div>
      </div>
    );
  }

  if (user) {
    return (
      <div className="min-h-screen bg-app flex items-center justify-center">
        <div className="text-sm text-muted">Loading…</div>
      </div>
    );
  }

  return <AuthEntryForm />;
}
