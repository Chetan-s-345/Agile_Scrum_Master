const { authService } = require('../services/auth.service');
const {
  registerSchema,
  loginSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} = require('../validators/auth.schemas');

function validationError(res, parsed) {
  const flat = parsed.error.flatten();
  const firstField = Object.entries(flat.fieldErrors || {}).find(([, msgs]) => Array.isArray(msgs) && msgs.length);
  const firstMessage =
    (Array.isArray(flat.formErrors) && flat.formErrors[0]) ||
    (firstField ? `${firstField[0]}: ${firstField[1][0]}` : null) ||
    'Validation error';

  return res.status(400).json({ error: firstMessage, details: flat });
}

async function register(req, res, next) {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);

    const result = await authService.register(parsed.data, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });
    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
}

async function login(req, res, next) {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);

    const result = await authService.login(parsed.data, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);

    const result = await authService.refresh(parsed.data, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function logout(req, res, next) {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!req.user?.sessionId) {
      return res.status(400).json({ error: 'Missing sessionId in token' });
    }

    await authService.logout({ sessionId: req.user.sessionId, userId: req.user.userId });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

async function forgotPassword(req, res, next) {
  try {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);

    await authService.forgotPassword(parsed.data);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);

    await authService.resetPassword(parsed.data);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

async function verifyEmail(req, res, next) {
  try {
    const parsed = verifyEmailSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);

    await authService.verifyEmail(parsed.data);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

async function me(req, res, next) {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Unauthorized' });
    const result = await authService.me({ userId: req.user.userId, orgId: req.user.orgId });
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  verifyEmail,
  me,
};
