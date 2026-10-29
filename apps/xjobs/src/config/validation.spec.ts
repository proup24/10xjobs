import { getResumeStorageDir, validateEnvironment } from './index';

describe('validateEnvironment', () => {
  const minimal = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

  it('defaults RESUME_STORAGE_DIR to ./storage/resumes', () => {
    expect(validateEnvironment(minimal).RESUME_STORAGE_DIR).toBe(
      './storage/resumes',
    );
  });

  it('keeps an explicit RESUME_STORAGE_DIR', () => {
    const env = validateEnvironment({ ...minimal, RESUME_STORAGE_DIR: '/data' });
    expect(
      getResumeStorageDir({ get: () => env.RESUME_STORAGE_DIR } as never),
    ).toBe('/data');
  });
});
