import { loadEnvironmentFiles } from 'src/config/environment.loader';

// Containers and integration runs can use only explicitly supplied settings.
if (process.env.XJOBS_SKIP_ENV_FILES !== '1') loadEnvironmentFiles();
