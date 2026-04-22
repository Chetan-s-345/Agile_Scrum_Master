const cron = require('node-cron');

const { db } = require('../config/database');
const { logger } = require('../middleware/logger');
const { scheduleSprintMeetings } = require('../services/scheduler.service');

let _task = null;
let _running = false;

async function runSprintSchedulerPass() {
  if (_running) return;
  _running = true;

  try {
    const orgsResp = await db.universalPool.query(
      `SELECT id
       FROM organizations
       WHERE db_connection_string IS NOT NULL`
    );

    for (const org of orgsResp.rows || []) {
      const orgId = String(org.id);

      try {
        const orgPool = await db.getOrgPool(orgId);
        const sprintsResp = await orgPool.query(
          `SELECT id, project_id, start_date, end_date, name
           FROM sprints
           WHERE start_date = CURRENT_DATE
             AND status IN ('planning', 'active')`
        );

        for (const sprint of sprintsResp.rows || []) {
          try {
            await scheduleSprintMeetings(orgId, sprint);
          } catch (err) {
            logger.warn({ err, orgId, sprintId: sprint.id }, 'Failed to auto-schedule sprint meetings');
          }
        }
      } catch (err) {
        logger.warn({ err, orgId }, 'Skipping sprint schedule pass for org due to db issue');
      }
    }
  } catch (err) {
    logger.error({ err }, 'Sprint scheduler pass failed');
  } finally {
    _running = false;
  }
}

function startSprintSchedulerJob() {
  if (_task) return _task;

  _task = cron.schedule('0 7 * * *', () => {
    void runSprintSchedulerPass();
  });

  return _task;
}

function stopSprintSchedulerJob() {
  if (!_task) return;
  _task.stop();
  _task = null;
}

module.exports = {
  startSprintSchedulerJob,
  stopSprintSchedulerJob,
  runSprintSchedulerPass,
};
