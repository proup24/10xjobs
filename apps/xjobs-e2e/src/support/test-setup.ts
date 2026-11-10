import { resolve } from 'node:path';
import axios from 'axios';
import { config } from 'dotenv';

// Locally the repo's .env holds the engine key; CI passes it in the environment
// and sets XJOBS_SKIP_ENV_FILES=1 so no file is read.
if (process.env.XJOBS_SKIP_ENV_FILES !== '1') {
  config({ path: resolve(__dirname, '../../../../.env'), quiet: true });
}

// Configure axios for tests to use.
const host = process.env.HOST ?? 'localhost';
const port = process.env.PORT ?? '3000';
axios.defaults.baseURL = `http://${host}:${port}`;
axios.defaults.headers.common['X-Engine-Key'] =
  process.env.ENGINE_API_KEY ?? '';
