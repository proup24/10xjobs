'use client';

import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Block } from './block';

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function OverlaysSection() {
  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-title-3">Overlays</h2>
      <Block title="Tooltip: a short label on hover or focus">
        <Tooltip>
          <TooltipTrigger render={<Button variant="outline" />}>
            Hover me
          </TooltipTrigger>
          <TooltipContent>Saved to your profile</TooltipContent>
        </Tooltip>
      </Block>
      <Block title="Popover: small interactive content">
        <Popover>
          <PopoverTrigger render={<Button variant="outline" />}>
            Open popover
          </PopoverTrigger>
          <PopoverContent>
            <PopoverHeader>
              <PopoverTitle>Match score</PopoverTitle>
              <PopoverDescription>
                Based on title, location and stack.
              </PopoverDescription>
            </PopoverHeader>
          </PopoverContent>
        </Popover>
      </Block>
      <Block title="Dropdown menu">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" />}>
            Actions
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Job</DropdownMenuLabel>
              <DropdownMenuItem>Open posting</DropdownMenuItem>
              <DropdownMenuItem>Mark as applied</DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">Reject</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Block>
      <Block title="Sheet: a side panel (the mobile navigation drawer)">
        <Sheet>
          <SheetTrigger render={<Button variant="outline" />}>
            Open sheet
          </SheetTrigger>
          <SheetContent side="left">
            <SheetHeader>
              <SheetTitle>Side panel</SheetTitle>
              <SheetDescription>
                Opens from an edge. The close button is in the corner.
              </SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
      </Block>
      <Block title="Dialog: a task with its own content or form">
        <Dialog>
          <DialogTrigger render={<Button variant="outline" />}>
            Open dialog
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit notes</DialogTitle>
              <DialogDescription>
                Dialogs hold forms and longer content. Full width with a margin
                below the sm breakpoint.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter showCloseButton />
          </DialogContent>
        </Dialog>
      </Block>
      <Block title="Confirm dialog: yes or no before an action">
        <ConfirmDialog
          trigger={<Button variant="outline">Confirm (resolves)</Button>}
          title="Archive this job?"
          description="It leaves your pipeline but stays searchable."
          confirmLabel="Archive"
          onConfirm={() => wait(1000)}
        />
        <ConfirmDialog
          trigger={<Button variant="destructive">Delete (destructive)</Button>}
          title="Delete this profile?"
          description="This cannot be undone."
          confirmLabel="Delete"
          destructive
          onConfirm={() => wait(1000)}
        />
      </Block>
      <Block title="Toasts">
        <Button variant="outline" onClick={() => toast('Saved')}>
          Default
        </Button>
        <Button
          variant="outline"
          onClick={() => toast.success('Profile published')}
        >
          Success
        </Button>
        <Button
          variant="outline"
          onClick={() => toast.error('Could not save changes')}
        >
          Error
        </Button>
        <Button
          variant="outline"
          onClick={() => toast.warning('Quota almost used')}
        >
          Warning
        </Button>
      </Block>
    </section>
  );
}
