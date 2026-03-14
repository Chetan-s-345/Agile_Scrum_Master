const axios = require('axios');

const { env } = require('../config/env');

function normalizeBaseUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

function isEmailConfigured() {
  return Boolean(env.BREVO_API_KEY && env.EMAIL_FROM);
}

async function sendTransactionalEmail({
  to,
  subject,
  htmlContent,
  textContent,
  replyTo,
}) {
  if (!isEmailConfigured()) {
    if (env.NODE_ENV !== 'production') {
      console.log('[dev] Email delivery skipped (BREVO_API_KEY/EMAIL_FROM not set):', { to, subject });
    }
    return { skipped: true };
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

  await axios.post('https://api.brevo.com/v3/smtp/email', payload, {
    headers: {
      'api-key': env.BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    timeout: 15000,
  });

  return { sent: true };
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
