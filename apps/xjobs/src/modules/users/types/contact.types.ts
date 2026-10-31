import type { ContactKind } from 'src/common/enums';

export type ContactInput = {
  kind: ContactKind;
  value: string;
  label?: string | null;
  isPrimary?: boolean;
};
