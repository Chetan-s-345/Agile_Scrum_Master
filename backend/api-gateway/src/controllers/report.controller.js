async function listReports(req, res, next) {
  try {
    const orgPool = req.orgDb;
    if (!orgPool) return res.status(500).json({ error: 'Org DB not attached' });

    const sprintResp = await orgPool.query(
      `SELECT id, name, status, start_date, end_date, planned_points, completed_points
       FROM sprints
       WHERE status IN ('active','completed')
       ORDER BY start_date DESC
       LIMIT 12`
    );

    const sprints = sprintResp.rows || [];
    const velocityHistory = [...sprints]
      .reverse()
      .map((s) => ({
        sprintId: s.id,
        sprint: s.name,
        status: s.status,
        startDate: s.start_date,
        endDate: s.end_date,
        planned: Number(s.planned_points || 0),
        velocity: Number(s.completed_points || 0),
        completionPct:
          s.planned_points && Number(s.planned_points) > 0
            ? Math.round((Number(s.completed_points || 0) / Number(s.planned_points)) * 1000) / 10
            : null,
      }));

    const recentReports = sprints.slice(0, 10).map((s) => ({
      id: s.id,
      name: `${s.name} Report`,
      date: s.end_date || s.start_date,
      type: s.status === 'active' ? 'In-Progress' : 'Sprint Summary',
    }));

    return res.status(200).json({
      velocityHistory,
      reports: recentReports,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listReports,
};
