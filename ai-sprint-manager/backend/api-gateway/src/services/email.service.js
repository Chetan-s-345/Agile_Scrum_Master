const axios = require('axios');

const { env } = require('../config/env');

function normalizeBaseUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

function isEmailConfigured() {
  return Boolean(env.BREVO_API_KEY && env.EMAIL_FROM);
}

function emailConfigState() {
  return {
    hasBrevoApiKey: Boolean(env.BREVO_API_KEY),
    hasEmailFrom: Boolean(env.EMAIL_FROM),
    from: env.EMAIL_FROM ? String(env.EMAIL_FROM) : null,
    fromName: env.EMAIL_FROM_NAME ? String(env.EMAIL_FROM_NAME) : null,
    replyTo: env.EMAIL_REPLY_TO ? String(env.EMAIL_REPLY_TO) : null,
    nodeEnv: env.NODE_ENV,
  };
}

function normalizeAxiosError(err) {
  const status = err?.response?.status;
  const data = err?.response?.data;
  const message = err?.message || 'Email provider request failed';
  return { status, data, message };
}

function makeEmailNotConfiguredError(context) {
  const state = emailConfigState();
  const missing = [
    state.hasBrevoApiKey ? null : 'BREVO_API_KEY',
    state.hasEmailFrom ? null : 'EMAIL_FROM',
  ].filter(Boolean);

  return Object.assign(
    new Error(`Email service not configured (missing: ${missing.join(', ') || 'unknown'})`),
    {
      code: 'EMAIL_NOT_CONFIGURED',
      statusCode: 500,
      details: {
        ...state,
        context: context || null,
      },
    }
  );
}

async function sendTransactionalEmail({
  to,
  subject,
  htmlContent,
  textContent,
  replyTo,
}) {
  if (!isEmailConfigured()) {
    throw makeEmailNotConfiguredError({ to, subject });
  }

  const sender = {
    email: env.EMAIL_FROM,
    name: env.EMAIL_FROM_NAME || 'AI Sprint Manager',
  };

  const payload = {
    sender,
    to: Array.isArray(to) ? to : [to],
    subject,
    htmlContent,
    ...(textContent ? { textContent } : {}),
    ...(replyTo ? { replyTo } : {}),
  };

  try {
    const resp = await axios.post('https://api.brevo.com/v3/smtp/email', payload, {
      headers: {
        'api-key': env.BREVO_API_KEY,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      timeout: 15000,
    });

    return {
      sent: true,
      provider: 'brevo',
      messageId: resp?.data?.messageId || resp?.data?.message_id || null,
    };
  } catch (err) {
    const norm = normalizeAxiosError(err);
    throw Object.assign(
      new Error(
        `Brevo email send failed${norm.status ? ` (HTTP ${norm.status})` : ''}: ${norm.message}`
      ),
      {
        code: 'EMAIL_SEND_FAILED',
        statusCode: 502,
        details: {
          provider: 'brevo',
          status: norm.status || null,
          response: norm.data || null,
        },
        cause: err,
      }
    );
  }
}

function buildVerifyEmailContent({ fullName, orgName, verifyUrl }) {
  const safeName = fullName ? String(fullName) : '';
  const safeOrg = orgName ? String(orgName) : 'your organization';
  const safeUrl = String(verifyUrl);

  const subject = `Verify your email for ${safeOrg}`;
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <h2>Email verification</h2>
      <p>Hi ${safeName || 'there'},</p>
      <p>Please verify your email to finish setting up ${safeOrg}.</p>
      <p><a href="${safeUrl}">Verify email</a></p>
      <p>If you did not create this account, you can ignore this email.</p>
    </div>
  `;
  const textContent = `Hi ${safeName || 'there'},\n\nVerify your email for ${safeOrg}: ${safeUrl}\n\nIf you did not create this account, ignore this email.`;

  return { subject, htmlContent, textContent };
}

function buildPasswordResetContent({ fullName, resetUrl }) {
  const safeName = fullName ? String(fullName) : '';
  const safeUrl = String(resetUrl);

  const subject = 'Reset your password';
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <h2>Password reset</h2>
      <p>Hi ${safeName || 'there'},</p>
      <p>Use the link below to reset your password.</p>
      <p><a href="${safeUrl}">Reset password</a></p>
      <p>If you did not request this, you can ignore this email.</p>
    </div>
  `;
  const textContent = `Hi ${safeName || 'there'},\n\nReset your password: ${safeUrl}\n\nIf you did not request this, ignore this email.`;

  return { subject, htmlContent, textContent };
}

function buildInvitationContent({ orgName, role, invitedByName, acceptUrl }) {
  const safeOrg = orgName ? String(orgName) : 'an organization';
  const safeRole = role ? String(role) : 'member';
  const safeInviter = invitedByName ? String(invitedByName) : 'Someone';
  const safeUrl = String(acceptUrl);

  const subject = `You’ve been invited to join ${safeOrg}`;
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <h2>Invitation</h2>
      <p>${safeInviter} invited you to join <b>${safeOrg}</b> as <b>${safeRole}</b>.</p>
      <p><a href="${safeUrl}">Accept invitation</a></p>
      <p>If you were not expecting this, you can ignore this email.</p>
    </div>
  `;
  const textContent = `${safeInviter} invited you to join ${safeOrg} as ${safeRole}.\n\nAccept: ${safeUrl}`;

  return { subject, htmlContent, textContent };
}

class EmailService {
  isConfigured() {
    return isEmailConfigured();
  }

  configState() {
    return emailConfigState();
  }

  frontendUrl(path) {
    return `${normalizeBaseUrl(env.FRONTEND_URL)}${path.startsWith('/') ? path : `/${path}`}`;
  }

  async sendVerifyEmail({ toEmail, fullName, orgName, verifyUrl }) {
    const { subject, htmlContent, textContent } = buildVerifyEmailContent({ fullName, orgName, verifyUrl });
    return sendTransactionalEmail({
      to: { email: String(toEmail), name: fullName ? String(fullName) : undefined },
      subject,
      htmlContent,
      textContent,
      replyTo: env.EMAIL_REPLY_TO ? { email: env.EMAIL_REPLY_TO } : undefined,
    });
  }

  async sendPasswordResetEmail({ toEmail, fullName, resetUrl }) {
    const { subject, htmlContent, textContent } = buildPasswordResetContent({ fullName, resetUrl });
    return sendTransactionalEmail({
      to: { email: String(toEmail), name: fullName ? String(fullName) : undefined },
      subject,
      htmlContent,
      textContent,
      replyTo: env.EMAIL_REPLY_TO ? { email: env.EMAIL_REPLY_TO } : undefined,
    });
  }

  async sendInvitationEmail({ toEmail, orgName, role, invitedByName, acceptUrl }) {
    const { subject, htmlContent, textContent } = buildInvitationContent({ orgName, role, invitedByName, acceptUrl });
    return sendTransactionalEmail({
      to: { email: String(toEmail) },
      subject,
      htmlContent,
      textContent,
      replyTo: env.EMAIL_REPLY_TO ? { email: env.EMAIL_REPLY_TO } : undefined,
    });
  }
}

const emailService = new EmailService();

module.exports = { EmailService, emailService };
