const EmailMessage = require('../../models/EmailMessage');
const Thread = require('../../models/Thread');
const { extractApplicationIdFromSubject } = require('./emailApplicationId.service');

function normalizeSourceCaseId(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : null;
}

function getHeader(parsed, key) {
  try {
    if (parsed?.headers && typeof parsed.headers.get === 'function') {
      const value = parsed.headers.get(key);
      return value == null ? null : String(value).trim();
    }
  } catch (_) {
    // Ignore malformed headers and keep fallback behavior.
  }

  return null;
}

function normalizeReferences(value) {
  if (!value) return [];

  const items = Array.isArray(value) ? value : String(value).split(/\s+/);
  return items.map((item) => String(item || '').trim()).filter(Boolean);
}

function extractSourceCaseIdFromHeadersOrSubject(parsed) {
  const subjectApplicationId = extractApplicationIdFromSubject(parsed?.subject);
  if (subjectApplicationId) {
    return subjectApplicationId;
  }

  const headerValue =
    getHeader(parsed, 'x-sourcecaseid') ||
    getHeader(parsed, 'x-application-id') ||
    getHeader(parsed, 'x-applicationid');

  if (headerValue) {
    return normalizeSourceCaseId(headerValue);
  }

  const subject = String(parsed?.subject || '');
  const patterns = [
    /application\s*id\s*[:#\]]\s*([a-z0-9][a-z0-9-]{2,63})/i,
    /sourcecaseid\s*[:#\]]\s*([a-z0-9][a-z0-9-]{2,63})/i,
  ];

  for (const pattern of patterns) {
    const match = subject.match(pattern);
    if (match?.[1]) {
      return normalizeSourceCaseId(match[1]);
    }
  }

  return null;
}

function buildHeaderSnapshot(parsed) {
  const values = {};
  const keys = ['message-id', 'in-reply-to', 'references', 'x-application-id', 'x-sourcecaseid'];

  keys.forEach((key) => {
    const value = getHeader(parsed, key);
    if (value) {
      values[key] = value;
    }
  });

  return values;
}

async function resolveThreadForInboundEmail(parsed) {
  const inReplyTo = getHeader(parsed, 'in-reply-to') || null;
  const references = normalizeReferences(getHeader(parsed, 'references'));
  const sourceCaseId = extractSourceCaseIdFromHeadersOrSubject(parsed);

  if (inReplyTo) {
    const outboundByReply = await EmailMessage.findOne({
      messageId: inReplyTo,
      direction: 'outbound',
    }).select('threadId sourceCaseId');

    if (outboundByReply?.threadId) {
      return {
        thread: await Thread.findById(outboundByReply.threadId),
        sourceCaseId: outboundByReply.sourceCaseId || sourceCaseId,
        inReplyTo,
        references,
      };
    }
  }

  if (references.length > 0) {
    const outboundByReference = await EmailMessage.findOne({
      messageId: { $in: references },
      direction: 'outbound',
    })
      .sort({ createdAt: -1 })
      .select('threadId sourceCaseId');

    if (outboundByReference?.threadId) {
      return {
        thread: await Thread.findById(outboundByReference.threadId),
        sourceCaseId: outboundByReference.sourceCaseId || sourceCaseId,
        inReplyTo,
        references,
      };
    }
  }

  if (sourceCaseId) {
    const thread = await Thread.findOne({ sourceCaseId });
    if (thread) {
      return { thread, sourceCaseId: thread.sourceCaseId, inReplyTo, references };
    }
  }

  return { thread: null, sourceCaseId, inReplyTo, references };
}

module.exports = {
  buildHeaderSnapshot,
  extractSourceCaseIdFromHeadersOrSubject,
  getHeader,
  normalizeReferences,
  resolveThreadForInboundEmail,
};
