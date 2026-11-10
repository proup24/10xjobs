import { redirect } from 'next/navigation';

export default async function Page({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  const { profileId } = await params;
  redirect(`/preferences/profiles/${encodeURIComponent(profileId)}/job`);
}
