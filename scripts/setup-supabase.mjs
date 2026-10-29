import { randomBytes, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const hex = (bytes) => randomBytes(bytes).toString('hex');
const secrets = {
  POSTGRES_PASSWORD: hex(24),
  JWT_SECRET: hex(32),
  DASHBOARD_PASSWORD: hex(24),
  SECRET_KEY_BASE: hex(48),
  REALTIME_DB_ENC_KEY: hex(8),
  VAULT_ENC_KEY: hex(16),
  PG_META_CRYPTO_KEY: hex(32),
  LOGFLARE_PUBLIC_ACCESS_TOKEN: hex(32),
  LOGFLARE_PRIVATE_ACCESS_TOKEN: hex(32),
  S3_PROTOCOL_ACCESS_KEY_ID: hex(16),
  S3_PROTOCOL_ACCESS_KEY_SECRET: hex(32),
  MINIO_ROOT_PASSWORD: hex(24),
};
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const issuedAt = Math.floor(Date.now() / 1000);
for (const [key, role] of [['ANON_KEY', 'anon'], ['SERVICE_ROLE_KEY', 'service_role']]) {
  const data = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    role, iss: 'supabase', iat: issuedAt, exp: issuedAt + 5 * 365 * 24 * 3600,
  })}`;
  secrets[key] = `${data}.${createHmac('sha256', secrets.JWT_SECRET).update(data).digest('base64url')}`;
}
let env = readFileSync(new URL('.env.example', root), 'utf8');
for (const [key, value] of Object.entries(secrets)) {
  env = env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
}
try {
  writeFileSync(new URL('.env', root), env, { flag: 'wx', mode: 0o600 });
  console.log('Created .env with fresh Supabase credentials. Start with: docker compose up -d --wait');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('.env already exists; credentials were left unchanged.');
}
