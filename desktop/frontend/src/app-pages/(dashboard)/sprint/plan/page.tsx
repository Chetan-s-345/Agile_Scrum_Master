"use client";

import { useEffect } from "react";
import { useRouter } from "@/next-shims/navigation";

export default function SprintPlannerRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/sprint_plan");
  }, [router]);

  return null;
}

