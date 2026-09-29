'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileText,
  LayoutDashboard,
  PartyPopper,
  Leaf,
  LoaderCircle,
  LogOut,
  RefreshCw,
  Search,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import CombinedReportView from '@/app/combined-report-view';
import CompanyEventsPanel from '@/app/company-events-panel';
import TeamSwitcher from '@/app/team-switcher';
import { COMPANY_COLOR, companyEventAsTask } from '@/lib/company-events';
import { ALL_TEAMS_ID } from '@/lib/team-access';
import type { CompanyEvent, OverviewTeam, Task, Team } from '@/lib/types';

type Tab = 'today' | 'calendar' | 'tasks' | 'team' | 'requests' | 'events' | 'report';
type OverviewTask = OverviewTeam['tasks'][number] & { team: Team };
/** 전사 일정을 통합 캘린더에 함께 그리기 위한 가상 팀입니다. */
const companyTeam: Team = {
  id: '__company__',
  name: '전사 일정',
  color: COMPANY_COLOR,
  active: true,
  sortOrder: -1,
};

const tabs: { id: Tab; label: string; icon: typeof Bell }[] = [
  { id: 'today', label: '오늘', icon: LayoutDashboard },
  { id: 'calendar', label: '캘린더', icon: CalendarDays },
  { id: 'tasks', label: '전체 업무', icon: ClipboardList },
  { id: 'team', label: '팀 현황', icon: Users },
  { id: 'requests', label: '완료 요청', icon: Bell },
  { id: 'events', label: '전사 일정', icon: PartyPopper },
  { id: 'report', label: '통합 보고서', icon: FileText },
];
const statusLabel: Record<Task['status'], string> = {
  scheduled: '예정',
  in_progress: '진행 중',
  completion_requested: '완료 요청',
  completed: '최종 완료',
};
const inputClass =
  'h-10 w-full rounded-xl border border-[#d8ded4] bg-white px-3 text-sm outline-none focus:border-[#2f6b4f]';

function today() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}
function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const endOf = (task: Task) => task.endDate ?? task.date;
const isOpen = (task: Task) => task.status !== 'completed';
const coversDay = (task: Task, day: string) => task.date <= day && endOf(task) >= day;
const isOverdue = (task: Task, day: string) => isOpen(task) && endOf(task) < day;
const formatDay = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  });

/** 마스터 전용 '전체 팀' 통합 관제. 모든 팀의 업무를 읽기 전용으로 모아 보고, 완료 요청만 여기서 처리합니다.
 * 업무 등록·수정은 해당 팀으로 들어가서 합니다. */
