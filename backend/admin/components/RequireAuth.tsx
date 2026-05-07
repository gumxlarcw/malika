"use client";
import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user && typeof window !== "undefined") {
      // Use Next navigation so basePath is applied correctly
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="w-full min-h-[60vh] flex items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/60 border-t-transparent" />
          <span>Memeriksa sesi…</span>
        </div>
      </div>
    );
  }
  if (!user) {
    return null; // redirecting
  }
  return <>{children}</>;
}
