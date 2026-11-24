import { FunnelSimpleIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { Chip } from '../../apps/web/src/components/chip.tsx';
import { Calendar } from '../../apps/web/src/components/ui/calendar.tsx';
import { Input } from '../../apps/web/src/components/ui/input.tsx';
import { Popover } from '../../apps/web/src/components/ui/popover.tsx';
import { Switch } from '../../apps/web/src/components/ui/switch.tsx';
import { dayDate, localDay } from '../../apps/web/src/lib/day.ts';
import { parseDay } from '../../apps/web/src/lib/parse-day.ts';
import { copy } from './copy.ts';
import type { MailFilter } from './use-mail.ts';

const dayLong = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
const dayShort = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });
// The calendar needs a lower bound; mail older than this is not a real case.
const EARLIEST = '2000-01-01';

/** How many of the popover's filters are on (the search text is the field's own). */
export const activeFilters = (filter: MailFilter) =>
  [filter.from, filter.subject, filter.after, filter.unseen].filter(Boolean).length;

/** The popover's active filters as removable chips under the search field. */
export function FilterChips({ filter, onChange }: { filter: MailFilter; onChange: (next: MailFilter) => void }) {
  const without = (key: keyof MailFilter) => () => onChange({ ...filter, [key]: undefined });
  return (
    <>
      {filter.from && <Chip label={copy.filterFrom(filter.from)} onRemove={without('from')} />}
      {filter.subject && <Chip label={copy.filterSubject(filter.subject)} onRemove={without('subject')} />}
      {filter.after && (
        <Chip label={copy.filterAfter(dayShort.format(dayDate(filter.after)))} onRemove={without('after')} />
      )}
      {filter.unseen && <Chip label={copy.unreadOnly} onRemove={without('unseen')} />}
    </>
  );
}

export function FilterPopover({ filter, onApply }: { filter: MailFilter; onApply: (next: MailFilter) => void }) {
  const count = activeFilters(filter);
  return (
    <Popover
      side="bottom"
      align="start"
      size="xl"
      label={copy.filters}
      trigger={
        <button
          type="button"
          aria-label={count > 0 ? copy.filtersOn(count) : copy.filters}
          className="relative flex size-touch shrink-0 cursor-pointer items-center justify-center rounded-full border border-border hover:bg-surface focus-visible:outline focus-visible:outline-accent"
        >
          <FunnelSimpleIcon aria-hidden className="size-icon-sm" />
          {count > 0 && <span aria-hidden className="absolute top-3xs right-3xs size-xs rounded-full bg-accent" />}
        </button>
      }
    >
      {({ close }) => (
        <FilterForm
          filter={filter}
          onApply={(next) => {
            onApply(next);
            close();
          }}
        />
      )}
    </Popover>
  );
}

// Its own component so the draft starts from the applied filter every time the popover opens.
function FilterForm({ filter, onApply }: { filter: MailFilter; onApply: (next: MailFilter) => void }) {
  const [today] = useState(() => localDay(new Date()));
  const [from, setFrom] = useState(filter.from ?? '');
  const [subject, setSubject] = useState(filter.subject ?? '');
  const [unseen, setUnseen] = useState(filter.unseen ?? false);
  const [after, setAfter] = useState<string | null>(filter.after ?? null);
  const [typed, setTyped] = useState('');
  const [unknown, setUnknown] = useState(false);
  function readTyped() {
    if (!typed.trim()) return;
    const day = parseDay(typed, today, 'past');
    if (day && day <= today) {
      setAfter(day);
      setUnknown(false);
    } else setUnknown(true);
  }
  return (
    <form
      className="flex gap-lg"
      onSubmit={(event) => {
        event.preventDefault();
        onApply({
          ...filter,
          from: from.trim() || undefined,
          subject: subject.trim() || undefined,
          unseen: unseen || undefined,
          after: after ?? undefined,
        });
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-md">
        <Input label={copy.from} value={from} onValueChange={setFrom} maxLength={200} />
        <Input label={copy.subject} value={subject} onValueChange={setSubject} maxLength={200} />
        <Switch label={copy.unreadOnly} labelPosition="start" checked={unseen} onCheckedChange={setUnseen} />
        <div className="mt-auto flex justify-between gap-sm">
          <button
            type="button"
            onClick={() => onApply({ body: filter.body })}
            className="min-h-touch cursor-pointer rounded-full border border-border px-lg text-label hover:bg-surface focus-visible:outline focus-visible:outline-accent"
          >
            {copy.reset}
          </button>
          <button
            type="submit"
            className="min-h-touch cursor-pointer rounded-full bg-primary px-lg text-label font-medium text-primary-foreground focus-visible:outline focus-visible:outline-accent"
          >
            {copy.apply}
          </button>
        </div>
      </div>
      <div className="flex w-calendar flex-col gap-sm">
        <Input
          label={copy.after}
          value={typed}
          placeholder={after ? dayLong.format(dayDate(after)) : copy.afterPlaceholder}
          error={unknown ? copy.afterUnknown : undefined}
          onValueChange={(next) => {
            setTyped(next);
            setUnknown(false);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            // Enter reads the day; it does not apply the whole form.
            event.preventDefault();
            readTyped();
          }}
          onBlur={readTyped}
        />
        {after && <p className="text-caption text-muted-foreground">{dayLong.format(dayDate(after))}</p>}
        <Calendar
          // A typed day in another month moves the grid by remounting it.
          key={(after ?? today).slice(0, 7)}
          value={after}
          onValueChange={(next) => {
            setAfter(next);
            setTyped('');
            setUnknown(false);
          }}
          min={EARLIEST}
          max={today}
          initial={today}
          compact
          previousLabel={copy.monthPrevious}
          nextLabel={copy.monthNext}
        />
      </div>
    </form>
  );
}
