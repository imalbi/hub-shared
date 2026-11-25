import { LoadingSkeleton } from '../../apps/web/src/components/ui/loading-skeleton.tsx';
import * as React from 'react';
import { Binoculars as BinocularsIcon } from '@phosphor-icons/react';
import { useNavigate, useSearch } from '../../apps/web/src/lib/zone-search.ts';
import { createModuleClient } from '../../apps/web/src/lib/module-client.ts';
import type { ModuleActivity, ModuleUI, TodayDay, TodayLine } from '../../apps/web/src/lib/module-ui.ts';
import { useNow } from '../../apps/web/src/lib/use-now.ts';
import { Panel } from '../../apps/web/src/components/panel.tsx';
import { ZoneTabs } from '../../apps/web/src/components/zone-tabs.tsx';
import { PageSurface } from '../../apps/web/src/shell/page-surface.tsx';
import { TabBarRow } from '../../apps/web/src/shell/header-slot.tsx';
import { copy } from './copy.ts';
import { lavoroApplications, lavoroPostings } from './ui-records.ts';
import { useLavoroCalendarItems } from './ui-calendar.ts';
import { LavoroWidget, useLavoroSummary } from './ui-widget.tsx';
import { todayParts } from './today.ts';
import { computeFilterCounts, matchesFilters, type LavoroFilters } from './filters.ts';
import { blacklistMatchTypes, matchRule, type BlacklistField } from './blacklist.ts';
import {
  highlightTerms,
  matchesAdvancedSearch,
  matchesFreeSearch,
  parseFreeSearch,
  type AdvancedSearch,
} from './search.ts';
import type definition from './server.ts';
import type { JobRow, LavoroState, RuleRow } from './server.ts';
import { groupJobs, sortJobs, type PostingGroupId } from './sort.ts';
import { withCompanyApplications } from './same-company.ts';
import { tabOf, type UserState } from './tabs.ts';
import { ApplicationPanel } from './ui-application-panel.tsx';
import { CandidaturePage } from './ui-candidature.tsx';
import { useMailTodos } from './ui-mail-todos.tsx';
import { StatsPage } from './ui-stats.tsx';
import {
  annunciSearchSchema,
  isValidWorkMode,
  loadOpenGroups,
  loadStoredView,
  saveOpenGroups,
  saveStoredView,
  type AnnunciSegment,
  type ValidWorkMode,
  type ViewOptions,
} from './ui-common.tsx';

const EMPTY_JOBS: JobRow[] = [];
const EMPTY_RULES: RuleRow[] = [];

function buildAdvancedSearch(
  mode: AdvancedSearch['mode'],
  wholeWordsOnly: boolean,
  title: string | undefined,
  company: string | undefined,
  description: string | undefined,
  location: string | undefined,
): AdvancedSearch | undefined {
  if (!title && !company && !description && !location) return undefined;
  return { mode, wholeWordsOnly, fields: { title, company, description, location } };
}

function buildFilters(
  firstSeen: LavoroFilters['firstSeen'],
  minScore: LavoroFilters['minScore'],
  modes: string | undefined,
  sources: string | undefined,
  cats: string | undefined,
  locs: string | undefined,
  companies: string | undefined,
): LavoroFilters {
  return {
    firstSeen,
    minScore,
    workModes: modes ? modes.split(',').filter(isValidWorkMode) : [],
    sources: sources ? sources.split(',').filter(Boolean) : [],
    categories: cats ? cats.split(',').filter(Boolean) : [],
    locations: locs ? locs.split(',').filter(Boolean) : [],
    companies: companies ? companies.split(',').filter(Boolean) : [],
  };
}
import { DetailDialog } from './ui-detail.tsx';
import {
  EditPostingDialog,
  GroupConfirmDialog,
  ImportDialog,
  ProvaDialog,
  PurgeConfirmDialog,
  ToastNotification,
} from './ui-dialogs.tsx';
import { AdvancedSearchBar, FilterChips } from './ui-filters.tsx';
import { PostingsList } from './ui-list.tsx';
import { RulesPage } from './ui-rules.tsx';
import { TopBar } from './ui-top-bar.tsx';

