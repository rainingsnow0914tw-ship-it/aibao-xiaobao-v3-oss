const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

let cachedToken = null;

export async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.value;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(METADATA_TOKEN_URL, {
      headers: { "metadata-flavor": "Google" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`metadata token ${response.status}`);
    const data = await response.json();
    cachedToken = {
      value: data.access_token,
      expiresAt: now + (data.expires_in ?? 3600) * 1000,
    };
    return cachedToken.value;
  } finally {
    clearTimeout(timer);
  }
}

export function onCloudRun() {
  return Boolean(process.env.K_SERVICE);
}
