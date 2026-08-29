"use client";

import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import PasswordResetScreen from "@/components/PasswordResetScreen";

function ResetFallback() {
  return (
    <div className="min-h-[100dvh] bg-app px-5 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto flex min-h-[calc(100dvh-3rem)] w-full max-w-md items-center justify-center">
        <span className="inline-flex items-center gap-2 text-sm text-white/60">
          <Loader2 size={16} className="animate-spin" />
          Checking link
        </span>
      </div>
    </div>
  );
}

export default function ResetPage() {
  return (
    <Suspense fallback={<ResetFallback />}>
      <PasswordResetScreen />
    </Suspense>
  );
}
