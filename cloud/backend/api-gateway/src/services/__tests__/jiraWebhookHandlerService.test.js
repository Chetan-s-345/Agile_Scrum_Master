function setMinimumEnv() {
  process.env.NODE_ENV = 'test';
  process.env.UNIVERSAL_DATABASE_URL =
    process.env.UNIVERSAL_DATABASE_URL || 'postgresql://user:pass@localhost:5432/postgres';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(32);
  process.env.REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'y'.repeat(32);
}

describe('jiraWebhookHandlerService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('jira:issue_updated parses changelog and calls taskService per field (with error boundary)', async () => {
    setMinimumEnv();

    jest.resetModules();

    const updateAssignee = jest.fn().mockResolvedValue({ ok: true });
    const updateStatus = jest.fn().mockRejectedValue(new Error('boom'));
    const updateStoryPoints = jest.fn().mockResolvedValue({ ok: true });

    jest.doMock('../task.service', () => ({
      taskService: { updateAssignee, updateStatus, updateStoryPoints },
    }));
    jest.doMock('../sprint.service', () => ({ sprintService: { completeSprintFlow: jest.fn() } }));

    const svc = require('../jiraWebhookHandlerService');

    const orgPool = { query: jest.fn() };
    const payload = {
      webhookEvent: 'jira:issue_updated',
      issue: { key: 'ABC-123' },
      changelog: {
        items: [
          { field: 'assignee', to: 'jira-account-1' },
          { field: 'status', toString: 'In Progress' },
          { fieldId: 'customfield_10016', toString: '8' },
        ],
      },
    };

    const resp = await svc.handleJiraWebhookEvent(orgPool, 'jira:issue_updated', payload);
    expect(resp.ok).toBe(true);

    expect(updateAssignee).toHaveBeenCalledWith('ABC-123', 'jira-account-1', orgPool);
    expect(updateStatus).toHaveBeenCalledWith('ABC-123', 'In Progress', orgPool);
    expect(updateStoryPoints).toHaveBeenCalledWith('ABC-123', '8', orgPool);

    // Status failure should not prevent story points call
    expect(updateStoryPoints).toHaveBeenCalledTimes(1);
  });

  test('jira:issue_created with sprint field inserts/upserts into tasks', async () => {
    setMinimumEnv();
    jest.resetModules();

    jest.doMock('../task.service', () => ({ taskService: {} }));
    jest.doMock('../sprint.service', () => ({ sprintService: { completeSprintFlow: jest.fn() } }));

    const svc = require('../jiraWebhookHandlerService');

    const orgPool = {
      query: jest
        .fn()
        // sprints lookup
        .mockResolvedValueOnce({ rows: [{ id: 'local-sprint-1', project_id: 'proj-1' }] })
        // insert task
        .mockResolvedValueOnce({ rows: [] }),
    };

    const payload = {
      webhookEvent: 'jira:issue_created',
      issue: {
        id: '10001',
        key: 'ABC-9',
        fields: {
          summary: 'My issue',
          description: { type: 'doc' },
          issuetype: { name: 'Task' },
          priority: { name: 'High' },
          labels: ['node'],
          customfield_10016: 5,
          customfield_10020: [{ id: 77 }],
          project: { key: 'ABC' },
        },
      },
    };

    const resp = await svc.handleJiraWebhookEvent(orgPool, 'jira:issue_created', payload);
    expect(resp).toMatchObject({ ok: true, created: 'task', jiraIssueKey: 'ABC-9', jiraSprintId: '77' });

    const insertSql = orgPool.query.mock.calls[1][0];
    expect(insertSql).toMatch(/INSERT INTO tasks/i);
    expect(insertSql).toMatch(/ON CONFLICT \(jira_issue_id\)/i);
  });

  test('sprint_completed calls sprintService.completeSprintFlow for matching local sprint', async () => {
    setMinimumEnv();
    jest.resetModules();

    const completeSprintFlow = jest.fn().mockResolvedValue({ ok: true, changed: true });

    jest.doMock('../task.service', () => ({ taskService: {} }));
    jest.doMock('../sprint.service', () => ({ sprintService: { completeSprintFlow } }));

    const svc = require('../jiraWebhookHandlerService');

    const orgPool = {
      query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 'local-sprint-99' }] }),
    };

    const payload = { sprint: { id: 999 } };

    const resp = await svc.handleJiraWebhookEvent(orgPool, 'sprint_completed', payload);
    expect(resp.ok).toBe(true);
    expect(completeSprintFlow).toHaveBeenCalledWith('local-sprint-99', orgPool);
  });
});
