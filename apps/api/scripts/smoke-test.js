require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const API_BASE = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 5004}`;
const PHP_API_KEY = process.env.PHP_API_KEY || '';

async function jfetch(url, options = {}) {
  const response = await fetch(url, options);
  let data = null;
  try {
    data = await response.json();
  } catch (_) {
    data = null;
  }
  return { ok: response.ok, status: response.status, data };
}

async function run() {
  console.log(`Smoke test target: ${API_BASE}`);

  const login = await jfetch(`${API_BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@vati.com', password: 'Admin@123' }),
  });

  if (!login.ok || !login.data?.token) {
    console.error('Login FAILED:', login.status, login.data);
    process.exit(1);
  }

  const token = login.data.token;
  const perms = login.data?.user?.permissions || [];
  console.log('Login OK, permissions:', perms);

  const queueCreate = await jfetch(`${API_BASE}/api/v1/email-queue/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'SMOKE-QUEUE',
      username: process.env.IMAP_USER,
      password: process.env.IMAP_PASS,
      hostname: process.env.IMAP_HOST,
      tls: String(process.env.IMAP_TLS || 'true').toLowerCase() === 'true',
      serviceType: 'other',
      port: Number(process.env.IMAP_PORT || 993),
    }),
  });
  console.log('Queue create:', queueCreate.status, queueCreate.data?.success);

  const queueAll = await jfetch(`${API_BASE}/api/v1/email-queue/all`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log('Queue all:', queueAll.status, queueAll.data?.success);

  if (PHP_API_KEY) {
    const phpHealth = await jfetch(`${API_BASE}/api/php/health`, {
      headers: { 'x-api-key': PHP_API_KEY },
    });
    console.log('PHP bridge health:', phpHealth.status, phpHealth.data?.success);
  } else {
    console.log('PHP bridge health skipped: PHP_API_KEY not set');
  }

  console.log('Smoke test finished.');
}

run().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
