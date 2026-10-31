import { Injectable } from '@nestjs/common';

@Injectable()
export class AshbyPostingProvider {
  async fetch(url: string): Promise<unknown> {
    const match =
      /^https:\/\/jobs\.ashbyhq\.com\/([^/]+)\/([0-9a-f-]{36})/i.exec(url);
    if (!match) throw new Error('Unsupported Ashby posting URL');
    const response = await fetch(
      'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query:
            'query ApiJobPosting($organizationHostedJobsPageName:String!,$jobPostingId:String!){jobPosting(organizationHostedJobsPageName:$organizationHostedJobsPageName,jobPostingId:$jobPostingId){id title descriptionHtml locationName employmentType publishedDate}}',
          variables: {
            organizationHostedJobsPageName: decodeURIComponent(match[1]!),
            jobPostingId: match[2],
          },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok)
      throw new Error(`Ashby API returned HTTP ${response.status}`);
    const body = (await response.json()) as {
      data?: { jobPosting?: Record<string, unknown> | null };
    };
    if (!body.data?.jobPosting)
      throw new Error('Ashby posting is closed or unavailable');
    return body.data.jobPosting;
  }
}
