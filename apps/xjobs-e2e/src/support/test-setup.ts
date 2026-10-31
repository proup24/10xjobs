import { resolve } from 'node:path';
import axios from 'axios';
import { config } from 'dotenv';

// The engine reads its Basic auth credentials from the repo's .env; so do the tests.
config({ path: resolve(__dirname, '../../../../.env'), quiet: true });

// Configure axios for tests to use.
const host = process.env.HOST ?? 'localhost';
const port = process.env.PORT ?? '3000';
axios.defaults.baseURL = `http://${host}:${port}`;
axios.defaults.auth = {
  username: process.env.BASIC_AUTH_USERNAME ?? '',
  password: process.env.BASIC_AUTH_PASSWORD ?? '',
};
