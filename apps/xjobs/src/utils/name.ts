/** Keeps a filename safe to echo back in a Content-Disposition header. */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[^\w.\- ]/g, '_')
    .slice(0, 200)
    .trim();
  return cleaned || 'resume.pdf';
}
