function notImplemented(req, res) {
  return res.status(501).json({ error: 'Not implemented' });
}

module.exports = {
  githubWebhook: notImplemented,
};
