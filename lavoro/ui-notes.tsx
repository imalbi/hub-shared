import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Panel } from '../../apps/web/src/components/panel.tsx';
import { createModuleClient } from '../../apps/web/src/lib/module-client.ts';
import { copy } from './copy.ts';
import type { Block, Run } from './markdown.ts';
import type definition from './server.ts';

function Runs({ runs }: { runs: Run[] }) {
  return runs.map((run, index) => {
    const text = run.bold ? <strong>{run.text}</strong> : run.code ? <code>{run.text}</code> : run.text;
    return run.href ? (
      <a key={index} href={run.href} target="_blank" rel="noopener noreferrer" className="underline">
        {text}
      </a>
    ) : (
      <React.Fragment key={index}>{text}</React.Fragment>
    );
  });
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return blocks.map((block, index) => {
    if (block.type === 'rule') return <hr key={index} className="border-border" />;
    if (block.type === 'list')
      return (
        <ul key={index} className="list-disc pl-lg">
          {block.items.map((item, i) => (
            <li key={i}>
              <Runs runs={item} />
            </li>
          ))}
        </ul>
      );
    // The file's own title repeats the company and role the detail already shows.
    if (block.type === 'heading' && block.level === 1) return null;
    if (block.type === 'heading') {
      const Tag = block.level === 2 ? 'h4' : block.level === 3 ? 'h5' : 'h6';
      return (
        <Tag
          key={index}
          // Sections as the house machine labels, questions as bold lines: one look for both read as a flat list.
          className={block.level === 2 ? 'mt-sm text-caps text-muted-foreground' : 'font-semibold'}
        >
          <Runs runs={block.runs} />
        </Tag>
      );
    }
    return (
      <p key={index} className={block.type === 'source' ? 'text-caption text-muted-foreground' : ''}>
        <Runs runs={block.runs} />
      </p>
    );
  });
}

export function Preparation({ jobKey }: { jobKey: string }) {
  const client = React.useMemo(() => createModuleClient<typeof definition>('lavoro'), []);
  const note = useQuery({
    queryKey: ['lavoro', 'preparation', jobKey],
    queryFn: () => client.preparation.query({ key: jobKey }),
    refetchOnMount: 'always',
  }).data;
  const [expanded, setExpanded] = React.useState(false);
  if (!note) return null;
  const start = note.blocks.findIndex(
    (block) =>
      (block.type === 'heading' || block.type === 'paragraph') &&
      block.runs
        .map((run) => run.text)
        .join('')
        .toLowerCase() === 'in breve',
  );
  const firstHeading = note.blocks.findIndex(
    (block, index) => index > start && block.type === 'heading' && block.level <= 2,
  );
  const end =
    firstHeading < 0
      ? -1
      : note.blocks.findIndex((block, index) => index > firstHeading && block.type === 'heading' && block.level <= 2);
  const preview = start < 0 ? note.blocks.slice(0, 2) : note.blocks.slice(start, end < 0 ? undefined : end);
  return (
    <section
      aria-label={copy.notes.preparation}
      className="flex flex-col gap-sm border-t border-border/40 pt-sm text-label"
    >
      <div className="flex items-baseline justify-between gap-sm">
        <h3 className="font-semibold">{copy.notes.preparation}</h3>
        <span className="text-caption text-muted-foreground">{note.date}</span>
      </div>
      <Blocks blocks={expanded ? note.blocks : preview} />
      <div className="flex gap-md">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className="cursor-pointer underline"
        >
          {expanded ? copy.notes.less : copy.notes.more}
        </button>
        <button
          type="button"
          onClick={() => void client.openPreparation.mutate({ key: jobKey })}
          className="cursor-pointer underline"
        >
          {copy.notes.open}
        </button>
      </div>
    </section>
  );
}

export function Gaps() {
  const client = React.useMemo(() => createModuleClient<typeof definition>('lavoro'), []);
  const note = useQuery({
    queryKey: ['lavoro', 'gaps'],
    queryFn: () => client.gaps.query(),
    refetchOnMount: 'always',
  }).data;
  if (!note) return null;
  return (
    <Panel title={copy.notes.gaps}>
      <div className="flex flex-col gap-sm text-label">
        <p className="text-caption text-muted-foreground">{note.date}</p>
        <Blocks blocks={note.blocks} />
      </div>
    </Panel>
  );
}
