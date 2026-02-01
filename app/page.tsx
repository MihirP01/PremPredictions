"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../components/AuthProvider";

export default function Page() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? "/room-gate" : "/login");
  }, [loading, user, router]);

  return (
    <div className="min-h-screen bg-app flex items-center justify-center">
      <div className="text-sm text-muted">Loading…</div>
    </div>
  );
}
