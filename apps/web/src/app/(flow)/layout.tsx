import { FlowLayout } from '@/components/layout/flow-layout';

export default function FlowRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <FlowLayout>{children}</FlowLayout>;
}
