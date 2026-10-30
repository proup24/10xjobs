import type { Channel } from 'src/common/enums';

export interface ChannelSearch {
  id: string;
  workspaceId: string;
  channel: Channel;
  keywords: string[];
  params: Record<string, unknown>;
}

export interface ChannelJob {
  externalId: string;
  url: string;
  title: string;
  company: string;
  location: string | null;
  description: string;
  raw: unknown;
}

export interface ChannelCollectionResult {
  jobs: ChannelJob[];
  complete: boolean;
  truncated: boolean;
}

export abstract class ChannelProvider {
  abstract readonly channel: Channel;
  abstract collect(search: ChannelSearch): Promise<ChannelCollectionResult>;
}
