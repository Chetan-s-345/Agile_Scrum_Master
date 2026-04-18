import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "Deprecated endpoint. Use POST /api/org/billing/create-subscription instead.",
      deprecated: true,
      replacement: "/api/org/billing/create-subscription",
    },
    { status: 410 }
  );
}
