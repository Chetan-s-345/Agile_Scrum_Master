import { redirect } from "@/next-shims/navigation";

export default function SprintPlannerRedirectPage() {
  redirect("/sprint_plan");
  return null;
}
