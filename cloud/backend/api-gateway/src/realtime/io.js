let io = null;

function setIo(serverIo) {
  io = serverIo;
}

function getIo() {
  return io;
}

function projectRoom(projectId) {
  return `project:${String(projectId || "").trim()}`;
}

function emitToProject(projectId, event, payload) {
  if (!io || !projectId) return;
  io.to(projectRoom(projectId)).emit(String(event), payload || {});
}

module.exports = {
  setIo,
  getIo,
  projectRoom,
  emitToProject,
};
