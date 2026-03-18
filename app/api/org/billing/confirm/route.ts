import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "Deprecated endpoint. Use POST /api/org/billing/confirm-payment instead.",
      deprecated: true,
      replacement: "/api/org/billing/confirm-payment",
    },
    { status: 410 }
  );
}
