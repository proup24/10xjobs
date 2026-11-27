'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Tab } from '@/lib/matches/group';

type Option = { value: string; label: string };

function FilterSelect({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: Option[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(v) => {
        if (typeof v === 'string') onChange(v);
      }}
    >
      <SelectTrigger
        aria-label={label}
        size="sm"
        className="min-w-0 max-w-full"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The list tabs (the page's lists, e.g. matches and review) with their counts, then the profile
 * and source selects, then the two time tabs with their counts.
 */
export function MatchFilters({
  lists,
  list,
  onList,
  profileItems,
  profile,
  onProfile,
  sourceItems,
  source,
  onSource,
  tab,
  counts,
  onTab,
}: {
  lists: { value: string; label: string; count: number }[];
  list: string;
  onList: (list: string) => void;
  /** Null hides the profile switcher. */
  profileItems: Option[] | null;
  profile: string;
  onProfile: (value: string) => void;
  /**
   * Null hides the source and tab controls (a draft profile); an empty array hides only the
   * source select (a page with one source).
   */
  sourceItems: Option[] | null;
  source: string;
  onSource: (value: string) => void;
  tab: Tab;
  counts: Record<Tab, number>;
  onTab: (tab: Tab) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {sourceItems && (
        <Tabs
          value={list}
          onValueChange={(v) => {
            if (typeof v === 'string') onList(v);
          }}
        >
          <TabsList aria-label="List" className="w-full">
            {lists.map((l) => (
              <TabsTrigger key={l.value} value={l.value}>
                {l.label} ({l.count})
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      <div className="flex flex-wrap gap-2">
        {profileItems && (
          <FilterSelect
            label="Profile"
            items={profileItems}
            value={profile}
            onChange={onProfile}
          />
        )}
        {sourceItems && sourceItems.length > 0 && (
          <FilterSelect
            label="Source"
            items={sourceItems}
            value={source}
            onChange={onSource}
          />
        )}
      </div>
      {sourceItems && (
        <Tabs
          value={tab}
          onValueChange={(v) => {
            if (v === '24h' || v === '7d') onTab(v);
          }}
        >
          <TabsList aria-label="Posted" className="w-full">
            <TabsTrigger value="24h">
              Last 24 hours ({counts['24h']})
            </TabsTrigger>
            <TabsTrigger value="7d">Last 7 days ({counts['7d']})</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
    </div>
  );
}
