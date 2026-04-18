type BrevoEmailPayload = {
  toEmail: string;
  toName?: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
};

type BrevoError = {
  error: string;
  code: number;
  detail: string;
};

function getBrevoConfig() {
  const apiKey = process.env.BREVO_API_KEY || "";
  const senderEmail = process.env.BREVO_SENDER_EMAIL || "";
  const senderName = process.env.BREVO_SENDER_NAME || "Sprint";
  return { apiKey, senderEmail, senderName };
}

export async function sendBrevoEmail(payload: BrevoEmailPayload): Promise<{ ok: true } | BrevoError> {
  const { apiKey, senderEmail, senderName } = getBrevoConfig();
  if (!apiKey || !senderEmail) {
    return {
      error: "Brevo configuration missing",
      code: 500,
      detail: "Set BREVO_API_KEY and BREVO_SENDER_EMAIL environment variables",
    };
  }

  const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName },
      to: [{ email: payload.toEmail, name: payload.toName || payload.toEmail }],
      subject: payload.subject,
      htmlContent: payload.htmlContent,
      textContent: payload.textContent || payload.subject,
    }),
    cache: "no-store",
  });

  if (!resp.ok) {
    const data = await resp.json().catch(() => null) as { message?: string } | null;
    return {
      error: "Brevo send failed",
      code: resp.status,
      detail: String(data?.message || "Unable to send notification email"),
    };
  }

  return { ok: true };
}
