import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "Deprecated endpoint. Use POST /api/org/billing/apply-coupon instead.",
      deprecated: true,
      replacement: "/api/org/billing/apply-coupon",
    },
    { status: 410 }
  );
}
