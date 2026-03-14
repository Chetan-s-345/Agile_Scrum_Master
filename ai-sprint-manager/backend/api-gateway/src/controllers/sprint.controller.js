function notImplemented(req, res) {
  return res.status(501).json({ error: 'Not implemented' });
}

module.exports = {
  listSprints: notImplemented,
  createSprint: notImplemented,
  planSprint: notImplemented,
  startSprint: notImplemented,
  completeSprint: notImplemented,
  getSprint: notImplemented,
  burndown: notImplemented,
  risk: notImplemented,
};
