const { githubAutoTaskService } = require('../services/githubAutoTaskService');

function errorBody(message, code, detail) {
  return { error: message, code, detail };
}

async function getAutoTaskRules(req, res) {
  try {
    if (!req.orgDb) {
      return res.status(400).json(errorBody('Missing organization context', 400, 'Organization database not available in request'));
    }

    const rules = await githubAutoTaskService.getRules(req.orgDb);
    return res.status(200).json({ success: true, data: rules });
  } catch (err) {
    return res.status(500).json(errorBody('Failed to load auto-task rules', 500, err?.message || 'Unknown error'));
  }
}

async function saveAutoTaskRules(req, res) {
  try {
    if (!req.orgDb) {
      return res.status(400).json(errorBody('Missing organization context', 400, 'Organization database not available in request'));
    }

    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const rules = await githubAutoTaskService.saveRules(req.orgDb, payload);

    return res.status(200).json({
      success: true,
      message: 'Auto-task rules saved successfully',
      data: rules,
    });
  } catch (err) {
    return res.status(500).json(errorBody('Failed to save auto-task rules', 500, err?.message || 'Unknown error'));
  }
}

module.exports = {
  getAutoTaskRules,
  saveAutoTaskRules,
};
