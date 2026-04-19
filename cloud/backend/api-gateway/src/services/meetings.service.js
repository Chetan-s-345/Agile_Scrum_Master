const crypto = require('node:crypto');

const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_MEET_JOIN_URL_REGEX = /^https:\/\/meet\.google\.com\/[a-z0-9-]{3,64}(?:[/?#].*)?$/i;
let runtimePreferredCalendarId = null;

function toBase64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function parseJsonDetailed(value) {
  try {
    return { value: JSON.parse(value), error: null };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : 'Invalid JSON' };
  }
}

function isGroupCalendarId(calendarId) {
  return /@group\.calendar\.google\.com$/i.test(String(calendarId || '').trim());
}

function unwrapQuotedEnv(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function isValidGoogleMeetJoinUrl(value) {
  const raw = String(value || '').trim();
  return GOOGLE_MEET_JOIN_URL_REGEX.test(raw);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDbTimestamp(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(
    date.getMinutes()
  )}:${pad2(date.getSeconds())}`;
}

function formatClientTimestamp(value) {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return formatDbTimestamp(value);
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const localMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (localMatch) {
    const [, y, m, d, hh, mm, ss] = localMatch;
    return `${y}-${m}-${d} ${hh}:${mm}:${ss || '00'}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return formatDbTimestamp(parsed);
}

function getGoogleMeetConfig() {
  const rawJson = String(process.env.GOOGLE_MEET_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  const parsedJson = rawJson ? parseJsonDetailed(rawJson) : { value: null, error: null };
  if (rawJson && parsedJson.error) {
    throw Object.assign(new Error('Google Meet service-account JSON is invalid'), {
      statusCode: 400,
      code: 'GOOGLE_MEET_CONFIG_INVALID_JSON',
      detail: 'GOOGLE_MEET_SERVICE_ACCOUNT_JSON is not valid JSON. Fix the JSON or use GOOGLE_MEET_SERVICE_ACCOUNT_EMAIL and GOOGLE_MEET_SERVICE_ACCOUNT_PRIVATE_KEY.',
      hint: 'Provide a valid JSON key or set individual GOOGLE_MEET_SERVICE_ACCOUNT_* variables.',
    });
  }

  const parsed = parsedJson.value || null;
  const clientEmail = String(
    parsed?.client_email || process.env.GOOGLE_MEET_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || ''
  ).trim();
  const privateKeyRaw = unwrapQuotedEnv(
    parsed?.private_key || process.env.GOOGLE_MEET_SERVICE_ACCOUNT_PRIVATE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || ''
  );
  const calendarId = String(process.env.GOOGLE_MEET_CALENDAR_ID || parsed?.calendar_id || '').trim();
  const missing = [
    !clientEmail && 'GOOGLE_MEET_SERVICE_ACCOUNT_EMAIL',
    !privateKeyRaw && 'GOOGLE_MEET_SERVICE_ACCOUNT_PRIVATE_KEY',
    !calendarId && 'GOOGLE_MEET_CALENDAR_ID',
  ].filter(Boolean);

  if (missing.length) {
    const detail =
      'Google Meet service account not fully configured. Missing: ' + missing.join(', ');
    throw Object.assign(new Error(detail), {
      statusCode: 400,
      code: 'GOOGLE_MEET_CONFIG_MISSING',
      detail,
      hint: 'Set all required GOOGLE_MEET_* variables in api-gateway .env and restart the gateway.',
    });
  }

  return {
    clientEmail,
    privateKey: privateKeyRaw.replace(/\\n/g, '\n'),
    calendarId,
    impersonateUser: String(process.env.GOOGLE_MEET_IMPERSONATE_USER || '').trim() || null,
  };
}

function getGoogleMeetConfigSnapshot() {
  const rawJson = String(process.env.GOOGLE_MEET_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  const parsedJson = rawJson ? parseJsonDetailed(rawJson) : { value: null, error: null };
  const parsed = parsedJson.value || null;
  const email = String(
    parsed?.client_email || process.env.GOOGLE_MEET_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || ''
  ).trim();
  const privateKeyRaw = unwrapQuotedEnv(
    parsed?.private_key || process.env.GOOGLE_MEET_SERVICE_ACCOUNT_PRIVATE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || ''
  );
  const calendarId = String(process.env.GOOGLE_MEET_CALENDAR_ID || parsed?.calendar_id || '').trim();

  return {
    configured: Boolean(email && privateKeyRaw && calendarId && !(rawJson && parsedJson.error)),
    emailSet: Boolean(email),
    privateKeySet: Boolean(privateKeyRaw),
    calendarIdSet: Boolean(calendarId),
    calendarId,
  };
}

function buildServiceAccountAssertion(config) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: config.clientEmail,
    scope: 'https://www.googleapis.com/auth/calendar.events',
    aud: GOOGLE_OAUTH_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  if (config.impersonateUser) payload.sub = config.impersonateUser;

  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();

  const signature = signer.sign(config.privateKey);
  return `${unsignedToken}.${toBase64Url(signature)}`;
}

async function getGoogleAccessToken(config) {
  const assertion = buildServiceAccountAssertion(config);
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const resp = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const payload = await resp.json().catch(() => null);
  if (!resp.ok || !payload?.access_token) {
    throw Object.assign(new Error('Failed to authenticate Google Meet integration'), {
      statusCode: 502,
      code: 'GOOGLE_MEET_AUTH_FAILED',
      detail: String(payload?.error_description || payload?.error || 'Google OAuth token request failed'),
    });
  }

  return String(payload.access_token);
}

function parseTimecodeToSeconds(rawValue) {
  const raw = String(rawValue || '').trim().replace(',', '.');
  if (!raw) return null;

  const parts = raw.split(':').map((part) => part.trim());
  if (!parts.every(Boolean)) return null;

  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    const total = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
    return Number.isFinite(total) ? Math.max(0, total) : null;
  }

  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    const total = Number(minutes) * 60 + Number(seconds);
    return Number.isFinite(total) ? Math.max(0, total) : null;
  }

  return null;
}

function extractSpeakerAndText(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return { speaker: null, text: '' };

  const vttSpeaker = text.match(/^<v\s+([^>]+)>([\s\S]*)$/i);
  if (vttSpeaker) {
    return {
      speaker: vttSpeaker[1].trim() || null,
      text: vttSpeaker[2].replace(/<[^>]+>/g, '').trim(),
    };
  }

  const colonSpeaker = text.match(/^([^:\n]{1,60}):\s+([\s\S]+)$/);
  if (colonSpeaker) {
    return {
      speaker: colonSpeaker[1].trim(),
      text: colonSpeaker[2].trim(),
    };
  }

  return { speaker: null, text };
}

function parseSrtSegments(transcriptText) {
  const blocks = String(transcriptText || '').split(/\r?\n\r?\n+/).map((block) => block.trim()).filter(Boolean);
  const segments = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) continue;

    const timelineIndex = lines.findIndex((line) => line.includes('-->'));
    if (timelineIndex < 0) continue;

    const timeline = lines[timelineIndex];
    const [rawStart, rawEnd] = timeline.split('-->').map((item) => item.trim());
    const start = parseTimecodeToSeconds(rawStart);
    const end = parseTimecodeToSeconds(rawEnd);
    const content = lines.slice(timelineIndex + 1).join(' ').trim();
    if (!content) continue;

    const parsed = extractSpeakerAndText(content);
    segments.push({
      speaker: parsed.speaker,
      start,
      end,
      text: parsed.text,
    });
  }

  return segments;
}

