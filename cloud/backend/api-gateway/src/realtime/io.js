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

function orgRoom(orgId) {
  return `org:${String(orgId || "").trim()}`;
}

function emitToProject(projectId, event, payload) {
  if (!io || !projectId) return;
  io.to(projectRoom(projectId)).emit(String(event), payload || {});
}

function emitToOrg(orgId, event, payload) {
  if (!io || !orgId) return;
  io.to(orgRoom(orgId)).emit(String(event), payload || {});
}

module.exports = {
  setIo,
  getIo,
  orgRoom,
  projectRoom,
  emitToOrg,
  emitToProject,
};
