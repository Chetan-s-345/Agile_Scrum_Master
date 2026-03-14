function notImplemented(req, res) {
  return res.status(501).json({ error: 'Not implemented' });
}

module.exports = {
  listProjects: notImplemented,
  createProject: notImplemented,
  getProject: notImplemented,
  updateProject: notImplemented,
  addMember: notImplemented,
  removeMember: notImplemented,
  listEpics: notImplemented,
  createEpic: notImplemented,
};
