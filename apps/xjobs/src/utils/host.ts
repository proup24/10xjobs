import { hostname } from 'node:os';
export function getHostName(): string {
  return hostname();
}
