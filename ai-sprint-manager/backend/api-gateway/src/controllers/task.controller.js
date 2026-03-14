function notImplemented(req, res) {
  return res.status(501).json({ error: 'Not implemented' });
}

module.exports = {
  listTasks: notImplemented,
  createTask: notImplemented,
  updateStatus: notImplemented,
  updateTask: notImplemented,
  deleteTask: notImplemented,
  addComment: notImplemented,
  listComments: notImplemented,
};
