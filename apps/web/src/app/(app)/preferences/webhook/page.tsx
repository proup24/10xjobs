import { headers } from 'next/headers';
import { WebhookDeliveries } from '@/components/preferences/webhook-deliveries';
import { WebhookForm } from '@/components/preferences/webhook-form';
import { TextLink } from '@/components/ui/text';
import { SECTION_TITLES, preferencesTitle } from '@/lib/preferences/titles';
import { callbackUrlFor } from '@/lib/webhook/callback-url';
import { loadWebhook } from '@/lib/webhook/load';
import { preferenceProfiles } from '../data';
import { requireSignedIn } from '../guard';

export const dynamic = 'force-dynamic';

export const metadata = { title: preferencesTitle(SECTION_TITLES.webhook) };

const DOCS_URL =
  'https://github.com/proup24/10xjobs/blob/main/docs/webhooks.md';

export default async function Page() {
  const { supabase } = await requireSignedIn();
  // The layout already read the profiles; `cache` hands back the same labels.
  const { labels } = await preferenceProfiles();
  const { webhook, deliveries } = await loadWebhook(supabase, labels);
  // The web app has no site-URL setting: build the callback URL from the request's origin.
  const h = await headers();
  const callbackUrl = callbackUrlFor({
    forwardedHost: h.get('x-forwarded-host'),
    host: h.get('host'),
    forwardedProto: h.get('x-forwarded-proto'),
  });
  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="webhook-title" className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h2 id="webhook-title" className="text-title-4">
            {SECTION_TITLES.webhook}
          </h2>
          <p className="text-muted-foreground">
            Send each new matched job to a URL as a signed POST.{' '}
            <TextLink href={DOCS_URL} target="_blank" rel="noopener noreferrer">
              Read the docs
            </TextLink>
          </p>
        </div>
        <WebhookForm
          webhook={webhook}
          callbackUrl={callbackUrl}
          docsUrl={DOCS_URL}
        />
      </section>
      {webhook && (
        <section
          aria-labelledby="deliveries-title"
          className="flex flex-col gap-4"
        >
          <h3 id="deliveries-title" className="text-title-5">
            Recent deliveries
          </h3>
          <WebhookDeliveries deliveries={deliveries} />
        </section>
      )}
    </div>
  );
}