export function RicercaZonePage() {
  const navigate = useNavigate();
  const listRef = React.useRef<HTMLDivElement>(null);
  const rawSearch = useSearch({ strict: false });
  const searchParams = annunciSearchSchema.parse(rawSearch);
  const now = useNow('clock');
  const client = React.useMemo(() => createModuleClient<typeof definition>('lavoro'), []);

  // State from server
  const [lavoroState, setLavoroState] = React.useState<LavoroState | null>(null);
  const [data, setData] = React.useState<{ jobs: JobRow[]; rules: RuleRow[] } | null>(null);
  const [loading, setLoading] = React.useState(true);

  // URL state - completely typed, zero casts
  const currentSegment = searchParams.segment;
  const searchQuery = searchParams.q;
  const isGlobe = searchParams.globe === '1';
  const sortOption = searchParams.sort;
  const openPostingKey = searchParams.job;
  const ruleParam = searchParams.rule;

  // Dialog and prefill states
  const [showImportDialog, setShowImportDialog] = React.useState(false);
  const [editingJob, setEditingJob] = React.useState<JobRow | null>(null);
  const [prefilledRule, setPrefilledRule] = React.useState<{
    field: BlacklistField;
    matchType: (typeof blacklistMatchTypes)[number];
    value: string;
    note?: string;
  } | null>(null);

  // Advanced search parameters
  const advMode = searchParams.adv_mode;
  const advWholeWords = searchParams.adv_whole === '1';
  const advTitle = searchParams.adv_title;
  const advCompany = searchParams.adv_company;
  const advDesc = searchParams.adv_desc;
  const advLoc = searchParams.adv_loc;

  const advancedSearch = React.useMemo(
    () => buildAdvancedSearch(advMode, advWholeWords, advTitle, advCompany, advDesc, advLoc),
    [advMode, advWholeWords, advTitle, advCompany, advDesc, advLoc],
  );

  // Filter parameters
  const firstSeenPreset = searchParams.fs;
  const minScoreParam = searchParams.score;
  const currentFilters = React.useMemo(
    () =>
      buildFilters(
        firstSeenPreset,
        minScoreParam,
        searchParams.modes,
        searchParams.sources,
        searchParams.cats,
        searchParams.locs,
        searchParams.companies,
      ),
    [
      firstSeenPreset,
      minScoreParam,
      searchParams.modes,
      searchParams.sources,
      searchParams.cats,
      searchParams.locs,
      searchParams.companies,
    ],
  );
  const workModesParam: ValidWorkMode[] = currentFilters.workModes ?? [];
  const sourcesParam = currentFilters.sources ?? [];
  const categoriesParam = currentFilters.categories ?? [];
  const locationsParam = currentFilters.locations ?? [];
  const companiesParam = currentFilters.companies ?? [];

  // View options & UI toggles
  const [viewOpts, setViewOpts] = React.useState<ViewOptions>(loadStoredView);
  const [showAdvSearch, setShowAdvSearch] = React.useState(false);
  const [showProvaModal, setShowProvaModal] = React.useState(false);
  const [pageLimit, setPageLimit] = React.useState(500);

  const updateView = (next: ViewOptions) => {
    setViewOpts(next);
    saveStoredView(next);
  };

  const lastFinishedAtRef = React.useRef<number | null>(null);
  const detailPushedRef = React.useRef(false);

  type CollectionInfo = NonNullable<Extract<LavoroState, { status: 'ready' }>['last']>;
  const [lastRaccolta, setLastRaccolta] = React.useState<CollectionInfo | null>(null);
  const [lastProva, setLastProva] = React.useState<CollectionInfo | null>(null);
  const [listError, setListError] = React.useState(false);

  const recordLast = React.useCallback((last: CollectionInfo | null) => {
    if (!last) return;
    if (last.kind === 'raccolta') {
      setLastRaccolta(last);
    } else if (last.kind === 'prova') {
      setLastProva(last);
    }
  }, []);

  // Counts local list edits (an optimistic change, its server confirmation, its rollback). A list read that started
  // before one of them may carry the old list, so it is dropped and read again instead of replacing the new one.
  const localEdits = React.useRef(0);
  const pareriDone = React.useRef(0);

  // Fetch data
  async function fetchData() {
    try {
      for (;;) {
        const started = localEdits.current;
        const [res, state] = await Promise.all([client.list.query(), client.state.query()]);
        if (started !== localEdits.current) continue;
        setData(res);
        setLavoroState(state);
        setListError(false);
        setLoading(false);
        if (state.status === 'ready' && state.last?.finishedAt) {
          lastFinishedAtRef.current = state.last.finishedAt;
          recordLast(state.last);
        }
        break;
      }
    } catch {
      setLoading(false);
      try {
        const state = await client.state.query();
        setLavoroState(state);
        if (state.status === 'ready') {
          setListError(true);
          if (state.last) recordLast(state.last);
        }
      } catch (err: unknown) {
        console.error('Failed to query lavoro state:', err);
        setListError(true);
      }
    }
  }

  const fetchRef = React.useRef(fetchData);
  React.useLayoutEffect(() => {
    fetchRef.current = fetchData;
  });

  // Listen to state subscription
  React.useEffect(() => {
    let active = true;
    client.state.query().then(
      (state: LavoroState) => {
        if (!active) return;
        setLavoroState(state);
        if (state.status === 'ready' && state.last?.finishedAt) {
          lastFinishedAtRef.current = state.last.finishedAt;
          recordLast(state.last);
        }
      },
      (err: unknown) => console.error('Failed to query initial lavoro state:', err),
    );
    const sub = client.onState.subscribe(undefined, {
      onData(s: LavoroState) {
        setLavoroState(s);
        if (s.status === 'ready' && s.pareri && s.pareri.done !== pareriDone.current) {
          pareriDone.current = s.pareri.done;
          void fetchRef.current();
        }
        if (s.status === 'ready' && s.last?.finishedAt) {
          recordLast(s.last);
          if (lastFinishedAtRef.current === null || s.last.finishedAt > lastFinishedAtRef.current) {
            lastFinishedAtRef.current = s.last.finishedAt;
            void fetchRef.current();
          }
        }
      },
    });
    void Promise.resolve().then(() => {
      if (active) void fetchRef.current();
    });
    return () => {
      active = false;
      sub.unsubscribe();
    };
  }, [client, recordLast]);

  // Update URL helper
  const updateSearch = React.useCallback(
    (patch: Record<string, string | undefined>, replace = true) => {
      if (Object.keys(patch).some((key) => key !== 'job'))
        listRef.current?.closest('[data-page-scroller]')?.scrollTo(0, 0);
      void navigate({
        to: '.',
        search: (prev: Record<string, unknown>) => {
          const next = { ...prev };
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === '') delete next[k];
            else next[k] = v;
          }
          return next;
        },
        replace,
        resetScroll: false,
      });
    },
    [navigate],
  );

  const userState: UserState = React.useMemo(() => ({}), []);
  const allJobs = data?.jobs ?? EMPTY_JOBS;
  const rules = data?.rules ?? EMPTY_RULES;

  // Compute segment counts over all jobs
  const segmentCounts = React.useMemo(() => {
    const counts: Record<AnnunciSegment, number> = {
      review: 0,
      archive: 0,
      blacklisted: 0,
      trash: 0,
    };
    for (const job of allJobs) {
      const seg = tabOf(job, userState, rules);
      if (seg === 'review' || seg === 'archive' || seg === 'blacklisted' || seg === 'trash') {
        counts[seg] += 1;
      }
    }
    return counts;
  }, [allJobs, userState, rules]);

  const pareriMissing = allJobs.filter(
    (job) => tabOf(job, undefined, rules) === 'review' && (!job.opinion || job.opinion.outdated),
  ).length;

  // Filter jobs by current segment (unless globe is active)
  const segmentJobs = React.useMemo(() => {
    if (isGlobe) return allJobs;
    const filtered = allJobs.filter((job) => tabOf(job, userState, rules) === currentSegment);
    if (currentSegment === 'blacklisted' && ruleParam !== undefined) {
      const activeRule = rules.find((r) => r.id === ruleParam);
      return filtered.filter((job) => {
        if (job.blacklistRule === ruleParam) return true;
        if (!activeRule) return false;
        return matchRule(activeRule, {
          company: job.company,
          title: job.title,
          description: job.description,
          location: job.location,
          site: job.site,
          work_mode: job.workMode,
          key: job.key,
        });
      });
    }
    return filtered;
  }, [allJobs, isGlobe, currentSegment, userState, rules, ruleParam]);

  // Apply search
  const parsedSearch = React.useMemo(() => parseFreeSearch(searchQuery), [searchQuery]);
  const searchedJobs = React.useMemo(() => {
    return segmentJobs.filter((job) => {
      if (!matchesFreeSearch(job, parsedSearch)) return false;
      if (!matchesAdvancedSearch(job, advancedSearch)) return false;
      return true;
    });
  }, [segmentJobs, parsedSearch, advancedSearch]);

  // Compute dynamic filter counts (ignoring own filter)
  const filterCounts = React.useMemo(() => {
    return computeFilterCounts(searchedJobs, currentFilters, now);
  }, [searchedJobs, currentFilters, now]);

  // Apply filters
  const filteredJobs = React.useMemo(() => {
    return searchedJobs.filter((job) => matchesFilters(job, currentFilters, now));
  }, [searchedJobs, currentFilters, now]);

  // Apply sorting
  const sortedJobs = React.useMemo(() => {
    return sortJobs(filteredJobs, sortOption);
  }, [filteredJobs, sortOption]);

  // The groups come from the rows already loaded. Closed groups stay out of `navJobs`, so the arrows and "7 di 16" follow what is on screen.
  const groups = React.useMemo(
    () => (sortOption === 'opinion' && currentSegment === 'review' ? groupJobs(sortedJobs) : null),
    [sortedJobs, sortOption, currentSegment],
  );
  const [openGroups, setOpenGroups] = React.useState(loadOpenGroups);
  const toggleGroup = React.useCallback((id: PostingGroupId) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      saveOpenGroups(next);
      return next;
    });
  }, []);
  const navJobs = React.useMemo(
    () => (groups ? groups.filter((g) => g.id !== 'fuori' || openGroups.has(g.id)).flatMap((g) => g.jobs) : sortedJobs),
    [groups, openGroups, sortedJobs],
  );

  // shortcut: grouped lists skip the 500-row page limit, upgrade if a segment ever holds thousands.
  const pagedJobs = React.useMemo(() => {
    return groups ? sortedJobs : sortedJobs.slice(0, pageLimit);
  }, [groups, sortedJobs, pageLimit]);

  const highlightTermsList = React.useMemo(() => {
    return highlightTerms(searchQuery, advancedSearch);
  }, [searchQuery, advancedSearch]);

  // Open detail dialog
  const activeDetailJob = (openPostingKey && data ? data.jobs.find((j) => j.key === openPostingKey) : null) ?? null;
  const activeDetailJobIndex = openPostingKey ? navJobs.findIndex((j) => j.key === openPostingKey) : -1;

  // The Dialog plays an exit after `open` turns false, so the job it shows must outlive the URL param.
  const [shownJob, setShownJob] = React.useState<JobRow | null>(null);
  if (activeDetailJob && activeDetailJob !== shownJob) setShownJob(activeDetailJob);
  const shownJobIndex = shownJob ? navJobs.findIndex((j) => j.key === shownJob.key) : -1;

  React.useEffect(() => {
    if (!activeDetailJob && shownJob) {
      listRef.current
        ?.querySelector(`[data-posting-key="${CSS.escape(shownJob.key)}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeDetailJob, shownJob]);

  // Both layouts open the detail through here, so closing it can always go Back.
  const openDetail = (key: string) => {
    detailPushedRef.current = true;
    updateSearch({ job: key }, false);
  };

  const closeDetail = () => {
    void fetchData();
    if (openPostingKey) {
      if (detailPushedRef.current) {
        detailPushedRef.current = false;
        window.history.back();
      } else {
        updateSearch({ job: undefined }, true);
      }
    }
  };

  React.useEffect(() => {
    if (!activeDetailJob) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (activeDetailJobIndex > 0) {
          const prev = navJobs[activeDetailJobIndex - 1];
          if (prev) updateSearch({ job: prev.key });
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (activeDetailJobIndex < navJobs.length - 1) {
          const next = navJobs[activeDetailJobIndex + 1];
          if (next) updateSearch({ job: next.key });
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeDetailJob, activeDetailJobIndex, navJobs, updateSearch]);

  interface ToastItem {
    id: string;
    message: string;
    undo?: () => Promise<void>;
  }
  const [toast, setToast] = React.useState<ToastItem | null>(null);
  const toastTimerRef = React.useRef<number | null>(null);

  const showToast = React.useCallback((message: string, undo?: () => Promise<void>) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    const id = String(Date.now());
    setToast({ id, message, undo });
    toastTimerRef.current = window.setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, 6000);
  }, []);

  const [purgeKeys, setPurgeKeys] = React.useState<string[]>([]);
  const purgeJobsList = React.useMemo(() => {
    if (!data || !purgeKeys.length) return [];
    const keySet = new Set(purgeKeys);
    return data.jobs.filter((j) => keySet.has(j.key)).slice(0, 5);
  }, [data, purgeKeys]);

  const [groupConfirm, setGroupConfirm] = React.useState<{
    action: 'archive' | 'restore';
    keys: string[];
  } | null>(null);

  const handleSetFlagRef = React.useRef<
    | ((
        keys: string[],
        flag: 'archived' | 'deleted' | 'applied',
        value: boolean,
        toastMsg: string,
        reverseMsg: string,
      ) => Promise<void>)
    | null
  >(null);

  const handleSetFlag = async (
    keys: string[],
    flag: 'archived' | 'deleted' | 'applied',
    value: boolean,
    toastMsg: string,
    reverseMsg: string,
  ) => {
    const keySet = new Set(keys);
    const nowMs = Date.now();

    // If open posting leaves the list due to this action, advance detail to next job first
    if (openPostingKey && keySet.has(openPostingKey) && (flag === 'archived' || flag === 'deleted') && value) {
      const currentIndex = navJobs.findIndex((j) => j.key === openPostingKey);
      const nextJob = navJobs[currentIndex + 1] ?? navJobs[currentIndex - 1];
      if (nextJob && !keySet.has(nextJob.key)) {
        updateSearch({ job: nextJob.key }, true);
      } else {
        updateSearch({ job: undefined }, true);
      }
    }

    // Optimistic update with functional state
    let prevJobs: JobRow[] = [];
    localEdits.current += 1;
    setData((current) => {
      if (!current) return current;
      prevJobs = current.jobs;
      const nextJobs = current.jobs.map((job) => {
        if (!keySet.has(job.key)) return job;
        if (flag === 'archived') {
          return { ...job, archivedAt: value ? nowMs : null };
        }
        if (flag === 'deleted') {
          return { ...job, deletedAt: value ? nowMs : null };
        }
        if (flag === 'applied') {
          return {
            ...job,
            application: value
              ? {
                  appliedAt: nowMs,
                  status: 'pending' as const,
                  closedAt: null,
                  reason: null,
                  notes: null,
                  interviews: [],
                }
              : null,
          };
        }
        return job;
      });
      return { ...current, jobs: withCompanyApplications(nextJobs) };
    });

    // Undo function always delegates to latest ref
    const undoFn = async () => {
      await handleSetFlagRef.current?.(keys, flag, !value, reverseMsg, toastMsg);
    };

    showToast(toastMsg, undoFn);

    try {
      for (let i = 0; i < keys.length; i += 500) {
        const chunk = keys.slice(i, i + 500);
        await client.setFlag.mutate({
          keys: chunk,
          flag,
          value,
          ...(flag === 'applied' && !value && { confirmed: true }),
        });
      }
      localEdits.current += 1;
    } catch (err) {
      localEdits.current += 1;
      setData((current) => (current ? { ...current, jobs: prevJobs } : current));
      showToast(copy.actions.toast_error);
      throw err;
    }
  };

  React.useLayoutEffect(() => {
    handleSetFlagRef.current = handleSetFlag;
  });

  const handleUpdateJob = (updated: JobRow) => {
    localEdits.current += 1;
    setData((current) => {
      if (!current) return current;
      return {
        ...current,
        jobs: withCompanyApplications(current.jobs.map((j) => (j.key === updated.key ? updated : j))),
      };
    });
  };

  const handlePurge = async (keys: string[]) => {
    if (!data) return;
    const prevJobs = data.jobs;
    const keySet = new Set(keys);

    if (openPostingKey && keySet.has(openPostingKey)) {
      const currentIndex = navJobs.findIndex((j) => j.key === openPostingKey);
      const nextJob = navJobs[currentIndex + 1] ?? navJobs[currentIndex - 1];
      if (nextJob && !keySet.has(nextJob.key)) {
        updateSearch({ job: nextJob.key }, true);
      } else {
        updateSearch({ job: undefined }, true);
      }
    }

    // Optimistic update
    localEdits.current += 1;
    setData({ ...data, jobs: data.jobs.filter((j) => !keySet.has(j.key)) });
    setPurgeKeys([]);
    showToast(copy.actions.toast_purged(keys.length));

    try {
      for (let i = 0; i < keys.length; i += 500) {
        const chunk = keys.slice(i, i + 500);
        await client.purge.mutate({ keys: chunk, confirmed: true });
      }
      localEdits.current += 1;
    } catch (err) {
      localEdits.current += 1;
      setData((current) => (current ? { ...current, jobs: prevJobs } : current));
      showToast(copy.actions.toast_error);
      throw err;
    }
  };

  // Rules handlers with Undo
  const handleCreateRule = async (input: {
    field: BlacklistField;
    matchType: (typeof blacklistMatchTypes)[number];
    value: string;
    note: string;
    enabled: boolean;
  }) => {
    const res = await client.rules.create.mutate(input);
    await fetchData();
    showToast(copy.rules.toast_created, async () => {
      await client.rules.delete.mutate({ id: res.id, confirmed: true });
      await fetchData();
    });
  };

  const handleUpdateRule = async (input: {
    id: number;
    field: BlacklistField;
    matchType: (typeof blacklistMatchTypes)[number];
    value: string;
    note: string;
    enabled: boolean;
  }) => {
    await client.rules.update.mutate(input);
    await fetchData();
    showToast(copy.rules.toast_updated);
  };

  const handleDeleteRule = async (id: number) => {
    const target = rules.find((r) => r.id === id);
    await client.rules.delete.mutate({ id, confirmed: true });
    await fetchData();
    if (target) {
      showToast(copy.rules.toast_deleted, async () => {
        await client.rules.create.mutate({
          field: target.field,
          matchType: target.matchType,
          value: target.value,
          note: target.note,
          enabled: target.enabled,
        });
        await fetchData();
      });
    }
  };

  const handleToggleRuleEnabled = async (id: number, enabled: boolean) => {
    await client.rules.setEnabled.mutate({ id, enabled });
    await fetchData();
  };

  const handleIncludeAgain = async (key: string) => {
    await client.rules.include.mutate({ key });
    await fetchData();
    showToast(copy.rules.toast_included, async () => {
      await client.rules.create.mutate({
        field: 'key',
        matchType: 'equals',
        value: key,
        note: 'Esclusione ripristinata',
        enabled: true,
      });
      await fetchData();
    });
  };

  const handleExcludeCompany = async (comp: string) => {
    const res = await client.rules.create.mutate({
      field: 'company',
      matchType: 'equals',
      value: comp,
      note: `Esclusione ${comp}`,
      enabled: true,
    });
    await fetchData();
    showToast(copy.rules.toast_blacklisted, async () => {
      await client.rules.delete.mutate({ id: res.id, confirmed: true });
      await fetchData();
    });
  };

  const handleExcludePosting = async (key: string, title: string) => {
    const res = await client.rules.create.mutate({
      field: 'key',
      matchType: 'equals',
      value: key,
      note: `Esclusione ${title}`,
      enabled: true,
    });
    await fetchData();
    showToast(copy.rules.toast_blacklisted, async () => {
      await client.rules.delete.mutate({ id: res.id, confirmed: true });
      await fetchData();
    });
  };

  const handleCustomRule = (posting: JobRow) => {
    setPrefilledRule({
      field: 'company',
      matchType: 'equals',
      value: posting.company,
      note: `Esclusione da ${posting.title}`,
    });
    closeDetail();
    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({ ...prev, tab: 'regole' }),
      replace: true,
    });
  };

  const handleViewRulePostings = (ruleId: number) => {
    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        tab: undefined,
        segment: 'blacklisted',
        rule: String(ruleId),
      }),
      replace: true,
    });
  };

  // Import and Edit handlers
  const handleImportRead = async (url: string) => {
    return await client.importRead.mutate({ url });
  };

  const handleImportSave = async (job: Parameters<typeof client.importSave.mutate>[0]['job']) => {
    const res = await client.importSave.mutate({ job });
    await fetchData();
    showToast(copy.import.toast_imported);
    return res;
  };

  const handleEditSave = async (key: string, updated: Parameters<typeof client.edit.mutate>[0]['job']) => {
    await client.edit.mutate({ key, job: updated });
    await fetchData();
    showToast(copy.edit.toast_edited);
  };

  const hasActiveFilters = Boolean(
    firstSeenPreset !== 'always' ||
    minScoreParam !== undefined ||
    workModesParam.length ||
    sourcesParam.length ||
    categoriesParam.length ||
    locationsParam.length ||
    companiesParam.length ||
    searchQuery ||
    advancedSearch ||
    ruleParam !== undefined,
  );

  const activeFiltersCount =
    (firstSeenPreset !== 'always' ? 1 : 0) +
    (minScoreParam !== undefined ? 1 : 0) +
    (ruleParam !== undefined ? 1 : 0) +
    workModesParam.length +
    sourcesParam.length +
    categoriesParam.length +
    locationsParam.length +
    companiesParam.length;

  if (lavoroState?.status === 'invalid-config') {
    return (
      <>
        <PageSurface>
          <Panel title={copy.zone_title} className="p-lg">
            <div className="flex flex-col gap-md text-danger">
              <h2 className="text-title font-semibold">{copy.config_error.title}</h2>
              <p className="text-body text-muted-foreground">{copy.config_error.description}</p>
              <ul className="list-disc pl-lg text-label">
                {lavoroState.issues.map((issue, idx) => (
                  <li key={idx}>
                    <strong>{issue.path}:</strong> {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          </Panel>
        </PageSurface>
      </>
    );
  }

  return (
    <>
      <ZoneTabs
        tabs={[
          {
            id: 'annunci',
            label: copy.tab_annunci,
            content: (
              <div className="flex min-h-0 flex-1 flex-col gap-lg">
                <TabBarRow>
                  <div className="flex shrink-0 flex-col gap-lg">
                    <TopBar
                      currentSegment={currentSegment}
                      isGlobe={isGlobe}
                      segmentCounts={segmentCounts}
                      loading={loading}
                      lavoroState={lavoroState}
                      lastRaccolta={lastRaccolta}
                      lastProva={lastProva}
                      now={now}
                      onSelectSegment={(seg) => {
                        updateSearch({
                          segment: seg === 'review' ? undefined : seg,
                          modes: undefined,
                          sources: undefined,
                          cats: undefined,
                          locs: undefined,
                          companies: undefined,
                        });
                      }}
                      onRaccogli={async () => {
                        await client.raccogli.mutate();
                      }}
                      pareriMissing={pareriMissing}
                      onPareriMancanti={async () => {
                        await client.pareriMancanti.mutate();
                      }}
                      onAnnulla={async () => {
                        await client.annulla.mutate();
                      }}
                      onShowProvaModal={() => setShowProvaModal(true)}
                      searchQuery={searchQuery}
                      onSearchChange={(q) => updateSearch({ q: q || undefined })}
                      onToggleGlobe={() => updateSearch({ globe: isGlobe ? undefined : '1' })}
                      showAdvSearch={showAdvSearch}
                      advancedSearchActive={Boolean(advancedSearch)}
                      onToggleAdvSearch={() => setShowAdvSearch((v) => !v)}
                      activeFiltersCount={activeFiltersCount}
                      firstSeenPreset={firstSeenPreset}
                      minScoreParam={minScoreParam}
                      filterCounts={filterCounts}
                      workModesParam={workModesParam}
                      sourcesParam={sourcesParam}
                      categoriesParam={categoriesParam}
                      onUpdateFilters={updateSearch}
                      sortedCount={sortedJobs.length}
                      allCount={allJobs.length}
                      hasActiveFilters={hasActiveFilters}
                      sortOption={sortOption}
                      onSortChange={(v) => updateSearch({ sort: v === 'opinion' ? undefined : v })}
                      viewOpts={viewOpts}
                      onUpdateView={updateView}
                      onOpenImport={() => setShowImportDialog(true)}
                    />

                    <AdvancedSearchBar
                      show={showAdvSearch}
                      advWholeWords={advWholeWords}
                      advMode={advMode}
                      advTitle={advTitle}
                      advCompany={advCompany}
                      advDesc={advDesc}
                      advLoc={advLoc}
                      onUpdate={updateSearch}
                    />

                    <FilterChips
                      hasActiveFilters={hasActiveFilters}
                      searchQuery={searchQuery}
                      firstSeenPreset={firstSeenPreset}
                      minScoreParam={minScoreParam}
                      workModesParam={workModesParam}
                      sourcesParam={sourcesParam}
                      categoriesParam={categoriesParam}
                      locationsParam={locationsParam}
                      companiesParam={companiesParam}
                      ruleParam={ruleParam}
                      rules={rules}
                      onUpdate={updateSearch}
                    />
                  </div>
                </TabBarRow>

                <div ref={listRef} key={currentSegment} className="pb-xl">
                  <PostingsList
                    currentSegment={currentSegment}
                    hasActiveFilters={hasActiveFilters}
                    listError={listError}
                    loaded={data !== null}
                    filteredJobs={filteredJobs}
                    allJobsCount={allJobs.length}
                    pagedJobs={pagedJobs}
                    groups={groups}
                    openGroups={openGroups}
                    onToggleGroup={toggleGroup}
                    sortedJobsCount={sortedJobs.length}
                    pageLimit={pageLimit}
                    viewOpts={viewOpts}
                    now={now}
                    rules={rules}
                    userState={userState}
                    isGlobe={isGlobe}
                    highlightTermsList={highlightTermsList}
                    onOpenDetail={openDetail}
                    onSetFlag={handleSetFlag}
                    onPurge={(keys) => setPurgeKeys(keys)}
                    onIncludeAgain={handleIncludeAgain}
                    onGroupConfirm={(confirm) => setGroupConfirm(confirm)}
                    onRetry={() => {
                      setListError(false);
                      setLoading(true);
                      void fetchData();
                    }}
                    onResetFilters={() => {
                      updateSearch({
                        q: undefined,
                        globe: undefined,
                        adv_title: undefined,
                        adv_company: undefined,
                        adv_desc: undefined,
                        adv_loc: undefined,
                        fs: undefined,
                        score: undefined,
                        modes: undefined,
                        sources: undefined,
                        cats: undefined,
                        locs: undefined,
                        companies: undefined,
                        rule: undefined,
                      });
                    }}
                    onLoadMore={() => setPageLimit((l) => l + 500)}
                  />
                </div>
              </div>
            ),
          },
          {
            id: 'candidature',
            label: copy.tab_candidature,
            content: (
              <CandidaturePage
                jobs={allJobs}
                now={now}
                onOpenDetail={openDetail}
                mailCheck={lavoroState?.status === 'ready' ? lavoroState.mailCheck : null}
                onChanged={() => void fetchData()}
                loaded={data !== null}
              />
            ),
          },
          {
            id: 'statistiche',
            label: copy.tab_statistiche,
            content:
              data === null ? (
                <LoadingSkeleton variant="centered" label={copy.widget.loading} />
              ) : (
                <StatsPage jobs={allJobs} onChanged={() => void fetchData()} />
              ),
          },
          {
            id: 'regole',
            label: copy.tab_regole,
            count: rules.length,
            content:
              data === null ? (
                <LoadingSkeleton variant="centered" label={copy.widget.loading} />
              ) : (
                <RulesPage
                  rules={rules}
                  jobs={allJobs}
                  onCreateRule={handleCreateRule}
                  onUpdateRule={handleUpdateRule}
                  onDeleteRule={handleDeleteRule}
                  onToggleEnabled={handleToggleRuleEnabled}
                  onViewRulePostings={handleViewRulePostings}
                  onOpenDetail={openDetail}
                  prefilledRule={prefilledRule}
                  onClearPrefilled={() => setPrefilledRule(null)}
                />
              ),
          },
        ]}
      />

      <DetailDialog
        activeDetailJob={activeDetailJob ? activeDetailJob.key : null}
        shownJob={shownJob}
        detailIndex={shownJobIndex}
        totalVisible={navJobs.length}
        userState={userState}
        rules={rules}
        now={now}
        toast={toast}
        onClose={closeDetail}
        onPrev={() => {
          const prev = navJobs[shownJobIndex - 1];
          if (prev) updateSearch({ job: prev.key });
        }}
        onNext={() => {
          const next = navJobs[shownJobIndex + 1];
          if (next) updateSearch({ job: next.key });
        }}
        onSetFlag={handleSetFlag}
        onPurge={(keys) => setPurgeKeys(keys)}
        onDismissToast={() => setToast(null)}
        onExcludeCompany={handleExcludeCompany}
        onExcludePosting={handleExcludePosting}
        onCustomRule={handleCustomRule}
        onIncludeAgain={handleIncludeAgain}
        onOpenEdit={(job) => setEditingJob(job)}
        onPrepareCandidatura={async (key) => {
          try {
            await client.openCandidatura.mutate({ key });
            showToast(copy.detail.toast_candidatura_opened);
          } catch (error) {
            showToast(error instanceof Error ? error.message : copy.actions.toast_error);
          }
        }}
        onCopyCommand={async (key) => {
          try {
            const prompt = await client.candidaturaPrompt.query({ key });
            await navigator.clipboard.writeText(prompt);
            showToast(copy.detail.toast_command_copied);
          } catch {
            showToast(copy.detail.toast_command_failed);
          }
        }}
        onRefetchDescription={async (key) => {
          await client.refetchDescription.mutate({ key });
          await fetchData();
        }}
        applicationPanel={
          shownJob?.application ? (
            <ApplicationPanel
              job={shownJob}
              now={now}
              onJobChange={handleUpdateJob}
              onUnapply={async (key) => {
                await handleSetFlag([key], 'applied', false, copy.actions.toast_unapplied, copy.actions.toast_applied);
              }}
              onToast={(msg) => showToast(msg)}
            />
          ) : undefined
        }
      />

      <ImportDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onRead={handleImportRead}
        onSave={handleImportSave}
        onOpenDetail={openDetail}
      />

      <EditPostingDialog
        job={editingJob}
        open={editingJob !== null}
        onOpenChange={(open) => {
          if (!open) setEditingJob(null);
        }}
        onSave={handleEditSave}
      />

      <ProvaDialog open={showProvaModal} onOpenChange={setShowProvaModal} state={lavoroState} />

      <GroupConfirmDialog
        groupAction={groupConfirm}
        onClose={() => setGroupConfirm(null)}
        onConfirm={async () => {
          if (!groupConfirm) return;
          const { action, keys } = groupConfirm;
          setGroupConfirm(null);
          if (action === 'archive') {
            await handleSetFlag(
              keys,
              'archived',
              true,
              copy.actions.toast_archived(keys.length),
              copy.actions.toast_restored(keys.length),
            );
          } else {
            await handleSetFlag(
              keys,
              'archived',
              false,
              copy.actions.toast_restored(keys.length),
              copy.actions.toast_archived(keys.length),
            );
          }
        }}
      />

      <PurgeConfirmDialog
        purgeKeys={purgeKeys}
        onClose={() => setPurgeKeys([])}
        onConfirm={handlePurge}
        previewJobs={purgeJobsList}
      />

      {!activeDetailJob && <ToastNotification toast={toast} onDismiss={() => setToast(null)} />}
    </>
  );
}

/** Oggi's Lavoro lines (step 66): fed by `lavoro.summary` with live `onState` invalidation, no polling interval. */
function useLavoroToday(day: TodayDay): TodayLine[] | null {
  const { summary } = useLavoroSummary();
  const data = summary.data;
  if (!data) return null;
  const parts = todayParts(data.reviewToday, data.interviewsThisWeek);
  if (day !== 'today' || !parts.length) return null;
  return parts.map((part) => ({ id: `lavoro-${part.href}`, chip: copy.today.chip, text: part.text, href: part.href }));
}

/** The state the shell's activity hooks follow; the page keeps its own subscription. */
function useLavoroState() {
  const client = React.useMemo(() => createModuleClient<typeof definition>('lavoro'), []);
  const [state, setState] = React.useState<LavoroState | null>(null);
  React.useEffect(() => {
    client.state.query().then(setState, () => {});
    const sub = client.onState.subscribe(undefined, { onData: setState });
    return () => sub.unsubscribe();
  }, [client]);
  return state;
}

function useCollectionActivity(): ModuleActivity | null {
  const state = useLavoroState();
  if (state?.status !== 'ready' || !state.collection) return null;
  const { kind, searchesDone, searchesTotal } = state.collection;
  return {
    id: 'collection',
    label: kind === 'prova' ? copy.activity.prova : copy.activity.collect,
    detail: copy.activity.searches(Math.min(searchesDone, searchesTotal), searchesTotal),
    progress: searchesTotal > 0 ? Math.min(1, searchesDone / searchesTotal) : undefined,
    href: '/desk/ricerca',
  };
}

function usePareriActivity(): ModuleActivity | null {
  const state = useLavoroState();
  if (state?.status !== 'ready' || !state.pareri?.running) return null;
  const { done, remaining } = state.pareri;
  return {
    id: 'pareri',
    label: copy.activity.pareri,
    detail: copy.pareri.running(done, done + remaining),
    progress: done + remaining > 0 ? done / (done + remaining) : undefined,
    href: '/desk/ricerca',
  };
}

export default {
  name: 'lavoro',
  activities: [useCollectionActivity, usePareriActivity],
  calendarItems: useLavoroCalendarItems,
  // Built-in modules come before private ones in `moduleUIs`, so step 38's post-it notes will stay above "Da fare".
  todayItems: [useLavoroToday, useMailTodos],
  records: [lavoroPostings, lavoroApplications],
  widgets: [
    { id: 'lavoro', label: () => copy.widget.title, sizes: ['small', 'medium', 'large'], component: LavoroWidget },
  ],
  copy: { title: copy.zone_title },
  zone: {
    id: 'ricerca',
    label: () => copy.zone_title,
    icon: BinocularsIcon,
    page: RicercaZonePage,
    fill: true,
    ownTabs: true,
  },
} satisfies ModuleUI;
