const sensitiveKeys = /password|passcode|secret|token|cookie|authorization|username|email|account|user_?id|client_?id|session|serial|signature|mac|setup|pin/i;
const bearerValue = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const emailValue = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const jwtValue = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sensitiveKeys.test(key) ? '[REDACTED]' : redact(child)]));
  }
  if (typeof value === 'string') {
    return value
      .replace(bearerValue, 'Bearer [REDACTED]')
      .replace(jwtValue, '[REDACTED_TOKEN]')
      .replace(emailValue, '[REDACTED_EMAIL]');
  }
  return value;
}