export default function MasterOverview({
  teams: switchableTeams,
  accessToken,
  onSwitchTeam,
  onSignOut,
}: {
  teams: Team[];
  accessToken: string;
  onSwitchTeam: (teamId: string) => void;
  onSignOut: () => Promise<void>;
}) {
  const [overview, setOverview] = useState<OverviewTeam[] | null>(null);
  const [companyEvents, setCompanyEvents] = useState<CompanyEvent[]>([]);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('today');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<OverviewTask | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/overview', {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      });
      if (response.status === 401) {
        await onSignOut();
        return;
      }
      const result = (await response.json()) as {
        teams?: OverviewTeam[];
        companyEvents?: CompanyEvent[];
        error?: string;
      };
      if (!response.ok || !result.teams)
        throw new Error(result.error ?? '전체 팀 현황을 불러오지 못했습니다.');
      setOverview(result.teams);
      setCompanyEvents(result.companyEvents ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, onSignOut]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const tasks = useMemo<OverviewTask[]>(
    () =>
      (overview ?? []).flatMap((entry) =>
        entry.tasks.map((task) => ({ ...task, team: entry.team })),
      ),
    [overview],
  );
  const memberName = useCallback(
    (teamId: string, memberId: string) =>
      overview
        ?.find((entry) => entry.team.id === teamId)
        ?.members.find((member) => member.id === memberId)?.name ?? '',
    [overview],
  );

  async function decide(task: OverviewTask, status: 'completed' | 'in_progress') {
    try {
      const response = await fetch('/api/overview', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ teamId: task.team.id, taskId: task.id, status }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? '처리하지 못했습니다.');
      setSelected(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '처리하지 못했습니다.');
    }
  }

  const requests = tasks.filter((task) => task.status === 'completion_requested');

  return (
    <main className="min-h-screen bg-[#f5f3ec] text-[#26352d] print:bg-white">
      <header className="sticky top-0 z-40 flex h-16 print:hidden items-center justify-between border-b border-[#d8ded4] bg-[#fbfaf5]/95 px-4 backdrop-blur md:px-7">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-2xl bg-[#26352d] text-white shadow-sm">
            <Leaf className="size-5" />
          </div>
          <div>
            <p className="hidden text-[11px] font-bold tracking-[0.12em] text-[#708076] sm:block">
              SNOOPY GARDEN · MASTER
            </p>
            <h1 className="text-sm font-extrabold tracking-tight sm:text-base">
              전체 팀 통합 관제
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="rounded-full bg-white"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">새로고침</span>
          </Button>
          <Button
            aria-label="로그아웃"
            title="로그아웃"
            variant="outline"
            size="icon"
            className="rounded-full bg-white"
            onClick={() => void onSignOut()}
          >
            <LogOut />
          </Button>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1680px] md:grid-cols-[230px_minmax(0,1fr)] print:block">
        <aside className="border-b border-[#d8ded4] bg-[#fbfaf5] p-4 md:min-h-[calc(100vh-64px)] md:border-b-0 md:border-r print:hidden">
          <TeamSwitcher
            current={ALL_TEAMS_ID}
            teams={switchableTeams}
            isMaster
            onSwitch={onSwitchTeam}
          />
          <nav className="flex gap-1 overflow-x-auto md:block md:space-y-1" aria-label="통합 관제 메뉴">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold md:w-full ${tab === id ? 'bg-[#e3eee7] text-[#245b43]' : 'text-[#6a776e] hover:bg-[#efeee8]'}`}
              >
                <Icon className="size-4" />
                {label}
                {id === 'requests' && requests.length > 0 && (
                  <span className="ml-auto rounded-full bg-[#a83f36] px-1.5 text-[10px] font-black text-white">
                    {requests.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <p className="mt-6 hidden text-xs leading-5 text-[#748078] md:block">
            여기서는 모든 팀을 읽기 전용으로 모아 봅니다. 업무 등록·수정은 위의 팀 선택에서 해당 팀으로 들어가서 합니다.
          </p>
        </aside>

        <section className="min-w-0 p-4 pb-16 md:p-7 print:p-0">
          {error && (
            <p role="alert" className="mb-4 rounded-xl bg-[#f7e8e4] px-3 py-2 text-sm font-semibold text-[#8d342e]">
              {error}
            </p>
          )}
          {!overview ? (
            <p className="flex items-center gap-2 text-sm text-[#748078]">
              <LoaderCircle className="size-4 animate-spin" /> 전체 팀 현황을 불러오는 중입니다.
            </p>
          ) : (
            <>
              {tab === 'today' && (
                <TodaySummary overview={overview} onOpenTeam={onSwitchTeam} />
              )}
              {tab === 'calendar' && (
                <OverviewCalendar
                  teams={[
                    ...(companyEvents.length ? [companyTeam] : []),
                    ...overview.map((entry) => entry.team),
                  ]}
                  tasks={[
                    ...companyEvents.map((event) => ({
                      ...companyEventAsTask(event),
                      commentCount: 0,
                      team: companyTeam,
                    })),
                    ...tasks,
                  ]}
                  onSelect={(task) =>
                    task.team.id === companyTeam.id ? setTab('events') : setSelected(task)
                  }
                />
              )}
              {tab === 'tasks' && (
                <TaskList
                  teams={overview.map((entry) => entry.team)}
                  tasks={tasks}
                  memberName={memberName}
                  onSelect={setSelected}
                />
              )}
              {tab === 'team' && <TeamLoad overview={overview} />}
              {tab === 'events' && (
                <CompanyEventsPanel
                  events={companyEvents}
                  teams={overview.map((entry) => entry.team)}
                  accessToken={accessToken}
                  onChanged={setCompanyEvents}
                />
              )}
              {tab === 'report' && <CombinedReportView accessToken={accessToken} />}
              {tab === 'requests' && (
                <Requests
                  tasks={requests}
                  memberName={memberName}
                  onSelect={setSelected}
                  decide={decide}
                />
              )}
            </>
          )}
        </section>
      </div>

      {selected && (
        <TaskPreview
          task={selected}
          memberName={memberName}
          close={() => setSelected(null)}
          goToTeam={() => onSwitchTeam(selected.team.id)}
          decide={decide}
        />
      )}
    </main>
  );
}

function TeamBadge({ team }: { team: Team }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black text-white"
      style={{ background: team.color }}
    >
      {team.name}
    </span>
  );
}

function TodaySummary({
  overview,
  onOpenTeam,
}: {
  overview: OverviewTeam[];
  onOpenTeam: (teamId: string) => void;
}) {
  const day = today();
  const week = shiftDate(day, 7);
  return (
    <div>
      <h2 className="mb-1 text-2xl font-black">오늘 전체 팀 현황</h2>
      <p className="mb-5 text-sm text-[#5f6d64]">카드를 누르면 그 팀 화면으로 들어갑니다.</p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {overview.map(({ team, tasks, members, openNotes }) => {
          const stats = [
            ['오늘 업무', tasks.filter((t) => isOpen(t) && coversDay(t, day)).length],
            ['완료 요청', tasks.filter((t) => t.status === 'completion_requested').length],
            ['지연', tasks.filter((t) => isOverdue(t, day)).length],
            ['D-7 이내', tasks.filter((t) => isOpen(t) && t.date >= day && t.date <= week).length],
          ] as const;
          return (
            <button
              key={team.id}
              onClick={() => onOpenTeam(team.id)}
              className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-5 text-left transition hover:border-[#2f6b4f] hover:shadow-sm"
            >
              <div className="flex items-center gap-2">
                <span className="size-3 rounded-full" style={{ background: team.color }} />
                <strong className="text-lg font-black">{team.name}</strong>
                <span className="ml-auto text-xs font-bold text-[#748078]">
                  {members.filter((m) => m.active).length}명
                </span>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-2">
                {stats.map(([label, value]) => (
                  <div key={label} className="rounded-2xl bg-white p-2.5 text-center">
                    <p
                      className={`text-xl font-black ${label === '지연' && value > 0 ? 'text-[#a83f36]' : label === '완료 요청' && value > 0 ? 'text-[#806743]' : ''}`}
                    >
                      {value}
                    </p>
                    <p className="text-[10px] font-bold text-[#748078]">{label}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-[#748078]">미처리 특이사항 {openNotes}건</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OverviewCalendar({
  teams,
  tasks,
  onSelect,
}: {
  teams: Team[];
  tasks: OverviewTask[];
  onSelect: (task: OverviewTask) => void;
}) {
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const first = new Date(`${month}-01T12:00:00Z`);
  const start = shiftDate(`${month}-01`, -first.getUTCDay());
  const days = Array.from({ length: 42 }, (_, index) => shiftDate(start, index));
  const shown = tasks.filter((task) => !hidden.has(task.team.id));
  const moveMonth = (delta: number) => {
    const date = new Date(`${month}-15T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + delta);
    setMonth(date.toISOString().slice(0, 7));
  };
  const day = today();
  return (
    <div className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" aria-label="이전 달" onClick={() => moveMonth(-1)}>
          <ChevronLeft />
        </Button>
        <strong className="min-w-28 text-center text-lg font-black">
          {month.replace('-', '년 ')}월
        </strong>
        <Button variant="outline" size="icon" aria-label="다음 달" onClick={() => moveMonth(1)}>
          <ChevronRight />
        </Button>
        <Button variant="outline" onClick={() => setMonth(day.slice(0, 7))}>
          오늘
        </Button>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {teams.map((team) => {
            const off = hidden.has(team.id);
            return (
              <button
                key={team.id}
                onClick={() =>
                  setHidden((current) => {
                    const next = new Set(current);
                    if (next.has(team.id)) next.delete(team.id);
                    else next.add(team.id);
                    return next;
                  })
                }
                aria-pressed={!off}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${off ? 'border-[#d8ded4] bg-white text-[#9aa39c]' : 'border-transparent bg-white text-[#26352d] shadow-sm'}`}
              >
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: off ? '#d1d5db' : team.color }}
                />
                {team.name}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-xs font-bold text-[#748078]">
        {['일', '월', '화', '수', '목', '금', '토'].map((label) => (
          <div key={label} className="py-1.5">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-2xl border border-[#e0e3de] bg-[#e0e3de]">
        {days.map((date) => {
          const items = shown
            .filter((task) => coversDay(task, date))
            .sort((a, b) => a.team.sortOrder - b.team.sortOrder || a.date.localeCompare(b.date));
          const inMonth = date.startsWith(month);
          return (
            <div
              key={date}
              className={`min-h-28 bg-white p-1.5 ${inMonth ? '' : 'bg-[#f7f7f3] text-[#a3aaa5]'}`}
            >
              <p
                className={`mb-1 text-xs font-black ${date === day ? 'inline-grid size-5 place-items-center rounded-full bg-[#2f6b4f] text-white' : ''}`}
              >
                {Number(date.slice(8))}
              </p>
              <div className="space-y-0.5">
                {items.slice(0, 4).map((task) => (
                  <button
                    key={`${task.team.id}:${task.id}`}
                    onClick={() => onSelect(task)}
                    title={`[${task.team.name}] ${task.title}`}
                    className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-bold text-white ${task.status === 'completed' ? 'opacity-50' : ''}`}
                    style={{ background: task.team.color }}
                  >
                    {task.priority === 'urgent' ? '! ' : ''}
                    {task.title}
                  </button>
                ))}
                {items.length > 4 && (
                  <p className="px-1 text-[10px] font-bold text-[#748078]">+{items.length - 4}건</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TaskList({
  teams,
  tasks,
  memberName,
  onSelect,
}: {
  teams: Team[];
  tasks: OverviewTask[];
  memberName: (teamId: string, memberId: string) => string;
  onSelect: (task: OverviewTask) => void;
}) {
  const [teamFilter, setTeamFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'open' | 'overdue' | Task['status'] | 'all'>('open');
  const [query, setQuery] = useState('');
  const day = today();
  const rows = tasks
    .filter((task) => teamFilter === 'all' || task.team.id === teamFilter)
    .filter((task) =>
      statusFilter === 'all'
        ? true
        : statusFilter === 'open'
          ? isOpen(task)
          : statusFilter === 'overdue'
            ? isOverdue(task, day)
            : task.status === statusFilter,
    )
    .filter((task) =>
      query.trim()
        ? `${task.title} ${task.description}`.toLowerCase().includes(query.trim().toLowerCase())
        : true,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-4">
      <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_160px_160px]">
        <label className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#89938c]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="업무 검색"
            aria-label="업무 검색"
            className={`${inputClass} pl-9`}
          />
        </label>
        <select aria-label="팀" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} className={inputClass}>
          <option value="all">모든 팀</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
        <select
          aria-label="상태"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className={inputClass}
        >
          <option value="open">미완료 전체</option>
          <option value="overdue">지연</option>
          <option value="scheduled">예정</option>
          <option value="in_progress">진행 중</option>
          <option value="completion_requested">완료 요청</option>
          <option value="completed">최종 완료</option>
          <option value="all">모든 상태</option>
        </select>
      </div>
      <p className="mb-2 text-xs font-bold text-[#748078]">{rows.length}건</p>
      <div className="space-y-1.5">
        {rows.slice(0, 300).map((task) => (
          <button
            key={`${task.team.id}:${task.id}`}
            onClick={() => onSelect(task)}
            className="flex w-full items-center gap-3 rounded-xl border border-[#e0e3de] bg-white p-3 text-left hover:border-[#2f6b4f]"
          >
            <TeamBadge team={task.team} />
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-sm">
                {task.priority === 'urgent' && <span className="text-[#a83f36]">! </span>}
                {task.title}
              </strong>
              <span className="text-xs text-[#748078]">
                {formatDay(task.date)}
                {task.endDate && task.endDate !== task.date ? ` ~ ${formatDay(task.endDate)}` : ''} ·{' '}
                {memberName(task.team.id, task.assigneeId) || '담당자 없음'}
              </span>
            </span>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${isOverdue(task, day) ? 'bg-[#f7e8e4] text-[#a83f36]' : 'bg-[#eef0ea] text-[#5f6d64]'}`}
            >
              {isOverdue(task, day) ? '지연' : statusLabel[task.status]}
            </span>
          </button>
        ))}
        {rows.length > 300 && (
          <p className="text-center text-xs text-[#748078]">
            앞의 300건만 보입니다. 팀이나 상태로 좁혀 주세요.
          </p>
        )}
        {!rows.length && <p className="py-6 text-center text-sm text-[#748078]">해당하는 업무가 없습니다.</p>}
      </div>
    </div>
  );
}

function TeamLoad({ overview }: { overview: OverviewTeam[] }) {
  const day = today();
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {overview.map(({ team, members, tasks }) => {
        const people = members.filter((m) => m.active && m.role !== 'commenter');
        return (
          <section key={team.id} className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-5">
            <h3 className="mb-3 flex items-center gap-2 font-black">
              <span className="size-3 rounded-full" style={{ background: team.color }} />
              {team.name}
            </h3>
            {people.length ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[#748078]">
                    <th className="py-1 font-bold">담당자</th>
                    <th className="py-1 text-right font-bold">진행 중</th>
                    <th className="py-1 text-right font-bold">완료 요청</th>
                    <th className="py-1 text-right font-bold">지연</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((member) => {
                    const mine = tasks.filter(
                      (t) => t.assigneeId === member.id || t.collaborators.includes(member.id),
                    );
                    const overdue = mine.filter((t) => isOverdue(t, day)).length;
                    return (
                      <tr key={member.id} className="border-t border-[#e8eae5]">
                        <td className="py-2 font-bold">{member.name}</td>
                        <td className="py-2 text-right">{mine.filter((t) => t.status === 'in_progress').length}</td>
                        <td className="py-2 text-right">{mine.filter((t) => t.status === 'completion_requested').length}</td>
                        <td className={`py-2 text-right ${overdue ? 'font-black text-[#a83f36]' : ''}`}>{overdue}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-[#748078]">소속 직원이 없습니다.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Requests({
  tasks,
  memberName,
  onSelect,
  decide,
}: {
  tasks: OverviewTask[];
  memberName: (teamId: string, memberId: string) => string;
  onSelect: (task: OverviewTask) => void;
  decide: (task: OverviewTask, status: 'completed' | 'in_progress') => Promise<void>;
}) {
  return (
    <section className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-5">
      <h3 className="mb-4 font-black">전 팀 최종 완료 요청함</h3>
      <div className="space-y-2">
        {tasks.length ? (
          tasks.map((task) => (
            <div
              key={`${task.team.id}:${task.id}`}
              className="flex flex-col gap-3 rounded-2xl border border-[#e0e3de] bg-white p-4 sm:flex-row sm:items-center"
            >
              <button onClick={() => onSelect(task)} className="min-w-0 flex-1 text-left">
                <span className="flex items-center gap-2">
                  <TeamBadge team={task.team} />
                  <strong className="truncate text-sm">{task.title}</strong>
                </span>
                <span className="mt-1 block text-xs text-[#748078]">
                  {formatDay(task.date)} · {memberName(task.team.id, task.assigneeId)}
                </span>
              </button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => void decide(task, 'in_progress')}>
                  반려
                </Button>
                <Button onClick={() => void decide(task, 'completed')}>
                  <Check />
                  최종 완료
                </Button>
              </div>
            </div>
          ))
        ) : (
          <p className="py-6 text-center text-sm text-[#748078]">확인할 완료 요청이 없습니다.</p>
        )}
      </div>
    </section>
  );
}

function TaskPreview({
  task,
  memberName,
  close,
  goToTeam,
  decide,
}: {
  task: OverviewTask;
  memberName: (teamId: string, memberId: string) => string;
  close: () => void;
  goToTeam: () => void;
  decide: (task: OverviewTask, status: 'completed' | 'in_progress') => Promise<void>;
}) {
  const people = [task.assigneeId, ...task.collaborators]
    .map((id) => memberName(task.team.id, id))
    .filter(Boolean);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <button
        aria-label="대화상자 닫기"
        className="absolute inset-0 bg-[#17231c]/30 backdrop-blur-[2px]"
        onClick={close}
      />
      <dialog
        open
        aria-label={task.title}
        className="relative m-auto w-full max-w-lg rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-6 text-[#26352d] shadow-xl"
      >
        <div className="mb-3 flex items-start gap-2">
          <TeamBadge team={task.team} />
          <Button variant="ghost" size="icon" aria-label="닫기" className="ml-auto -mt-2 -mr-2" onClick={close}>
            <X />
          </Button>
        </div>
        <h3 className="text-xl font-black">{task.title}</h3>
        <dl className="mt-4 grid grid-cols-[80px_1fr] gap-y-2 text-sm">
          <dt className="font-bold text-[#748078]">상태</dt>
          <dd>{statusLabel[task.status]}</dd>
          <dt className="font-bold text-[#748078]">일정</dt>
          <dd>
            {formatDay(task.date)}
            {task.endDate && task.endDate !== task.date ? ` ~ ${formatDay(task.endDate)}` : ''}
            {task.time ? ` ${task.time}${task.endTime ? `~${task.endTime}` : ''}` : ''}
          </dd>
          <dt className="font-bold text-[#748078]">담당</dt>
          <dd>{people.join(', ') || '없음'}</dd>
          {task.checklist.length > 0 && (
            <>
              <dt className="font-bold text-[#748078]">체크리스트</dt>
              <dd>
                {task.checklist.filter((item) => item.done).length}/{task.checklist.length} 완료
              </dd>
            </>
          )}
          {task.commentCount > 0 && (
            <>
              <dt className="font-bold text-[#748078]">댓글</dt>
              <dd>{task.commentCount}개</dd>
            </>
          )}
        </dl>
        {task.description && (
          <p className="mt-4 whitespace-pre-wrap rounded-2xl bg-white p-3 text-sm text-[#3e4d44]">
            {task.description}
          </p>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {task.status === 'completion_requested' && (
            <>
              <Button variant="outline" onClick={() => void decide(task, 'in_progress')}>
                반려
              </Button>
              <Button variant="outline" onClick={() => void decide(task, 'completed')}>
                <Check />
                최종 완료
              </Button>
            </>
          )}
          <Button onClick={goToTeam}>{task.team.name}으로 가기</Button>
        </div>
      </dialog>
    </div>
  );
}
