"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import type { Role } from "@/types";

/**
 * Client-side guard: redirects anonymous visitors to the login page.
 * This is a UX convenience only. The real protection is on the API,
 * which rejects every unauthenticated or unauthorized request.
 */
export function useRequireAuth(role?: Role) {
  const { user, status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "anonymous") router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (status === "authenticated" && role && user?.role !== role) router.replace("/polls");
  }, [status, user, role, router, pathname]);

  const allowed = status === "authenticated" && (!role || user?.role === role);
  return { user, ready: allowed };
}
