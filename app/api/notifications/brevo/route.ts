import { NextResponse } from "next/server";
import { getAuthTokenFromCookies } from "@/lib/api-gateway";
import { sendBrevoEmail } from "@/lib/brevo";

type NotificationRequest = {
  subject?: string;
  message?: string;
  trigger?: string;
};

export async function POST(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json(
      { error: "Unauthorized", code: 401, detail: "Authentication required" },
      { status: 401 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as NotificationRequest;
  const toEmail = process.env.BREVO_NOTIFICATION_TO || "";
  if (!toEmail) {
    return NextResponse.json(
      {
        error: "Brevo recipient missing",
        code: 500,
        detail: "Set BREVO_NOTIFICATION_TO environment variable",
      },
      { status: 500 }
    );
  }

  const subject = body.subject || "Sprint notification";
  const message = body.message || "A notification was triggered from Sprint dashboard.";
  const trigger = body.trigger || "unknown";

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; background:#0d0d0d; color:#ffffff; padding:24px;">
      <h2 style="margin:0 0 12px;">Sprint Notification</h2>
      <p style="margin:0 0 8px;">${message}</p>
      <p style="margin:0; color:#b0b0b0; font-size:12px;">Trigger: ${trigger}</p>
    </div>
  `;

  const result = await sendBrevoEmail({
    toEmail,
    subject,
    htmlContent,
    textContent: `${message} (Trigger: ${trigger})`,
  });

  if ("error" in result) {
    return NextResponse.json(result, { status: result.code });
  }

  return NextResponse.json({ ok: true, code: 200, detail: "Notification email sent" });
}
