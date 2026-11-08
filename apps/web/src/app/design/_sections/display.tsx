import { Inbox } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Steps } from '@/components/ui/steps';
import { Code, Mark, TextLink } from '@/components/ui/text';
import { Block } from './block';

const setupSteps = [
  { id: 'profile', label: 'Profile' },
  { id: 'roles', label: 'Roles' },
  { id: 'places', label: 'Places' },
  { id: 'review', label: 'Review' },
];

export function DisplaySection() {
  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-title-3">Display</h2>
      <Block title="Card">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-title-4">Senior engineer</CardTitle>
            <CardDescription>Acme, Berlin</CardDescription>
          </CardHeader>
          <CardContent>
            Fit score 82. Remote friendly, TypeScript stack.
          </CardContent>
          <CardFooter className="gap-2">
            <Button size="sm">Apply</Button>
            <Button size="sm" variant="outline">
              Skip
            </Button>
          </CardFooter>
        </Card>
      </Block>
      <Block title="Badge: default, secondary (neutral), outline, success, warning, destructive">
        <Badge>Default</Badge>
        <Badge variant="secondary">Neutral</Badge>
        <Badge variant="outline">Outline</Badge>
        <Badge variant="success">Applied</Badge>
        <Badge variant="warning">Needs review</Badge>
        <Badge variant="destructive">Rejected</Badge>
      </Block>
      <Block title="Tabs">
        <Tabs defaultValue="open" className="w-full max-w-sm">
          <TabsList>
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="applied">Applied</TabsTrigger>
            <TabsTrigger value="closed">Closed</TabsTrigger>
          </TabsList>
          <TabsContent value="open">Jobs waiting for a decision.</TabsContent>
          <TabsContent value="applied">Jobs you applied to.</TabsContent>
          <TabsContent value="closed">Jobs no longer available.</TabsContent>
        </Tabs>
      </Block>
      <Block title="Table">
        <Table className="max-w-lg">
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Backend engineer</TableCell>
              <TableCell>Acme</TableCell>
              <TableCell>
                <Badge variant="success">Applied</Badge>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Platform engineer</TableCell>
              <TableCell>Globex</TableCell>
              <TableCell>
                <Badge variant="secondary">New</Badge>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Block>
      <Block title="Separator">
        <div className="flex w-full max-w-sm flex-col gap-3">
          <span>Above</span>
          <Separator />
          <span>Below</span>
        </div>
      </Block>
      <Block title="Skeleton">
        <div className="flex w-full max-w-sm flex-col gap-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </Block>
      <Block title="Empty state">
        <Empty className="max-w-md">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Inbox />
            </EmptyMedia>
            <EmptyTitle>No jobs yet</EmptyTitle>
            <EmptyDescription>
              Jobs that match your profile show up here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Block>
      <Block title="Steps">
        <div className="flex w-full flex-col gap-6">
          <Steps steps={setupSteps} current={0} />
          <Steps steps={setupSteps} current={1} />
          <Steps steps={setupSteps} current={3} />
        </div>
      </Block>
      <Block title="Kbd">
        <KbdGroup>
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      </Block>
      <Block title="Inline text: Code, Mark, TextLink">
        <p>
          Run <Code>pnpm db:migrate</Code>, then look for{' '}
          <Mark>TypeScript</Mark>. See the{' '}
          <TextLink href="/design">guide</TextLink>.
        </p>
      </Block>
    </section>
  );
}