function parseVttSegments(transcriptText) {
  const lines = String(transcriptText || '').split(/\r?\n/);
  const segments = [];

  let idx = 0;
  while (idx < lines.length) {
    const line = String(lines[idx] || '').trim();
    if (!line || /^WEBVTT/i.test(line) || /^NOTE\b/i.test(line) || /^STYLE\b/i.test(line) || /^REGION\b/i.test(line)) {
      idx += 1;
      continue;
    }

    let timeline = line;
    if (!timeline.includes('-->') && idx + 1 < lines.length) {
      const next = String(lines[idx + 1] || '').trim();
      if (next.includes('-->')) {
        timeline = next;
        idx += 1;
      }
    }

    if (!timeline.includes('-->')) {
      idx += 1;
      continue;
    }

    const [rawStart, rawEndWithMeta] = timeline.split('-->').map((item) => item.trim());
    const rawEnd = String(rawEndWithMeta || '').split(/\s+/)[0] || '';
    const start = parseTimecodeToSeconds(rawStart);
    const end = parseTimecodeToSeconds(rawEnd);

    idx += 1;
    const textLines = [];
    while (idx < lines.length) {
      const cueLine = String(lines[idx] || '');
      if (!cueLine.trim()) break;
      textLines.push(cueLine.trim());
      idx += 1;
    }

    const content = textLines.join(' ').trim();
    if (content) {
      const parsed = extractSpeakerAndText(content);
      segments.push({
        speaker: parsed.speaker,
        start,
        end,
        text: parsed.text,
      });
    }

    idx += 1;
  }

  return segments;
}

function inferTranscriptFormat({ fileName, mimeType, transcriptText }) {
  const name = String(fileName || '').toLowerCase();
  const mime = String(mimeType || '').toLowerCase();
  const source = String(transcriptText || '');

  if (name.endsWith('.vtt') || mime.includes('text/vtt') || /^\s*WEBVTT\b/i.test(source)) return 'vtt';
  if (name.endsWith('.srt') || mime.includes('application/x-subrip') || /-->/.test(source)) return 'srt';
  return 'plain';
}

function normalizeTranscriptInput({ transcriptText, fileName, mimeType, speakerSegments }) {
  if (Array.isArray(speakerSegments) && speakerSegments.length) {
    return {
      transcriptText: String(transcriptText || '').trim(),
      speakerSegments,
    };
  }

  const format = inferTranscriptFormat({ fileName, mimeType, transcriptText });
  if (format === 'plain') {
    return {
      transcriptText: String(transcriptText || '').trim(),
      speakerSegments: [],
    };
  }

  const parsedSegments = format === 'vtt' ? parseVttSegments(transcriptText) : parseSrtSegments(transcriptText);
  const normalizedText = parsedSegments.map((item) => item.text).filter(Boolean).join('\n').trim() || String(transcriptText || '').trim();

  return {
    transcriptText: normalizedText,
    speakerSegments: parsedSegments,
  };
}

