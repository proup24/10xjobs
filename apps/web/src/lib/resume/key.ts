export const RESUMES_BUCKET = 'resumes';
export const MAX_RESUME_BYTES = 5_242_880;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KEY_PATTERN = new RegExp(`^(${UUID})/(${UUID})/${UUID}\\.pdf$`);

export function profileFolder(userId: string, profileId: string): string {
  return `${userId}/${profileId}`;
}

export function newResumeKey(
  userId: string,
  profileId: string,
  uuid: string = crypto.randomUUID(),
): string {
  return `${profileFolder(userId, profileId)}/${uuid}.pdf`;
}

export function isResumeKeyFor(
  key: string,
  userId: string,
  profileId: string,
): boolean {
  const match = KEY_PATTERN.exec(key);
  return match !== null && match[1] === userId && match[2] === profileId;
}
