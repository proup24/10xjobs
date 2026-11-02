import { stripCompanyPage } from './import';

describe('stripCompanyPage', () => {
  it('drops the company page up to the LinkedIn posting heading, its own headings too', () => {
    const description = [
      '## Company page (Ashby)',
      'About Acme.',
      '## What you will do',
      'Company-page duties.',
      '## LinkedIn posting',
      'Senior Backend Engineer, remote.',
      '## Requirements',
      'Node.js.',
    ].join('\n');
    expect(stripCompanyPage(description)).toBe(
      'Senior Backend Engineer, remote.\n## Requirements\nNode.js.',
    );
  });

  it('leaves a description without a company page alone', () => {
    const description = 'Intro.\n## Requirements\nNode.js.';
    expect(stripCompanyPage(description)).toBe(description);
  });
});
