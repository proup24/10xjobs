'use client';

import { useId, useRef, type ComponentProps } from 'react';
import { useRouter } from 'next/navigation';
import { AboutForm } from '@/components/setup/about-form';
import { EligibilityForm } from '@/components/setup/eligibility-form';
import { JobForm } from '@/components/setup/job-form';
import { ResumeField, type Resume } from '@/components/setup/resume-field';
import { TermsForm } from '@/components/setup/terms-form';
import { SECTION_TITLES } from '@/lib/preferences/titles';
import { Section, type SectionFormProps } from './section';

/** A form's props minus what its Section supplies. */
type Own<P> = Omit<P, keyof SectionFormProps>;

/** You → Contacts: the about form without the name. */
export function ContactsSection(
  props: Omit<Own<ComponentProps<typeof AboutForm>>, 'withName'>,
) {
  return (
    <Section title={SECTION_TITLES.contacts} formId="contacts-form">
      {(frame) => <AboutForm {...props} {...frame} withName={false} />}
    </Section>
  );
}

/** You → Where you can work. */
export function EligibilitySection(
  props: Own<ComponentProps<typeof EligibilityForm>>,
) {
  return (
    <Section
      title={SECTION_TITLES.eligibility}
      lead="These answers apply to every profile."
      formId="eligibility-form"
    >
      {(frame) => <EligibilityForm {...props} {...frame} />}
    </Section>
  );
}

/** Profile → The job you want. */
export function JobSection(props: Own<ComponentProps<typeof JobForm>>) {
  return (
    <Section
      title={SECTION_TITLES.job}
      lead="We only show you jobs that match every answer here."
      level={3}
      formId="job-form"
    >
      {(frame) => <JobForm {...props} {...frame} />}
    </Section>
  );
}

/** Profile → Location and terms. The profile exists, so the form edits it. */
export function TermsSection(
  props: Omit<Own<ComponentProps<typeof TermsForm>>, 'hasProfile'>,
) {
  return (
    <Section title={SECTION_TITLES.terms} level={3} formId="terms-form">
      {(frame) => <TermsForm {...props} {...frame} hasProfile />}
    </Section>
  );
}

/**
 * Profile → Resume. The field saves on upload, so there's no Save button; after an
 * upload the server data is refreshed so the nav's "Needs a resume" badge goes away.
 */
export function ResumeSection(props: ComponentProps<typeof ResumeField>) {
  const router = useRouter();
  const headingId = useId();
  const last = useRef<Resume | null | undefined>(undefined);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-6">
      <h3 id={headingId} className="text-title-5">
        {SECTION_TITLES.resume}
      </h3>
      <ResumeField
        {...props}
        onChange={(state) => {
          props.onChange?.(state);
          // The first report is the resume on mount; a later new one is an upload.
          if (last.current !== undefined && state.resume !== last.current) {
            router.refresh();
          }
          last.current = state.resume;
        }}
      />
    </section>
  );
}
