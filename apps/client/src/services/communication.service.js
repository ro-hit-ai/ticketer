async function workflowFetch(fetchWithAuth, url, options = {}) {
  const response = await fetchWithAuth(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
    },
  });

  return response;
}

export async function getThreads(fetchWithAuth, params = {}) {
  const search = new URLSearchParams();

  if (params.sourceCaseId) {
    search.set("sourceCaseId", params.sourceCaseId.trim());
  }

  if (params.mailboxId) {
    search.set("mailboxId", params.mailboxId);
  }

  if (params.includeMonitoring !== undefined && params.includeMonitoring !== null) {
    search.set("includeMonitoring", String(Boolean(params.includeMonitoring)));
  }

  if (params.status) {
    search.set("status", params.status);
  }

  const query = search.toString();
  const response = await workflowFetch(fetchWithAuth, `/v1/threads${query ? `?${query}` : ""}`, {
    method: "GET",
  });
  const data = await response.json();

  if (!response.ok || data.success === false) {
    throw new Error(data.message || "Failed to fetch threads");
  }

  return Array.isArray(data.threads) ? data.threads : [];
}

export async function getThreadFull(fetchWithAuth, threadId) {
  const response = await workflowFetch(fetchWithAuth, `/v1/threads/${threadId}/full`, {
    method: "GET",
  });
  const data = await response.json();

  if (!response.ok || data.success === false) {
    throw new Error(data.message || "Failed to fetch thread");
  }

  return {
    thread: data.thread || null,
    messages: Array.isArray(data.messages) ? data.messages : [],
    workflow: data.workflow || null,
  };
}

export async function getThreadWorkflow(fetchWithAuth, threadId) {
  const response = await workflowFetch(fetchWithAuth, `/v1/threads/${threadId}/workflow`, {
    method: "GET",
  });
  const data = await response.json();

  if (!response.ok || data.success === false) {
    throw new Error(data.message || "Failed to fetch workflow snapshot");
  }

  return data.workflow || null;
}

export async function getThreadBySourceCaseId(fetchWithAuth, sourceCaseId) {
  const response = await workflowFetch(fetchWithAuth, `/v1/threads/source/${encodeURIComponent(sourceCaseId.trim())}`, {
    method: "GET",
  });
  const data = await response.json();

  if (!response.ok || data.success === false) {
    throw new Error(data.message || "Failed to fetch thread");
  }

  return data.thread || null;
}

export async function createOrOpenThread(fetchWithAuth, payload) {
  const response = await workflowFetch(fetchWithAuth, "/v1/threads", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const data = await response.json();

  if (!response.ok || data.success === false) {
    throw new Error(data.message || "Failed to open thread");
  }

  return {
    created: Boolean(data.created),
    thread: data.thread || null,
  };
}

export async function sendMessage(fetchWithAuth, payload) {
  const response = await workflowFetch(fetchWithAuth, "/v1/messages", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const data = await response.json();

  if (!response.ok || data.success === false) {
    throw new Error(data.message || "Failed to send message");
  }

  return data.message;
}
