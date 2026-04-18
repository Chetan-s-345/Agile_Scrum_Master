"use client";

import { useEffect } from "react";
import SprintPlanPageImpl from "../sprint-plan/SprintPlanPageImpl";

export default function SprintPlanLegacyAliasPage() {
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.warn("[deprecated-route] /sprint_plan is deprecated. Use /sprint-plan instead.");
    }
  }, []);

  return <SprintPlanPageImpl />;
}

