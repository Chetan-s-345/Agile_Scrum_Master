const { createMonitors } = require('./monitors');

let _monitors = null;

function startAllAgents() {
  if (_monitors) return _monitors;
  _monitors = createMonitors();
  _monitors.start();
  return _monitors;
}

function getAgentsRuntime() {
  return _monitors;
}

module.exports = {
  startAllAgents,
  getAgentsRuntime,
};