async function createGoogleMeetConference({ title, description, scheduledStart, scheduledEnd }) {
  try {
    const config = getGoogleMeetConfig();
    const accessToken = await getGoogleAccessToken(config);
    const start = scheduledStart ? new Date(scheduledStart) : new Date();
    const safeStart = Number.isNaN(start.getTime()) ? new Date() : start;
    const end = scheduledEnd ? new Date(scheduledEnd) : new Date(safeStart.getTime() + 30 * 60 * 1000);
    const safeEnd = Number.isNaN(end.getTime()) ? new Date(safeStart.getTime() + 30 * 60 * 1000) : end;

    const buildEventsUrl = (calendarIdValue) => {
    const encodedCalendarId = encodeURIComponent(String(calendarIdValue || 'primary'));
    return `${GOOGLE_CALENDAR_API}/calendars/${encodedCalendarId}/events?conferenceDataVersion=1&sendUpdates=none`;
    };

    const buildEventUrl = (calendarIdValue, eventId) => {
    const encodedCalendarId = encodeURIComponent(String(calendarIdValue || 'primary'));
    const encodedEventId = encodeURIComponent(String(eventId || ''));
    return `${GOOGLE_CALENDAR_API}/calendars/${encodedCalendarId}/events/${encodedEventId}?conferenceDataVersion=1&sendUpdates=none`;
    };

    const listWritableCalendars = async () => {
    const url = `${GOOGLE_CALENDAR_API}/users/me/calendarList?minAccessRole=writer&showDeleted=false&showHidden=false`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return [];

    const items = Array.isArray(payload?.items) ? payload.items : [];
    return items
      .map((item) => String(item?.id || '').trim())
      .filter(Boolean)
      .slice(0, 12);
    };

    let activeCalendarId = runtimePreferredCalendarId || config.calendarId;
    let discoveredCalendars = [];

    const promoteCalendarId = (calendarIdValue) => {
    const normalized = String(calendarIdValue || '').trim();
    if (!normalized) return;
    activeCalendarId = normalized;
    runtimePreferredCalendarId = normalized;
    process.env.GOOGLE_MEET_CALENDAR_ID = normalized;
    };

    const requestBase = {
    summary: String(title || 'Team Meeting').slice(0, 300),
    description: String(description || '').slice(0, 4000),
    start: { dateTime: safeStart.toISOString() },
    end: { dateTime: safeEnd.toISOString() },
    };

    const bodyWithType = {
    ...requestBase,
    conferenceData: {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
    };

    const buildBodyWithoutType = () => ({
    ...requestBase,
    conferenceData: {
      createRequest: {
        requestId: crypto.randomUUID(),
      },
    },
    });

    const createEvent = async (body, calendarIdValue = activeCalendarId) => {
    const response = await fetch(buildEventsUrl(calendarIdValue), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const payload = await response.json().catch(() => null);
    return { response, payload, calendarIdValue };
    };

    const addConferenceToExistingEvent = async (eventId, calendarIdValue, includeType) => {
    const body = includeType
      ? {
          conferenceData: {
            createRequest: {
              requestId: crypto.randomUUID(),
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          },
        }
      : {
          conferenceData: {
            createRequest: {
              requestId: crypto.randomUUID(),
            },
          },
        };

    const response = await fetch(buildEventUrl(calendarIdValue, eventId), {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const payload = await response.json().catch(() => null);
    return { response, payload };
    };

    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const extractConferenceInfo = (eventPayload) => {
    const entryPoints = Array.isArray(eventPayload?.conferenceData?.entryPoints)
      ? eventPayload.conferenceData.entryPoints
      : [];
    const videoEntry = entryPoints.find((entry) => entry?.entryPointType === 'video' && entry?.uri);

    return {
      joinUrl: String(videoEntry?.uri || eventPayload?.hangoutLink || '').trim(),
      providerMeetingId: String(eventPayload?.conferenceData?.conferenceId || eventPayload?.id || '').trim(),
      statusCode: String(eventPayload?.conferenceData?.createRequest?.status?.statusCode || '').trim().toLowerCase(),
    };
    };

    const fetchEventById = async (eventId, calendarIdValue) => {
    const eventUrl = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(String(calendarIdValue || activeCalendarId))}/events/${encodeURIComponent(
      String(eventId)
    )}?conferenceDataVersion=1`;

    const response = await fetch(eventUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const payload = await response.json().catch(() => null);
    return { response, payload };
    };

    const inspectCalendarAccess = async (calendarIdValue) => {
    const url = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(String(calendarIdValue || 'primary'))}`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (response.ok) return { ok: true, status: response.status, detail: '' };

      const payload = await response.json().catch(() => null);
      const apiMessage = String(payload?.error?.message || '').trim();
      return {
        ok: false,
        status: response.status,
        detail: apiMessage || 'Unable to access configured calendar',
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        detail: error instanceof Error ? error.message : 'Calendar accessibility check failed',
      };
    }
    };

    const pollConference = async (eventId, calendarIdValue, baseProviderMeetingId, baseStatusCode) => {
    let nextJoinUrl = '';
    let nextProviderMeetingId = baseProviderMeetingId || '';
    let nextStatusCode = baseStatusCode || '';

    const pollDelaysMs = [500, 900, 1300, 1800, 2400];
    for (const delay of pollDelaysMs) {
      await wait(delay);
      const polled = await fetchEventById(eventId, calendarIdValue);
      if (!polled.response.ok) break;

      const conference = extractConferenceInfo(polled.payload);
      nextJoinUrl = conference.joinUrl;
      nextProviderMeetingId = nextProviderMeetingId || conference.providerMeetingId;
      nextStatusCode = conference.statusCode || nextStatusCode;
      if (nextJoinUrl) break;
    }

    return {
      joinUrl: nextJoinUrl,
      providerMeetingId: nextProviderMeetingId,
      statusCode: nextStatusCode,
    };
    };

    const accessProbe = await inspectCalendarAccess(activeCalendarId);
    if (!accessProbe.ok && (accessProbe.status === 403 || accessProbe.status === 404)) {
      discoveredCalendars = await listWritableCalendars();
      const candidate = discoveredCalendars.find((item) => item && item !== activeCalendarId) || null;

      if (candidate) {
        promoteCalendarId(candidate);
      }
    }

    let { response, payload } = await createEvent(bodyWithType, activeCalendarId);

    if (!response.ok && response.status === 404) {
    discoveredCalendars = await listWritableCalendars();
    for (const candidateCalendarId of discoveredCalendars) {
      if (!candidateCalendarId || candidateCalendarId === activeCalendarId) continue;
      const retry = await createEvent(bodyWithType, candidateCalendarId);
      if (retry.response.ok) {
        response = retry.response;
        payload = retry.payload;
        promoteCalendarId(candidateCalendarId);
        break;
      }
    }
    }

    if (!response.ok) {
    const message = String(payload?.error?.message || '').toLowerCase();
    const shouldRetryWithoutType =
      message.includes('invalid conference type') ||
      message.includes('conference type value');

    if (shouldRetryWithoutType) {
      const bodyWithoutType = buildBodyWithoutType();
      const secondTry = await createEvent(bodyWithoutType);
      response = secondTry.response;
      payload = secondTry.payload;
    }
    }

    if (!response.ok) {
    const defaultDetail = String(payload?.error?.message || 'Google Calendar conference creation failed');
    const calendarHint =
      response.status === 404
        ? ` Calendar '${activeCalendarId}' was not found or is not shared with the service account.`
        : '';
    const discoveredHint = discoveredCalendars.length
      ? ` Writable calendars discovered for this service account: ${discoveredCalendars.join(', ')}.`
      : '';

    throw Object.assign(new Error('Failed to create Google Meet meeting'), {
      statusCode: 502,
      code: 'GOOGLE_MEET_CREATE_FAILED',
      detail: `${defaultDetail}${calendarHint}${discoveredHint}`.trim(),
    });
    }

    let { joinUrl, providerMeetingId, statusCode } = extractConferenceInfo(payload);

  // Google can accept event creation first and populate conference entry points shortly after.
    if (!joinUrl && payload?.id) {
    const polled = await pollConference(payload.id, activeCalendarId, providerMeetingId, statusCode);
    joinUrl = polled.joinUrl;
    providerMeetingId = providerMeetingId || polled.providerMeetingId;
    statusCode = polled.statusCode || statusCode;
    }

    if (!joinUrl && payload?.id) {
    const patchedWithType = await addConferenceToExistingEvent(payload.id, activeCalendarId, true);
    const patchedMessage = String(patchedWithType?.payload?.error?.message || '').toLowerCase();
    const invalidTypeOnPatch =
      patchedMessage.includes('invalid conference type') ||
      patchedMessage.includes('conference type value');

    if (!patchedWithType.response.ok && invalidTypeOnPatch) {
      await addConferenceToExistingEvent(payload.id, activeCalendarId, false);
    }

    const polledAfterPatch = await pollConference(payload.id, activeCalendarId, providerMeetingId, statusCode);
    joinUrl = polledAfterPatch.joinUrl;
    providerMeetingId = providerMeetingId || polledAfterPatch.providerMeetingId;
    statusCode = polledAfterPatch.statusCode || statusCode;
    }

    if (!joinUrl) {
    if (!discoveredCalendars.length) discoveredCalendars = await listWritableCalendars();
    for (const candidateCalendarId of discoveredCalendars) {
      if (!candidateCalendarId || candidateCalendarId === activeCalendarId) continue;

      let retryEvent = await createEvent(bodyWithType, candidateCalendarId);
      if (!retryEvent.response.ok) {
        const retryMessage = String(retryEvent.payload?.error?.message || '').toLowerCase();
        const shouldRetryWithoutType =
          retryMessage.includes('invalid conference type') ||
          retryMessage.includes('conference type value');
        if (shouldRetryWithoutType) {
          retryEvent = await createEvent(buildBodyWithoutType(), candidateCalendarId);
        }
      }

      if (!retryEvent.response.ok) continue;

      const retryConference = extractConferenceInfo(retryEvent.payload);
      let retryJoinUrl = retryConference.joinUrl;
      let retryProviderMeetingId = retryConference.providerMeetingId;
      let retryStatusCode = retryConference.statusCode;

      if (!retryJoinUrl && retryEvent.payload?.id) {
        const polledRetry = await pollConference(
          retryEvent.payload.id,
          candidateCalendarId,
          retryProviderMeetingId,
          retryStatusCode
        );
        retryJoinUrl = polledRetry.joinUrl;
        retryProviderMeetingId = retryProviderMeetingId || polledRetry.providerMeetingId;
        retryStatusCode = polledRetry.statusCode || retryStatusCode;
      }

      if (!retryJoinUrl) continue;

      promoteCalendarId(candidateCalendarId);
      joinUrl = retryJoinUrl;
      providerMeetingId = providerMeetingId || retryProviderMeetingId;
      statusCode = retryStatusCode || statusCode;
      break;
    }
    }

    if (!joinUrl || !isValidGoogleMeetJoinUrl(joinUrl)) {
    const discoveredHint = discoveredCalendars.length
      ? ` Writable calendars discovered for this service account: ${discoveredCalendars.join(', ')}.`
      : '';
      const shouldRecommendImpersonation = !config.impersonateUser && isGroupCalendarId(activeCalendarId);
      const impersonationHint = shouldRecommendImpersonation
        ? ' Set GOOGLE_MEET_IMPERSONATE_USER to a valid Google Workspace user who can create Meet links on this calendar.'
        : '';
      const calendarPermissionHint = isGroupCalendarId(activeCalendarId)
        ? ' Ensure this group calendar is shared with the service account and grants Make changes to events.'
        : '';
      const hint = [
        shouldRecommendImpersonation
          ? 'Google Workspace/group calendars commonly require domain-wide delegation with GOOGLE_MEET_IMPERSONATE_USER.'
          : '',
        'Verify Google Calendar API is enabled and the target calendar allows conference creation.',
      ]
        .filter(Boolean)
        .join(' ');

      throw Object.assign(new Error('Google Meet returned no valid join URL'), {
        statusCode: 502,
        code: 'GOOGLE_MEET_INVALID_JOIN_URL',
        detail:
          `Google Calendar API response did not include a valid https://meet.google.com join URL` +
          `${statusCode ? ` (conference status: ${statusCode})` : ''}. ` +
          `Calendar used: '${activeCalendarId}'. Ensure the service account can create Meet links for this calendar.` +
          impersonationHint +
          calendarPermissionHint +
          discoveredHint,
        hint,
      });
    }

    return { joinUrl, providerMeetingId: providerMeetingId || null };
  } catch (error) {
    if (error?.statusCode || error?.status) {
      throw error;
    }

    throw Object.assign(new Error('Failed to create Google Meet meeting'), {
      statusCode: 502,
      code: 'GOOGLE_MEET_CREATE_FAILED',
      detail: error instanceof Error ? error.message : 'Unknown Google Meet error',
      hint: 'Verify Google Calendar API access, calendar sharing permissions, and service-account credentials.',
    });
  }
}

function requireOrgDb(req) {
  const pool = req.orgDb;
  if (!pool) throw Object.assign(new Error('Org DB not attached'), { statusCode: 500 });
  return pool;
}

function parseTimestamp(value, field) {
  const raw = String(value || '').trim();
  if (!raw) {
    throw Object.assign(new Error(`Invalid ${field}`), { statusCode: 400 });
  }

  // Preserve local datetime inputs to avoid timezone drift in TIMESTAMP columns.
  const localDateTimeMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (localDateTimeMatch) {
    const [, year, month, day, hour, minute, second] = localDateTimeMatch;
    return `${year}-${month}-${day} ${hour}:${minute}:${second || '00'}`;
  }

  const ts = new Date(raw);
  if (Number.isNaN(ts.getTime())) {
    throw Object.assign(new Error(`Invalid ${field}`), { statusCode: 400 });
  }

  return formatDbTimestamp(ts);
}

async function getActorMemberId(orgPool, userId) {
  const resp = await orgPool.query('SELECT id FROM team_members WHERE global_user_id = $1 LIMIT 1', [String(userId)]);
  return resp.rows[0]?.id || null;
}

function buildGeneratedDescription(sourceText) {
  const source = String(sourceText || '').trim();
  if (!source) {
    return {
      description: 'No description generated because source text is empty.',
      aiSummary: null,
      aiDecisions: null,
      aiRisks: null,
      aiActionItems: [],
    };
  }

  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const summary = lines.slice(0, 4).join(' ');
  const decisionLines = lines.filter((line) => /decision|decided|approve|approved/i.test(line)).slice(0, 6);
  const riskLines = lines.filter((line) => /risk|blocker|blocked|issue|concern/i.test(line)).slice(0, 6);
  const itemLines = lines.filter((line) => /action|todo|next|follow[- ]?up|owner/i.test(line)).slice(0, 8);

  const actionItems = itemLines.map((line, index) => ({
    id: `ai-${index + 1}`,
    title: line.slice(0, 280),
    status: 'open',
  }));

  return {
    description: summary || source.slice(0, 1200),
    aiSummary: summary || null,
    aiDecisions: decisionLines.join('\n') || null,
    aiRisks: riskLines.join('\n') || null,
    aiActionItems: actionItems,
  };
}

class MeetingsService {
  async list(req, filters) {
    const orgPool = requireOrgDb(req);
    const startTime = Date.now();
    
    const where = [];
    const params = [];

    const push = (expr, val) => {
      params.push(val);
      where.push(expr.replace('?', `$${params.length}`));
    };

    if (filters.type) push('m.meeting_type = ?', String(filters.type));
    if (filters.status) push('m.status = ?', String(filters.status));
    if (filters.sprintId) push('m.sprint_id = ?', String(filters.sprintId));
    if (filters.projectId) push('m.project_id = ?', String(filters.projectId));

    const limit = Number(filters.limit || 100);
    params.push(limit);

    const resp = await orgPool.query(
      `SELECT
         m.id,
         m.sprint_id,
         m.project_id,
         m.meeting_type,
         m.video_provider,
         m.provider_meeting_id,
         m.join_url,
         m.title,
         m.description,
         m.status,
         m.scheduled_start,
         m.scheduled_end,
         m.actual_start,
         m.actual_end,
         m.ai_summary,
         m.ai_decisions,
         m.ai_risks,
         m.ai_action_items,
         m.created_by,
         m.created_at,
         m.updated_at,
         s.name AS sprint_name,
         p.name AS project_name,
         (SELECT COUNT(*)::int FROM meeting_attendees ma WHERE ma.meeting_id = m.id) AS attendee_count,
         (SELECT COUNT(*)::int FROM meeting_notes mn WHERE mn.meeting_id = m.id) AS note_count
       FROM meeting_sessions m
       LEFT JOIN sprints s ON s.id = m.sprint_id
       LEFT JOIN projects p ON p.id = m.project_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY m.scheduled_start DESC, m.created_at DESC
       LIMIT $${params.length}`,
      params
    );
    
    const duration = Date.now() - startTime;
    if (duration > 2000) {
      console.warn(`[SLOW:LIST_MEETINGS] Query took ${duration}ms for ${resp.rows.length} rows, type=${filters.type}, status=${filters.status}`);
    }

    return resp.rows.map((row) => ({
      id: row.id,
      sprintId: row.sprint_id,
      sprintName: row.sprint_name,
      projectId: row.project_id,
      projectName: row.project_name,
      type: row.meeting_type,
      videoProvider: row.video_provider,
      providerMeetingId: row.provider_meeting_id,
      joinUrl: row.join_url,
      title: row.title,
      description: row.description,
      status: row.status,
      scheduledStart: formatClientTimestamp(row.scheduled_start),
      scheduledEnd: formatClientTimestamp(row.scheduled_end),
      actualStart: formatClientTimestamp(row.actual_start),
      actualEnd: formatClientTimestamp(row.actual_end),
      aiSummary: row.ai_summary,
      aiDecisions: row.ai_decisions,
      aiRisks: row.ai_risks,
      aiActionItems: Array.isArray(row.ai_action_items) ? row.ai_action_items : [],
      attendeeCount: Number(row.attendee_count || 0),
      noteCount: Number(row.note_count || 0),
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async getById(req, meetingId) {
    const orgPool = requireOrgDb(req);
    const meetingResp = await orgPool.query(
      `SELECT
         m.id,
         m.sprint_id,
         m.project_id,
         m.meeting_type,
        m.video_provider,
        m.provider_meeting_id,
        m.join_url,
         m.title,
         m.description,
         m.status,
         m.scheduled_start,
         m.scheduled_end,
        m.actual_start,
        m.actual_end,
         m.ai_summary,
         m.ai_decisions,
         m.ai_risks,
         m.ai_action_items,
         m.created_by,
         m.created_at,
         m.updated_at,
         s.name AS sprint_name,
         p.name AS project_name
       FROM meeting_sessions m
       LEFT JOIN sprints s ON s.id = m.sprint_id
       LEFT JOIN projects p ON p.id = m.project_id
       WHERE m.id = $1
       LIMIT 1`,
      [String(meetingId)]
    );

    const row = meetingResp.rows[0] || null;
    if (!row) return null;

    const [attendeesResp, notesResp, actionsResp] = await Promise.all([
      orgPool.query(
        `SELECT
           ma.developer_id,
           ma.attendance_status,
           ma.note,
           tm.full_name
         FROM meeting_attendees ma
         JOIN developer_profiles dp ON dp.id = ma.developer_id
         LEFT JOIN team_members tm ON tm.id = dp.member_id
         WHERE ma.meeting_id = $1
         ORDER BY COALESCE(tm.full_name, 'Developer') ASC`,
        [String(meetingId)]
      ),
      orgPool.query(
        `SELECT
           mn.id,
           mn.content,
           mn.is_ai_generated,
           mn.created_at,
           mn.updated_at,
           mn.author_member_id,
           tm.full_name AS author_name
         FROM meeting_notes mn
         LEFT JOIN team_members tm ON tm.id = mn.author_member_id
         WHERE mn.meeting_id = $1
         ORDER BY mn.created_at DESC`,
        [String(meetingId)]
      ),
      orgPool.query(
        `SELECT
           mai.id,
           mai.title,
           mai.detail,
           mai.status,
           mai.due_date,
           mai.source,
           mai.assignee_developer_id,
           tm.full_name AS assignee_name,
           mai.created_at,
           mai.updated_at
         FROM meeting_action_items mai
         LEFT JOIN developer_profiles dp ON dp.id = mai.assignee_developer_id
         LEFT JOIN team_members tm ON tm.id = dp.member_id
         WHERE mai.meeting_id = $1
         ORDER BY mai.created_at DESC`,
        [String(meetingId)]
      ),
    ]);

    return {
      id: row.id,
      sprintId: row.sprint_id,
      sprintName: row.sprint_name,
      projectId: row.project_id,
      projectName: row.project_name,
      type: row.meeting_type,
      videoProvider: row.video_provider,
      providerMeetingId: row.provider_meeting_id,
      joinUrl: row.join_url,
      title: row.title,
      description: row.description,
      status: row.status,
      scheduledStart: formatClientTimestamp(row.scheduled_start),
      scheduledEnd: formatClientTimestamp(row.scheduled_end),
      actualStart: formatClientTimestamp(row.actual_start),
      actualEnd: formatClientTimestamp(row.actual_end),
      aiSummary: row.ai_summary,
      aiDecisions: row.ai_decisions,
      aiRisks: row.ai_risks,
      aiActionItems: Array.isArray(row.ai_action_items) ? row.ai_action_items : [],
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      attendees: attendeesResp.rows.map((item) => ({
        developerId: item.developer_id,
        name: item.full_name || 'Developer',
        attendanceStatus: item.attendance_status,
        note: item.note,
      })),
      notes: notesResp.rows.map((item) => ({
        id: item.id,
        content: item.content,
        isAiGenerated: Boolean(item.is_ai_generated),
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        authorMemberId: item.author_member_id,
        authorName: item.author_name,
      })),
      actionItems: actionsResp.rows.map((item) => ({
        id: item.id,
        title: item.title,
        detail: item.detail,
        status: item.status,
        dueDate: item.due_date,
        source: item.source,
        assigneeDeveloperId: item.assignee_developer_id,
        assigneeName: item.assignee_name || null,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      })),
    };
  }

  async create(req, payload) {
    const orgPool = requireOrgDb(req);
    const startTime = Date.now();
    
    console.log(`[MEETING:CREATE] Started for user: ${req.user?.userId}`);
    
    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    if (!actorMemberId) throw Object.assign(new Error('Team member not found'), { statusCode: 403 });
    
    console.log(`[MEETING:CREATE] Got actor member ID in ${Date.now() - startTime}ms`);

    const scheduledStart = parseTimestamp(payload.scheduledStart, 'scheduledStart');
    const scheduledEnd = payload.scheduledEnd ? parseTimestamp(payload.scheduledEnd, 'scheduledEnd') : null;
    
    console.log(`[MEETING:CREATE] Parsed timestamps in ${Date.now() - startTime}ms`);

    const insertResp = await orgPool.query(
      `INSERT INTO meeting_sessions (
         sprint_id,
         project_id,
         meeting_type,
         title,
         description,
         status,
         scheduled_start,
         scheduled_end,
         created_by,
         updated_by
       ) VALUES ($1,$2,$3,$4,$5,'scheduled',$6,$7,$8,$8)
       RETURNING id`,
      [
        payload.sprintId || null,
        payload.projectId || null,
        String(payload.type),
        String(payload.title),
        payload.description || null,
        scheduledStart,
        scheduledEnd,
        String(actorMemberId),
      ]
    );

    const meetingId = String(insertResp.rows[0].id);
    console.log(`[MEETING:CREATE] Inserted meeting ${meetingId} in ${Date.now() - startTime}ms`);
    
    const attendees = Array.isArray(payload.attendeeDeveloperIds) ? payload.attendeeDeveloperIds : [];

    if (attendees.length) {
      for (const developerId of attendees) {
        await orgPool.query(
          `INSERT INTO meeting_attendees (meeting_id, developer_id, attendance_status)
           VALUES ($1,$2,'invited')
           ON CONFLICT (meeting_id, developer_id) DO NOTHING`,
          [meetingId, String(developerId)]
        );
      }
    }
    
    console.log(`[MEETING:CREATE] Inserted attendees in ${Date.now() - startTime}ms`);

    const shouldCreateJoinUrl = payload?.createJoinUrl !== false;
    const selectedProvider = String(payload?.provider || 'google_meet');
    let provisioningWarning = null;

    if (shouldCreateJoinUrl && selectedProvider === 'google_meet') {
      try {
        const created = await createGoogleMeetConference({
          title: payload.title,
          description: payload.description,
          scheduledStart,
          scheduledEnd,
        });

        await orgPool.query(
          `UPDATE meeting_sessions
           SET video_provider = 'google_meet',
               provider_meeting_id = $2,
               join_url = $3,
               updated_by = $4,
               updated_at = NOW()
           WHERE id = $1`,
          [meetingId, created.providerMeetingId ? String(created.providerMeetingId) : null, String(created.joinUrl), String(actorMemberId)]
        );
      } catch (err) {
        provisioningWarning = {
          code: String(err?.code || 'GOOGLE_MEET_CREATE_FAILED'),
          detail:
            (typeof err?.detail === 'string' && err.detail.trim()) ||
            (typeof err?.message === 'string' && err.message.trim()) ||
            'Meeting was scheduled, but Google Meet join link could not be created automatically.',
          hint: (typeof err?.hint === 'string' && err.hint.trim()) || null,
        };
      }
    }

    const item = await this.getById(req, meetingId);
    console.log(`[MEETING:CREATE] COMPLETED in ${Date.now() - startTime}ms`);

    if (provisioningWarning && item) {
      item.provisioningWarning = provisioningWarning;
    }

    return item;
  }

  async update(req, meetingId, patch) {
    const orgPool = requireOrgDb(req);
    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    if (!actorMemberId) throw Object.assign(new Error('Team member not found'), { statusCode: 403 });

    const sets = [];
    const params = [];

    const addSet = (field, value) => {
      params.push(value);
      sets.push(`${field} = $${params.length}`);
    };

    if (patch.title !== undefined) addSet('title', String(patch.title));
    if (patch.status !== undefined) addSet('status', String(patch.status));
    if (patch.description !== undefined) addSet('description', patch.description || null);
    if (patch.scheduledStart !== undefined) addSet('scheduled_start', parseTimestamp(patch.scheduledStart, 'scheduledStart'));
    if (patch.scheduledEnd !== undefined) {
      addSet('scheduled_end', patch.scheduledEnd ? parseTimestamp(patch.scheduledEnd, 'scheduledEnd') : null);
    }

    addSet('updated_by', String(actorMemberId));

    params.push(String(meetingId));
    const whereId = `$${params.length}`;

    const updateResp = await orgPool.query(
      `UPDATE meeting_sessions
       SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = ${whereId}
       RETURNING id`,
      params
    );

    if (!updateResp.rows.length) throw Object.assign(new Error('Meeting not found'), { statusCode: 404 });
    return this.getById(req, meetingId);
  }

  async delete(req, meetingId) {
    const orgPool = requireOrgDb(req);
    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    if (!actorMemberId) throw Object.assign(new Error('Team member not found'), { statusCode: 403 });

    const deleteResp = await orgPool.query(
      `DELETE FROM meeting_sessions
       WHERE id = $1
       RETURNING id`,
      [String(meetingId)]
    );

    if (!deleteResp.rows.length) throw Object.assign(new Error('Meeting not found'), { statusCode: 404 });

    return {
      id: String(deleteResp.rows[0].id),
      deleted: true,
    };
  }

  async setAttendees(req, meetingId, attendeeDeveloperIds) {
    const orgPool = requireOrgDb(req);
    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    if (!actorMemberId) throw Object.assign(new Error('Team member not found'), { statusCode: 403 });

    const existsResp = await orgPool.query('SELECT id FROM meeting_sessions WHERE id = $1 LIMIT 1', [String(meetingId)]);
    if (!existsResp.rows.length) throw Object.assign(new Error('Meeting not found'), { statusCode: 404 });

    await orgPool.query('BEGIN');
    try {
      await orgPool.query('DELETE FROM meeting_attendees WHERE meeting_id = $1', [String(meetingId)]);

      for (const developerId of attendeeDeveloperIds) {
        await orgPool.query(
          `INSERT INTO meeting_attendees (meeting_id, developer_id, attendance_status)
           VALUES ($1,$2,'invited')
           ON CONFLICT (meeting_id, developer_id) DO NOTHING`,
          [String(meetingId), String(developerId)]
        );
      }

      await orgPool.query('UPDATE meeting_sessions SET updated_by = $2, updated_at = NOW() WHERE id = $1', [
        String(meetingId),
        String(actorMemberId),
      ]);

      await orgPool.query('COMMIT');
    } catch (err) {
      try {
        await orgPool.query('ROLLBACK');
      } catch {
        // ignore rollback errors
      }
      throw err;
    }

    return this.getById(req, meetingId);
  }

  async listNotes(req, meetingId) {
    const orgPool = requireOrgDb(req);
    const existsResp = await orgPool.query('SELECT id FROM meeting_sessions WHERE id = $1 LIMIT 1', [String(meetingId)]);
    if (!existsResp.rows.length) throw Object.assign(new Error('Meeting not found'), { statusCode: 404 });

    const resp = await orgPool.query(
      `SELECT
         mn.id,
         mn.content,
         mn.is_ai_generated,
         mn.created_at,
         mn.updated_at,
         mn.author_member_id,
         tm.full_name AS author_name
       FROM meeting_notes mn
       LEFT JOIN team_members tm ON tm.id = mn.author_member_id
       WHERE mn.meeting_id = $1
       ORDER BY mn.created_at DESC`,
      [String(meetingId)]
    );

    return resp.rows.map((item) => ({
      id: item.id,
      content: item.content,
      isAiGenerated: Boolean(item.is_ai_generated),
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      authorMemberId: item.author_member_id,
      authorName: item.author_name,
    }));
  }

  async addNote(req, meetingId, payload) {
    const orgPool = requireOrgDb(req);
    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    if (!actorMemberId) throw Object.assign(new Error('Team member not found'), { statusCode: 403 });

    const existsResp = await orgPool.query('SELECT id FROM meeting_sessions WHERE id = $1 LIMIT 1', [String(meetingId)]);
    if (!existsResp.rows.length) throw Object.assign(new Error('Meeting not found'), { statusCode: 404 });

    const insertResp = await orgPool.query(
      `INSERT INTO meeting_notes (meeting_id, author_member_id, content, is_ai_generated)
       VALUES ($1,$2,$3,$4)
       RETURNING id, content, is_ai_generated, created_at, updated_at, author_member_id`,
      [String(meetingId), String(actorMemberId), String(payload.content), Boolean(payload.isAiGenerated)]
    );

    await orgPool.query('UPDATE meeting_sessions SET updated_by = $2, updated_at = NOW() WHERE id = $1', [
      String(meetingId),
      String(actorMemberId),
    ]);

    const row = insertResp.rows[0];
    return {
      id: row.id,
      content: row.content,
      isAiGenerated: Boolean(row.is_ai_generated),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      authorMemberId: row.author_member_id,
    };
  }

  async updateDescription(req, meetingId, payload) {
    const orgPool = requireOrgDb(req);
    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    if (!actorMemberId) throw Object.assign(new Error('Team member not found'), { statusCode: 403 });

    const existsResp = await orgPool.query('SELECT id FROM meeting_sessions WHERE id = $1 LIMIT 1', [String(meetingId)]);
    if (!existsResp.rows.length) throw Object.assign(new Error('Meeting not found'), { statusCode: 404 });

    const generated = payload.autoGenerate ? buildGeneratedDescription(payload.sourceText) : null;
    const nextDescription =
      payload.description !== undefined ? payload.description : generated ? generated.description : undefined;

    const sets = [];
    const params = [];
    const addSet = (field, value) => {
      params.push(value);
      sets.push(`${field} = $${params.length}`);
    };

    if (nextDescription !== undefined) addSet('description', nextDescription || null);
    if (generated) {
      addSet('ai_summary', generated.aiSummary);
      addSet('ai_decisions', generated.aiDecisions);
      addSet('ai_risks', generated.aiRisks);
      addSet('ai_action_items', generated.aiActionItems);
    }

    addSet('updated_by', String(actorMemberId));

    params.push(String(meetingId));
    const whereId = `$${params.length}`;

    await orgPool.query(
      `UPDATE meeting_sessions
       SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = ${whereId}`,
      params
    );

    return this.getById(req, meetingId);
  }

  async startMeeting(req, meetingId, payload) {
    const orgPool = requireOrgDb(req);
    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    if (!actorMemberId) throw Object.assign(new Error('Team member not found'), { statusCode: 403 });

    const existsResp = await orgPool.query(
      `SELECT id, title, description, scheduled_start, scheduled_end, join_url, provider_meeting_id, video_provider
       FROM meeting_sessions
       WHERE id = $1
       LIMIT 1`,
      [String(meetingId)]
    );
    const meeting = existsResp.rows[0] || null;
    if (!meeting) throw Object.assign(new Error('Meeting not found'), { statusCode: 404 });

    const existingProviderMeetingId = String(meeting?.provider_meeting_id || '').trim();
    let provider = String(meeting?.video_provider || payload?.provider || 'google_meet');
    let providerMeetingId = existingProviderMeetingId || (payload?.providerMeetingId ? String(payload.providerMeetingId) : null);
    let joinUrl = payload?.joinUrl ? String(payload.joinUrl).trim() : null;
    const existingJoinUrl = String(meeting?.join_url || '').trim();
    const isExistingJoinUrlValid = isValidGoogleMeetJoinUrl(existingJoinUrl);

    if (!joinUrl && provider === 'google_meet' && isExistingJoinUrlValid) {
      joinUrl = existingJoinUrl;
    }

    if (provider === 'google_meet' && joinUrl && !isValidGoogleMeetJoinUrl(joinUrl)) {
      throw Object.assign(new Error('joinUrl must be a valid Google Meet URL'), {
        statusCode: 400,
        code: 'GOOGLE_MEET_INVALID_JOIN_URL',
        detail: 'Expected an https://meet.google.com/... URL for Google Meet.',
      });
    }

    if (provider === 'google_meet' && !joinUrl) {
      try {
        const created = await createGoogleMeetConference({
          title: meeting.title,
          description: meeting.description,
          scheduledStart: meeting.scheduled_start,
          scheduledEnd: meeting.scheduled_end,
        });
        joinUrl = created.joinUrl;
        providerMeetingId = providerMeetingId || created.providerMeetingId;
        provider = 'google_meet';
      } catch (err) {
        // Starting the meeting should still succeed even when Meet provisioning fails.
        console.error('[startMeeting] Google Meet creation failed:', err?.detail || err?.message || err);
      }
    }

    if (provider !== 'google_meet' && !joinUrl) {
      throw Object.assign(new Error('joinUrl is required for non-Google providers'), {
        statusCode: 400,
        code: 'MEETING_JOIN_URL_REQUIRED',
        detail: 'Provide a valid joinUrl for this provider.',
      });
    }

    if (provider === 'google_meet' && joinUrl && !isValidGoogleMeetJoinUrl(joinUrl)) {
      throw Object.assign(new Error('joinUrl must be a valid Google Meet URL'), {
        statusCode: 400,
        code: 'GOOGLE_MEET_INVALID_JOIN_URL',
        detail: 'Expected an https://meet.google.com/... URL for Google Meet.',
      });
    }

    if (!providerMeetingId && joinUrl) providerMeetingId = `provider-${crypto.randomUUID().slice(0, 12)}`;

    await orgPool.query(
      `UPDATE meeting_sessions
       SET video_provider = $2,
           provider_meeting_id = $3,
           join_url = $4,
           status = CASE WHEN status = 'scheduled' THEN 'in_progress' ELSE status END,
           actual_start = COALESCE(actual_start, NOW()),
           updated_by = $5,
           updated_at = NOW()
       WHERE id = $1`,
      [String(meetingId), provider || null, providerMeetingId || null, joinUrl || null, String(actorMemberId)]
    );

    return this.getById(req, meetingId);
  }

  getHealth() {
    const snapshot = getGoogleMeetConfigSnapshot();
    const preview = snapshot.calendarId ? `${snapshot.calendarId.slice(0, 20)}...` : '';
    return {
      status: 'ok',
      googleMeet: {
        configured: snapshot.configured,
        emailSet: snapshot.emailSet,
        privateKeySet: snapshot.privateKeySet,
        calendarIdSet: snapshot.calendarIdSet,
        calendarId: preview,
      },
    };
  }

  async listTranscripts(req, meetingId) {
    const orgPool = requireOrgDb(req);

    const existsResp = await orgPool.query('SELECT id FROM meeting_sessions WHERE id = $1 LIMIT 1', [String(meetingId)]);
    if (!existsResp.rows.length) throw Object.assign(new Error('Meeting not found'), { statusCode: 404 });

    const resp = await orgPool.query(
      `SELECT
         mt.id,
         mt.meeting_id,
         mt.source_type,
         mt.file_name,
         mt.mime_type,
         mt.transcript_text,
         mt.speaker_segments,
         mt.language,
         mt.status,
         mt.error_message,
         mt.uploaded_by,
         mt.created_at,
         mt.updated_at
       FROM meeting_transcripts mt
       WHERE mt.meeting_id = $1
       ORDER BY mt.created_at DESC`,
      [String(meetingId)]
    );

    return resp.rows.map((item) => ({
      id: item.id,
      meetingId: item.meeting_id,
      sourceType: item.source_type,
      fileName: item.file_name,
      mimeType: item.mime_type,
      transcriptText: item.transcript_text,
      speakerSegments: Array.isArray(item.speaker_segments) ? item.speaker_segments : [],
      language: item.language,
      status: item.status,
      errorMessage: item.error_message,
      uploadedBy: item.uploaded_by,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }));
  }

  async uploadTranscript(req, meetingId, payload) {
    const orgPool = requireOrgDb(req);
    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    if (!actorMemberId) throw Object.assign(new Error('Team member not found'), { statusCode: 403 });

    const existsResp = await orgPool.query('SELECT id FROM meeting_sessions WHERE id = $1 LIMIT 1', [String(meetingId)]);
    if (!existsResp.rows.length) throw Object.assign(new Error('Meeting not found'), { statusCode: 404 });

    const transcriptText = String(payload?.transcriptText || '').trim();
    if (!transcriptText) throw Object.assign(new Error('Transcript text is required'), { statusCode: 400 });

    const sourceType = String(payload?.sourceType || 'manual_upload');
    const fileName = payload?.fileName ? String(payload.fileName) : null;
    const mimeType = payload?.mimeType ? String(payload.mimeType) : null;
    const language = payload?.language ? String(payload.language) : null;
    const normalizedTranscript = normalizeTranscriptInput({
      transcriptText,
      fileName,
      mimeType,
      speakerSegments: payload?.speakerSegments,
    });
    const speakerSegments = Array.isArray(normalizedTranscript.speakerSegments) ? normalizedTranscript.speakerSegments : [];

    const insertResp = await orgPool.query(
      `INSERT INTO meeting_transcripts (
         meeting_id,
         source_type,
         file_name,
         mime_type,
         transcript_text,
         speaker_segments,
         language,
         status,
         uploaded_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'ready',$8)
       RETURNING
         id,
         meeting_id,
         source_type,
         file_name,
         mime_type,
         transcript_text,
         speaker_segments,
         language,
         status,
         error_message,
         uploaded_by,
         created_at,
         updated_at`,
      [
        String(meetingId),
        sourceType,
        fileName,
        mimeType,
        normalizedTranscript.transcriptText,
        speakerSegments,
        language,
        String(actorMemberId),
      ]
    );

    await orgPool.query('UPDATE meeting_sessions SET updated_by = $2, updated_at = NOW() WHERE id = $1', [
      String(meetingId),
      String(actorMemberId),
    ]);

    const row = insertResp.rows[0];
    return {
      id: row.id,
      meetingId: row.meeting_id,
      sourceType: row.source_type,
      fileName: row.file_name,
      mimeType: row.mime_type,
      transcriptText: row.transcript_text,
      speakerSegments: Array.isArray(row.speaker_segments) ? row.speaker_segments : [],
      language: row.language,
      status: row.status,
      errorMessage: row.error_message,
      uploadedBy: row.uploaded_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async summarizeMeeting(req, meetingId, payload) {
    const orgPool = requireOrgDb(req);
    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    if (!actorMemberId) throw Object.assign(new Error('Team member not found'), { statusCode: 403 });

    const existsResp = await orgPool.query('SELECT id FROM meeting_sessions WHERE id = $1 LIMIT 1', [String(meetingId)]);
    if (!existsResp.rows.length) throw Object.assign(new Error('Meeting not found'), { statusCode: 404 });

    const includeNotes = payload?.includeNotes !== false;
    const updateDescription = payload?.updateDescription !== false;

    let sourceText = String(payload?.sourceText || '').trim();

    if (!sourceText) {
      const transcriptResp = await orgPool.query(
        `SELECT transcript_text FROM meeting_transcripts WHERE meeting_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [String(meetingId)]
      );
      sourceText = String(transcriptResp.rows[0]?.transcript_text || '').trim();
    }

    if (includeNotes) {
      const notesResp = await orgPool.query(
        `SELECT content FROM meeting_notes WHERE meeting_id = $1 ORDER BY created_at DESC LIMIT 30`,
        [String(meetingId)]
      );
      const noteText = notesResp.rows.map((row) => String(row.content || '').trim()).filter(Boolean).join('\n');
      if (noteText) sourceText = sourceText ? `${sourceText}\n${noteText}` : noteText;
    }

    const generated = buildGeneratedDescription(sourceText);

    const sets = [];
    const params = [];
    const addSet = (field, value) => {
      params.push(value);
      sets.push(`${field} = $${params.length}`);
    };

    if (updateDescription) addSet('description', generated.description || null);
    addSet('ai_summary', generated.aiSummary);
    addSet('ai_decisions', generated.aiDecisions);
    addSet('ai_risks', generated.aiRisks);
    addSet('ai_action_items', generated.aiActionItems);
    addSet('updated_by', String(actorMemberId));

    params.push(String(meetingId));

    await orgPool.query(
      `UPDATE meeting_sessions
       SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length}`,
      params
    );

    return this.getById(req, meetingId);
  }
}

const meetingsService = new MeetingsService();

module.exports = {
  meetingsService,
};
