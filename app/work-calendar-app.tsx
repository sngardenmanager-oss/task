'use client';

import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import {
  Bell, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert,
  ClipboardCheck, ClipboardList, FileText, LayoutDashboard, Leaf, Link2, ListFilter,
  LoaderCircle, LogOut, Menu, MessageCircle, Newspaper, Pause, Pencil, Play, Plus,
  RefreshCw, Repeat2, Search, Settings, ShieldCheck, Trash2, UserPlus, Users, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Category, Member, NewsItem, RegistrationRequest, Role, Routine, SpecialNote, Task, WorkspaceState } from '@/lib/types';

type View = 'today' | 'calendar' | 'tasks' | 'routines' | 'notes' | 'team' | 'news' | 'settings' | 'notifications';
type Modal = 'task' | 'editTask' | 'note' | 'routine' | 'routineDetail' | 'member' | 'detail' | null;
type AppHistoryEntry = {
  kind: 'guard' | 'screen';
  view: View;
  modal: Modal;
  selectedTaskId: string | null;
  selectedRoutineId: string | null;
  selectedDate: string;
};

const appHistoryKey = '__snoopyWorkCalendar';

const viewMeta: Record<View, { label: string; icon: typeof CalendarDays; subtitle: string }> = {
  today: { label: '오늘', icon: LayoutDashboard, subtitle: '오늘 처리해야 할 일과 확인 요청을 모았습니다.' },
  calendar: { label: '캘린더', icon: CalendarDays, subtitle: '팀 일정을 월간 캘린더로 확인합니다.' },
  tasks: { label: '전체 업무', icon: ClipboardList, subtitle: '담당자와 상태별로 업무를 찾고 관리합니다.' },
  routines: { label: '루틴 관리', icon: Repeat2, subtitle: '반복 업무를 추가하고 잠시 멈추거나 다시 시작합니다.' },
  notes: { label: '특이사항', icon: CircleAlert, subtitle: '현장에서 발견한 내용을 순서대로 기록합니다.' },
  team: { label: '팀 현황', icon: Users, subtitle: '담당자별 업무량과 완료 요청을 확인합니다.' },
  news: { label: '관광뉴스', icon: Newspaper, subtitle: '최근 3일 이내 관광 관련 문서를 모아봅니다.' },
  settings: { label: '설정', icon: Settings, subtitle: '업무 분류와 사용자를 관리합니다.' },
  notifications: { label: '알림', icon: Bell, subtitle: '확인이 필요한 변동 사항입니다.' },
};

const statusLabel = { scheduled: '예정', in_progress: '진행 중', completion_requested: '완료 요청', completed: '최종 완료' } as const;
const priorityLabel = { urgent: '긴급', normal: '보통', low: '낮음' } as const;
const inputClass = 'h-11 w-full rounded-xl border border-[#d8ded4] bg-white px-3 text-sm outline-none transition focus:border-[#2f6b4f] focus:ring-2 focus:ring-[#2f6b4f]/10';
const textAreaClass = 'min-h-24 w-full resize-y rounded-xl border border-[#d8ded4] bg-white p-3 text-sm outline-none transition focus:border-[#2f6b4f] focus:ring-2 focus:ring-[#2f6b4f]/10';
type FormSubmitEvent = Parameters<NonNullable<ComponentProps<'form'>['onSubmit']>>[0];

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function isoDate(date = new Date()) {
  return date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function dday(value: string) {
  const today = new Date(`${isoDate()}T00:00:00`).getTime();
  const target = new Date(`${value}T00:00:00`).getTime();
  const diff = Math.round((target - today) / 86400000);
  if (diff === 0) return 'D-day';
  return diff > 0 ? `D-${diff}` : `D+${Math.abs(diff)}`;
}

function shiftIsoDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

function dayDifference(from: string, to: string) {
  return Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000);
}

function routineOccursOnDate(routine: Routine, date: string) {
  if (!routine.active || date < routine.nextDate) return false;
  const difference = dayDifference(routine.nextDate, date);
  if (/매일/.test(routine.cadence)) return true;
  if (/격주|2주/.test(routine.cadence)) return difference % 14 === 0;
  if (/매주|주간|주 1회/.test(routine.cadence)) return difference % 7 === 0;
  if (/매월|월간|월 1회/.test(routine.cadence)) return Number(date.slice(8, 10)) === Number(routine.nextDate.slice(8, 10));
  return date === routine.nextDate;
}

function roleLabel(member: Member) {
  return member.role === 'admin' ? '관리자' : member.role === 'member' ? '팀원' : '댓글 사용자';
}

function formText(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}

export default function WorkCalendarApp({
  initialData,
  initialActor,
  initialPendingRegistrations,
  accessToken,
  onSignOut,
}: {
  initialData: WorkspaceState;
  initialActor: Member;
  initialPendingRegistrations: RegistrationRequest[];
  accessToken: string;
  onSignOut: () => Promise<void>;
}) {
  const [data, setData] = useState<WorkspaceState>(initialData);
  const [actor] = useState<Member>(initialActor);
  const [pendingRegistrations, setPendingRegistrations] = useState<RegistrationRequest[]>(initialPendingRegistrations);
  const [view, setView] = useState<View>('today');
  const [modal, setModal] = useState<Modal>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedRoutineId, setSelectedRoutineId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(isoDate());
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [memberFilter, setMemberFilter] = useState('all');
  const [monthCursor, setMonthCursor] = useState(() => new Date(`${isoDate().slice(0, 7)}-01T00:00:00`));
  const [toast, setToast] = useState('');
  const [mobileMenu, setMobileMenu] = useState(false);
  const skipSave = useRef(true);
  const dataRef = useRef(data);
  const actorRef = useRef(actor);
  const viewRef = useRef(view);
  const modalRef = useRef(modal);
  const selectedTaskIdRef = useRef(selectedTaskId);
  const selectedRoutineIdRef = useRef(selectedRoutineId);
  const selectedDateRef = useRef(selectedDate);

  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { actorRef.current = actor; }, [actor]);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { modalRef.current = modal; }, [modal]);
  useEffect(() => { selectedTaskIdRef.current = selectedTaskId; }, [selectedTaskId]);
  useEffect(() => { selectedRoutineIdRef.current = selectedRoutineId; }, [selectedRoutineId]);
  useEffect(() => { selectedDateRef.current = selectedDate; }, [selectedDate]);

  useEffect(() => {
    const currentEntry = (): AppHistoryEntry => ({
      kind: 'screen',
      view: viewRef.current,
      modal: modalRef.current,
      selectedTaskId: selectedTaskIdRef.current,
      selectedRoutineId: selectedRoutineIdRef.current,
      selectedDate: selectedDateRef.current,
    });
    const existingEntry = window.history.state?.[appHistoryKey] as AppHistoryEntry | undefined;

    if (existingEntry?.kind !== 'screen') {
      if (!existingEntry) {
        window.history.replaceState(
          { ...window.history.state, [appHistoryKey]: { ...currentEntry(), kind: 'guard' } },
          '',
          window.location.href,
        );
      }
      window.history.pushState(
        { ...window.history.state, [appHistoryKey]: currentEntry() },
        '',
        window.location.href,
      );
    } else {
      window.history.replaceState(
        { ...window.history.state, [appHistoryKey]: currentEntry() },
        '',
        window.location.href,
      );
    }

    const handlePopState = (event: PopStateEvent) => {
      const entry = event.state?.[appHistoryKey] as AppHistoryEntry | undefined;
      if (!entry || entry.kind === 'guard') {
        window.history.pushState(
          { ...window.history.state, [appHistoryKey]: currentEntry() },
          '',
          window.location.href,
        );
        return;
      }

      viewRef.current = entry.view;
      modalRef.current = entry.modal;
      selectedTaskIdRef.current = entry.selectedTaskId;
      selectedRoutineIdRef.current = entry.selectedRoutineId;
      selectedDateRef.current = entry.selectedDate;
      setView(entry.view);
      setModal(entry.modal);
      setSelectedTaskId(entry.selectedTaskId);
      setSelectedRoutineId(entry.selectedRoutineId);
      setSelectedDate(entry.selectedDate);
      setMobileMenu(false);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    const timer = window.setTimeout(async () => {
      window.localStorage.setItem(`snoopy-work-calendar-offline:${actor.email.toLowerCase()}`, JSON.stringify(data));
      try {
        const response = await fetch('/api/state', {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ state: data }),
        });
        if (response.status === 401) {
          await onSignOut();
          return;
        }
        if (!response.ok) {
          const result = await response.json() as { error?: string };
          setToast(result.error ?? '서버에 저장하지 못해 기기에 임시 저장했습니다.');
        }
      } catch {
        setToast('연결이 없어 기기에 임시 저장했습니다. 연결되면 다시 저장됩니다.');
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [accessToken, actor.email, data, onSignOut]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selectedTask = data.tasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedRoutine = data.routines.find((routine) => routine.id === selectedRoutineId) ?? null;
  const today = isoDate();
  const isAdmin = actor.role === 'admin';
  const canEdit = actor.role !== 'commenter';

  const visibleTasks = useMemo(() => data.tasks.filter((task) => {
    const matchesSearch = `${task.title} ${task.description}`.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || task.status === statusFilter;
    const matchesMember = memberFilter === 'all' || task.assigneeId === memberFilter || task.collaborators.includes(memberFilter);
    return matchesSearch && matchesStatus && matchesMember;
  }), [data.tasks, search, statusFilter, memberFilter]);

  const completionRequests = data.tasks.filter((task) => task.status === 'completion_requested');
  const overdue = data.tasks.filter((task) => (task.endDate ?? task.date) < today && task.status !== 'completed');
  const todayTasks = data.tasks.filter((task) => task.date <= today && (task.endDate ?? task.date) >= today && task.status !== 'completed');

  function updateData(updater: (current: WorkspaceState) => WorkspaceState, message?: string) {
    setData(updater);
    if (message) setToast(message);
  }

  function pushAppHistory(overrides: Partial<AppHistoryEntry>) {
    const entry: AppHistoryEntry = {
      kind: 'screen',
      view: viewRef.current,
      modal: modalRef.current,
      selectedTaskId: selectedTaskIdRef.current,
      selectedRoutineId: selectedRoutineIdRef.current,
      selectedDate: selectedDateRef.current,
      ...overrides,
    };
    window.history.pushState(
      { ...window.history.state, [appHistoryKey]: entry },
      '',
      window.location.href,
    );
  }

  function openModal(nextModal: Exclude<Modal, null>, options: Partial<AppHistoryEntry> = {}) {
    modalRef.current = nextModal;
    if (options.selectedTaskId !== undefined) {
      selectedTaskIdRef.current = options.selectedTaskId;
      setSelectedTaskId(options.selectedTaskId);
    }
    if (options.selectedRoutineId !== undefined) {
      selectedRoutineIdRef.current = options.selectedRoutineId;
      setSelectedRoutineId(options.selectedRoutineId);
    }
    if (options.selectedDate !== undefined) {
      selectedDateRef.current = options.selectedDate;
      setSelectedDate(options.selectedDate);
    }
    setModal(nextModal);
    pushAppHistory({ ...options, modal: nextModal });
  }

  function closeModal() {
    const entry = window.history.state?.[appHistoryKey] as AppHistoryEntry | undefined;
    if (entry?.kind === 'screen' && entry.modal) {
      window.history.back();
      return;
    }
    modalRef.current = null;
    setModal(null);
  }

  function openTask(taskId: string) {
    openModal('detail', { selectedTaskId: taskId });
  }

  function openCreateTask(date = today) {
    if (!canEdit) return setToast('댓글 사용자는 업무를 등록할 수 없습니다.');
    openModal('task', { selectedDate: date });
  }

  function openRoutine(routineId: string) {
    openModal('routineDetail', { selectedRoutineId: routineId });
  }

  function editTask(taskId: string) {
    if (!canEdit) return setToast('댓글 사용자는 업무를 수정할 수 없습니다.');
    openModal('editTask', { selectedTaskId: taskId });
  }

  function setTaskStatus(taskId: string, status: Task['status']) {
    if (status === 'completed' && !isAdmin) return setToast('최종 완료는 관리자만 처리할 수 있습니다.');
    updateData((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === taskId ? { ...task, status } : task) }), status === 'completed' ? '최종 완료했습니다.' : '업무 상태를 변경했습니다.');
  }

  function toggleChecklist(taskId: string, checkId: string) {
    if (!canEdit) return setToast('댓글 사용자는 체크리스트를 수정할 수 없습니다.');
    updateData((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === taskId ? { ...task, checklist: task.checklist.map((item) => item.id === checkId ? { ...item, done: !item.done } : item) } : task) }));
  }

  function toggleRoutineChecklist(routineId: string, index: number) {
    if (!canEdit) return setToast('댓글 사용자는 체크리스트를 수정할 수 없습니다.');
    updateData((current) => ({
      ...current,
      routines: current.routines.map((routine) => {
        if (routine.id !== routineId) return routine;
        const checklistDone = [...(routine.checklistDone ?? [])];
        checklistDone[index] = !checklistDone[index];
        return { ...routine, checklistDone };
      }),
    }));
  }

  function deleteTask(taskId: string) {
    if (!isAdmin) return setToast('업무 삭제는 관리자만 할 수 있습니다.');
    if (!window.confirm('이 업무를 삭제할까요?')) return;
    updateData((current) => ({ ...current, tasks: current.tasks.filter((task) => task.id !== taskId) }), '업무를 삭제했습니다.');
    closeModal();
  }

  async function refreshPendingRegistrations() {
    try {
      const response = await fetch('/api/auth/registrations', {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      });
      const result = await response.json() as { registrations?: RegistrationRequest[]; error?: string };
      if (response.status === 401) {
        await onSignOut();
        return;
      }
      if (!response.ok) throw new Error(result.error ?? '가입 대기 목록을 불러오지 못했습니다.');
      setPendingRegistrations(result.registrations ?? []);
      setToast('가입 대기 목록을 새로고침했습니다.');
    } catch (error) {
      setToast(error instanceof Error ? error.message : '가입 대기 목록을 불러오지 못했습니다.');
    }
  }

  async function approveRegistration(id: string, role: Exclude<Role, 'admin'>, team: string) {
    const response = await fetch('/api/auth/registrations', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ id, role, team }),
    });
    const result = await response.json() as {
      member?: Member;
      registrations?: RegistrationRequest[];
      error?: string;
    };
    if (response.status === 401) {
      await onSignOut();
      throw new Error('로그인이 만료되었습니다.');
    }
    if (!response.ok || !result.member) {
      throw new Error(result.error ?? '가입 승인을 완료하지 못했습니다.');
    }
    setData((current) => ({ ...current, members: [...current.members, result.member!] }));
    setPendingRegistrations(result.registrations ?? []);
    setToast(`${result.member.name}님의 가입을 승인했습니다.`);
  }

  function navigate(next: View) {
    if (viewRef.current !== next || modalRef.current) {
      viewRef.current = next;
      modalRef.current = null;
      setView(next);
      setModal(null);
      pushAppHistory({ view: next, modal: null });
    }
    setMobileMenu(false);
  }

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = async () => {
      await context.registerTool({
        name: 'list_today_tasks',
        title: '오늘 업무 조회',
        description: '현재 사용자에게 보이는 오늘의 스누피가든 업무를 조회합니다.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute() {
          return dataRef.current.tasks
            .filter((task) => task.date === isoDate() && task.status !== 'completed')
            .map((task) => ({ id: task.id, title: task.title, status: statusLabel[task.status] }));
        },
      }, { signal: lifecycle.signal });
      await context.registerTool({
        name: 'create_work_task',
        title: '업무 등록',
        description: '제목과 날짜를 받아 새 일반 업무를 등록하고 화면에 즉시 표시합니다.',
        inputSchema: {
          type: 'object',
          properties: { title: { type: 'string', minLength: 1 }, date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
          required: ['title', 'date'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          const value = input as { title?: unknown; date?: unknown };
          if (typeof value.title !== 'string' || !value.title.trim() || typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) {
            throw new Error('title과 YYYY-MM-DD 형식의 date가 필요합니다.');
          }
          if (actorRef.current.role === 'commenter') throw new Error('댓글 사용자는 업무를 등록할 수 없습니다.');
          const task: Task = {
            id: uid('task'), title: value.title.trim(), description: '', date: value.date,
            categoryId: dataRef.current.categories.find((item) => item.active)?.id ?? 'park',
            assigneeId: actorRef.current.id, collaborators: [], priority: 'normal', status: 'scheduled',
            type: 'task', checklist: [], comments: [], createdBy: actorRef.current.id, createdAt: new Date().toISOString(),
          };
          setData((current) => ({ ...current, tasks: [...current.tasks, task] }));
          setView('calendar');
          return { id: task.id, title: task.title, date: task.date, status: '예정' };
        },
      }, { signal: lifecycle.signal });
    };
    void register().catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  return (
    <main className="min-h-screen bg-[#f5f3ec] text-[#26352d]">
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-[#d8ded4] bg-[#fbfaf5]/95 px-4 backdrop-blur md:px-7">
        <div className="flex items-center gap-3">
          <Button aria-label="메뉴" variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileMenu((open) => !open)}><Menu /></Button>
          <div className="grid size-10 place-items-center rounded-2xl bg-[#2f6b4f] text-white shadow-sm"><Leaf className="size-5" /></div>
          <div><p className="hidden text-[11px] font-bold tracking-[0.12em] text-[#708076] sm:block">SNOOPY GARDEN</p><h1 className="text-sm font-extrabold tracking-tight sm:text-base">파크사업팀 워크 캘린더</h1></div>
        </div>
        <div className="flex items-center gap-2">
          <Button aria-label="알림" variant="outline" size="icon" className="relative rounded-full bg-white" onClick={() => navigate('notifications')}><Bell />{completionRequests.length > 0 && <span className="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-[#a83f36] text-[9px] font-black text-white">{completionRequests.length}</span>}</Button>
          <button onClick={() => navigate('settings')} className="hidden items-center gap-2 rounded-full border border-[#d8ded4] bg-white py-1 pl-1 pr-3 sm:flex"><span className="grid size-8 place-items-center rounded-full bg-[#f0c85a] text-xs font-black text-[#4f431f]">{actor.name.slice(0, 1)}</span><span className="text-sm font-bold">{actor.name}</span><span className="rounded-full bg-[#e7f0eb] px-2 py-0.5 text-[10px] font-bold text-[#2f6b4f]">{roleLabel(actor)}</span></button>
          <Button aria-label="로그아웃" title="로그아웃" variant="outline" size="icon" className="rounded-full bg-white" onClick={() => void onSignOut()}><LogOut /></Button>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1680px] md:grid-cols-[230px_minmax(0,1fr)]">
        <Sidebar view={view} navigate={navigate} openCreateTask={openCreateTask} />
        {mobileMenu && <div className="fixed inset-0 z-30 md:hidden"><button aria-label="메뉴 닫기" className="absolute inset-0 bg-black/20" onClick={() => setMobileMenu(false)} /><aside className="relative h-full w-64 bg-[#fbfaf5] p-4 pt-20"><SidebarContent view={view} navigate={navigate} openCreateTask={openCreateTask} /></aside></div>}

        <section className="min-w-0 p-4 pb-24 md:p-7 md:pb-8">
          <div className="mb-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div><p className="mb-1 text-sm font-semibold text-[#5f6d64]">{new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</p><h2 className="text-2xl font-black tracking-tight md:text-3xl">{viewMeta[view].label}</h2><p className="mt-1 text-sm text-[#5f6d64]">{viewMeta[view].subtitle}</p></div>
            <div className="flex gap-2">
              <div className="relative flex-1 sm:w-64 sm:flex-none"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#89938c]" /><input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="업무 검색" placeholder="업무 검색" className={`${inputClass} pl-9`} /></div>
              {canEdit && <Button className="h-11 rounded-xl bg-[#2f6b4f] px-4 text-white hover:bg-[#255940]" onClick={() => openCreateTask()}><Plus />업무 추가</Button>}
            </div>
          </div>

          {view === 'today' && <TodayView data={data} actor={actor} todayTasks={todayTasks} requests={completionRequests} overdue={overdue} isAdmin={isAdmin} openTask={openTask} setTaskStatus={setTaskStatus} navigate={navigate} openCreateTask={openCreateTask} />}
          {view === 'calendar' && <CalendarView data={data} tasks={visibleTasks} month={monthCursor} setMonth={setMonthCursor} openTask={openTask} openRoutine={openRoutine} openCreateTask={openCreateTask} />}
          {view === 'tasks' && <TasksView data={data} tasks={visibleTasks} statusFilter={statusFilter} setStatusFilter={setStatusFilter} memberFilter={memberFilter} setMemberFilter={setMemberFilter} openTask={openTask} />}
          {view === 'routines' && <RoutinesView data={data} canEdit={canEdit} openCreate={() => openModal('routine')} openRoutine={openRoutine} updateData={updateData} />}
          {view === 'notes' && <NotesView data={data} canEdit={canEdit} isAdmin={isAdmin} openCreate={() => openModal('note')} openTask={openTask} updateData={updateData} actor={actor} />}
          {view === 'team' && <TeamView data={data} openTask={openTask} />}
          {view === 'news' && <NewsView data={data} isAdmin={isAdmin} updateData={updateData} />}
          {view === 'settings' && <SettingsView data={data} isAdmin={isAdmin} pendingRegistrations={pendingRegistrations} openMember={() => openModal('member')} refreshPendingRegistrations={refreshPendingRegistrations} approveRegistration={approveRegistration} updateData={updateData} />}
          {view === 'notifications' && <NotificationsView data={data} isAdmin={isAdmin} openTask={openTask} setTaskStatus={setTaskStatus} />}
        </section>
      </div>

      <nav className="fixed inset-x-3 bottom-3 z-30 grid grid-cols-5 rounded-2xl border border-[#d8ded4] bg-[#fbfaf5]/95 p-1.5 shadow-[0_12px_40px_rgba(41,56,47,0.16)] backdrop-blur md:hidden" aria-label="모바일 메뉴">
        {([['today',LayoutDashboard,'오늘'],['calendar',CalendarDays,'캘린더'],['add',Plus,'추가'],['notes',CircleAlert,'특이사항'],['team',Users,'팀']] as const).map(([key,Icon,label]) => <button key={key} onClick={() => key === 'add' ? openCreateTask() : navigate(key)} className={`flex flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-bold ${view===key?'bg-[#e3eee7] text-[#245b43]':'text-[#59675e]'}`}><Icon className="size-4" />{label}</button>)}
      </nav>

      {modal === 'task' && <TaskForm data={data} actor={actor} defaultDate={selectedDate} close={closeModal} save={(task) => updateData((current) => ({ ...current, tasks: [...current.tasks, task] }), '새 업무를 등록했습니다.')} />}
      {modal === 'editTask' && selectedTask && <EditTaskForm data={data} task={selectedTask} close={closeModal} save={(updatedTask) => updateData((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === updatedTask.id ? updatedTask : task) }), '업무 내용을 수정했습니다.')} />}
      {modal === 'note' && <NoteForm data={data} actor={actor} close={closeModal} save={(note) => updateData((current) => ({ ...current, notes: [note, ...current.notes] }), '특이사항을 등록했습니다.')} />}
      {modal === 'routine' && <RoutineForm data={data} close={closeModal} save={(routine) => updateData((current) => ({ ...current, routines: [...current.routines, routine] }), '새 루틴을 등록했습니다.')} />}
      {modal === 'member' && <MemberForm close={closeModal} save={(member) => updateData((current) => ({ ...current, members: [...current.members, member] }), '사용자를 추가했습니다.')} />}
      {modal === 'detail' && selectedTask && <TaskDetail task={selectedTask} data={data} canEdit={canEdit} isAdmin={isAdmin} close={closeModal} edit={() => editTask(selectedTask.id)} toggleChecklist={toggleChecklist} setTaskStatus={setTaskStatus} deleteTask={deleteTask} addComment={(body) => updateData((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === selectedTask.id ? { ...task, comments: [...task.comments, { id: uid('comment'), authorId: actor.id, body, createdAt: new Date().toISOString() }] } : task) }), '댓글을 등록했습니다.')} />}
      {modal === 'routineDetail' && selectedRoutine && <InteractiveRoutineDetail routine={selectedRoutine} data={data} canEdit={canEdit} close={closeModal} toggleChecklist={toggleRoutineChecklist} />}
      {toast && <output className="fixed bottom-24 left-1/2 z-[70] -translate-x-1/2 rounded-full bg-[#26352d] px-4 py-2.5 text-sm font-bold text-white shadow-xl md:bottom-7">{toast}</output>}
    </main>
  );
}

function Sidebar({ view, navigate, openCreateTask }: { view: View; navigate: (view: View) => void; openCreateTask: () => void }) {
  return <aside className="hidden min-h-[calc(100vh-64px)] border-r border-[#d8ded4] bg-[#fbfaf5] p-4 md:block"><SidebarContent view={view} navigate={navigate} openCreateTask={openCreateTask} /></aside>;
}

function SidebarContent({ view, navigate, openCreateTask }: { view: View; navigate: (view: View) => void; openCreateTask: () => void }) {
  const items: View[] = ['today','calendar','tasks','routines','notes','team','news'];
  return <><Button className="mb-6 h-11 w-full rounded-xl bg-[#2f6b4f] text-white shadow-sm hover:bg-[#255940]" onClick={openCreateTask}><Plus />새 업무</Button><nav className="space-y-1" aria-label="주요 메뉴">{items.map((key)=>{const {icon:Icon,label}=viewMeta[key];return <button key={key} onClick={()=>navigate(key)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition ${view===key?'bg-[#e3eee7] text-[#245b43]':'text-[#6a776e] hover:bg-[#efeee8]'}`}><Icon className="size-4" />{label}</button>})}</nav><div className="mt-8 border-t border-[#dde1da] pt-4"><button onClick={()=>navigate('settings')} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold ${view==='settings'?'bg-[#e3eee7] text-[#245b43]':'text-[#6a776e] hover:bg-[#efeee8]'}`}><Settings className="size-4" />설정</button></div></>;
}

function CategoryDot({ category }: { category?: Category }) {
  return <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: category?.color ?? '#9ca3af' }} />;
}

function LinkifiedText({ text }: { text: string }) {
  return <>{text.split(/(https?:\/\/[^\s]+)/g).map((part, index) =>
    /^https?:\/\//.test(part)
      ? <a key={index} href={part} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()} className="inline-flex items-center gap-1 break-all font-bold text-[#2f6b4f] underline decoration-[#2f6b4f]/35 underline-offset-2"><Link2 className="size-3 shrink-0"/>{part}</a>
      : part
  )}</>;
}

function TaskCard({ task, data, openTask }: { task: Task; data: WorkspaceState; openTask: (id: string) => void }) {
  const category = data.categories.find((item) => item.id === task.categoryId);
  const assignee = data.members.find((member) => member.id === task.assigneeId);
  return <button onClick={()=>openTask(task.id)} className="group flex w-full items-center gap-3 rounded-2xl border border-[#dbe0d9] bg-white p-3 text-left shadow-[0_5px_18px_rgba(55,74,62,0.04)] transition hover:-translate-y-0.5 hover:border-[#adc2b4] hover:shadow-md"><span className={`grid size-10 shrink-0 place-items-center rounded-xl ${task.status==='completed'?'bg-[#e2eee7] text-[#2f6b4f]':task.priority==='urgent'?'bg-[#fae0dc] text-[#a3483e]':'bg-[#f0efe9] text-[#657269]'}`}>{task.status==='completed'?<Check className="size-5"/>:<ClipboardCheck className="size-5"/>}</span><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><CategoryDot category={category}/><strong className={`truncate text-sm ${task.status==='completed'?'text-[#879089] line-through':''}`}>{task.title}</strong>{task.priority==='urgent'&&<span className="rounded-full bg-[#fae0dc] px-1.5 py-0.5 text-[9px] font-black text-[#9b453c]">긴급</span>}</span><span className="mt-1 block truncate text-xs text-[#5f6d64]">{formatDate(task.date)} · {assignee?.name ?? '미배정'} · {statusLabel[task.status]}</span></span><ChevronRight className="size-4 text-[#9aa49d] transition group-hover:translate-x-0.5"/></button>;
}

function TodayView({ data, actor, todayTasks, requests, overdue, isAdmin, openTask, setTaskStatus, navigate, openCreateTask }: { data: WorkspaceState; actor: Member; todayTasks: Task[]; requests: Task[]; overdue: Task[]; isAdmin:boolean; openTask: (id:string)=>void; setTaskStatus:(id:string,status:Task['status'])=>void; navigate:(view:View)=>void; openCreateTask:(date?:string)=>void }) {
  const today = isoDate();
  const previousDate = shiftIsoDate(today, -1);
  const previousNotes = data.notes.filter((item)=>item.date===previousDate && !item.completed);
  const priorityOrder: Record<Task['priority'], number> = { urgent: 0, normal: 1, low: 2 };
  const ddayTasks = data.tasks
    .filter((task) => {
      const difference = dayDifference(today, task.endDate ?? task.date);
      return difference >= 0 && difference <= 7;
    })
    .sort((a,b) => Number(a.status==='completed')-Number(b.status==='completed') || priorityOrder[a.priority]-priorityOrder[b.priority] || (a.endDate??a.date).localeCompare(b.endDate??b.date));
  const recentNews = [...data.news].sort((a,b)=>b.collectedAt.localeCompare(a.collectedAt)).slice(0,3);
  return <div className="space-y-5">
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[["오늘 업무",String(todayTasks.length),"오늘 진행할 업무"],["완료 요청",String(requests.length),"관리자 확인 필요"],["지연 업무",String(overdue.length),"마감일 경과"],["D-day 업무",String(ddayTasks.filter(task=>task.status!=='completed').length),"7일 이내 마감"]].map(([label,value,noteText],index)=><button key={label} onClick={()=>navigate(index===1?'notifications':index===2?'tasks':'calendar')} className="rounded-2xl border border-[#d8ded4] bg-[#fbfaf5] p-4 text-left shadow-[0_7px_22px_rgba(55,74,62,0.05)] transition hover:-translate-y-0.5"><div className="flex items-start justify-between"><p className="text-xs font-bold text-[#56645b]">{label}</p>{index===1&&<CheckCircle2 className="size-4 text-[#2f6b4f]"/>}</div><strong className="mt-2 block text-2xl font-black">{value}</strong><p className="mt-1 text-xs text-[#5f6d64]">{noteText}</p></button>)}</div>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <section className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-4 shadow-[0_12px_36px_rgba(55,74,62,0.06)] sm:p-5"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-black">{actor.name}님의 오늘 업무</h3><p className="text-xs text-[#5f6d64]">기간 업무는 시작일부터 종료일까지 표시됩니다.</p></div><Button variant="outline" onClick={()=>openCreateTask()}><Plus/>추가</Button></div><div className="space-y-2">{todayTasks.length?todayTasks.map((task)=><TaskCard key={task.id} task={task} data={data} openTask={openTask}/>):<Empty title="오늘 예정된 업무가 없습니다." action="업무 추가" onClick={()=>openCreateTask()}/>}</div></section>
        <section className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-4 sm:p-5"><div className="mb-4"><h3 className="font-black">D-day · 7일 이내 마감</h3><p className="text-xs text-[#748078]">긴급 → 보통 → 낮음 순서이며, 완료 업무는 아래로 이동합니다.</p></div><div className="space-y-2">{ddayTasks.length?ddayTasks.map(task=><div key={task.id} className={`flex items-center gap-3 rounded-2xl border border-[#dbe0d9] bg-white p-3 ${task.status==='completed'?'opacity-55':''}`}><input aria-label={`${task.title} 완료`} type="checkbox" checked={task.status==='completed'} disabled={!isAdmin} readOnly onClick={()=>setTaskStatus(task.id,task.status==='completed'?'in_progress':'completed')} className="size-5 shrink-0 accent-[#2f6b4f]"/><button onClick={()=>openTask(task.id)} className="min-w-0 flex-1 text-left"><strong className={`block truncate text-sm ${task.status==='completed'?'line-through':''}`}>{task.title}</strong><span className="mt-1 block text-xs text-[#748078]">{priorityLabel[task.priority]} · {formatDate(task.endDate??task.date)} · {dday(task.endDate??task.date)}</span></button></div>):<Empty title="7일 이내 마감 업무가 없습니다."/>}</div>{!isAdmin&&<p className="mt-3 text-xs text-[#748078]">최종 완료 체크는 관리자만 할 수 있습니다.</p>}</section>
      </div>
      <aside className="space-y-4"><section className="rounded-3xl bg-[#2f6b4f] p-5 text-white shadow-[0_14px_34px_rgba(39,91,67,0.2)]"><div className="mb-4 flex items-center justify-between"><h3 className="font-black">이번 주 핵심</h3><span className="rounded-full bg-white/15 px-2 py-1 text-[10px] font-bold">자동 요약</span></div><ul className="space-y-3 text-sm"><li className="flex gap-3"><span className="min-w-10 font-black text-[#f2cf6b]">{requests.length}건</span><span>최종 완료 확인 대기</span></li><li className="flex gap-3"><span className="min-w-10 font-black text-[#f2cf6b]">{overdue.length}건</span><span>마감이 지난 업무</span></li><li className="flex gap-3"><span className="min-w-10 font-black text-[#f2cf6b]">{ddayTasks.filter(task=>task.status!=='completed').length}건</span><span>7일 이내 마감 업무</span></li></ul></section><button onClick={()=>navigate('notes')} className="w-full rounded-3xl border border-[#e3d5ad] bg-[#fff8df] p-5 text-left transition hover:-translate-y-0.5"><div className="mb-3 flex items-center justify-between"><h3 className="font-black">전일 특이사항</h3><span className="rounded-full bg-[#f0c85a] px-2 py-1 text-[10px] font-black">{formatDate(previousDate)}</span></div>{previousNotes.length?previousNotes.slice(0,3).map(note=><div key={note.id} className="border-t border-[#eadcae] py-2 first:border-0 first:pt-0"><p className="text-sm font-bold">{note.body}</p><p className="mt-1 text-xs text-[#7b6d43]">{note.location} · {note.urgent?'긴급 확인':'일반'}</p></div>):<p className="text-sm font-bold">전일 등록된 특이사항이 없습니다.</p>}</button></aside>
    </div>
    <section className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-4 sm:p-5"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-black">관광뉴스 요약</h3><p className="text-xs text-[#748078]">최근 등록된 관광 동향을 한눈에 확인하세요.</p></div><Button variant="outline" onClick={()=>navigate('news')}><Newspaper/>전체 보기</Button></div><div className="grid gap-3 lg:grid-cols-3">{recentNews.length?recentNews.map(item=><article key={item.id} className="rounded-2xl bg-[#f1f2ed] p-4"><p className="text-[10px] font-black text-[#2f6b4f]">{item.collectedAt} · {item.source}</p><h4 className="mt-2 text-sm font-black">{item.title}</h4><p className="mt-2 line-clamp-3 text-xs leading-5 text-[#66736b]">{item.summary}</p></article>):<div className="lg:col-span-3"><Empty title="등록된 관광뉴스가 없습니다."/></div>}</div></section>
  </div>;
}

function CalendarView({ data, tasks, month, setMonth, openTask, openRoutine, openCreateTask }: { data:WorkspaceState; tasks:Task[]; month:Date; setMonth:(date:Date)=>void; openTask:(id:string)=>void; openRoutine:(id:string)=>void; openCreateTask:(date?:string)=>void }) {
  const year=month.getFullYear(); const monthIndex=month.getMonth(); const days=new Date(year,monthIndex+1,0).getDate(); const offset=(new Date(year,monthIndex,1).getDay()+6)%7; const cells=Array.from({length:42},(_,index)=>{const day=index-offset+1;return day>0&&day<=days?day:null});
  const dateKey=(day:number)=>`${year}-${String(monthIndex+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  return <article className="overflow-hidden rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] shadow-[0_12px_36px_rgba(55,74,62,0.06)]">
    <div className="flex items-center justify-between border-b border-[#e0e4de] px-3 py-4 sm:px-6"><div className="flex items-center gap-1 sm:gap-2"><Button aria-label="이전 달" variant="ghost" size="icon" onClick={()=>setMonth(new Date(year,monthIndex-1,1))}><ChevronLeft/></Button><h3 className="text-base font-black sm:text-lg">{year}년 {monthIndex+1}월</h3><Button aria-label="다음 달" variant="ghost" size="icon" onClick={()=>setMonth(new Date(year,monthIndex+1,1))}><ChevronRight/></Button></div><Button variant="outline" className="rounded-xl bg-white" onClick={()=>setMonth(new Date(`${isoDate().slice(0,7)}-01T00:00:00`))}>오늘</Button></div>
    <div className="grid grid-cols-7 border-b border-[#e0e4de] bg-[#f1f2ed]">{['월','화','수','목','금','토','일'].map(day=><div key={day} className="py-2 text-center text-xs font-bold text-[#5f6d64]">{day}</div>)}</div>
    <div role="grid" aria-label={`${year}년 ${monthIndex+1}월 업무 캘린더`} className="grid grid-cols-7">{cells.map((day,index)=>{
      const date=day?dateKey(day):'';
      const taskItems=day?tasks.filter((task)=>task.date<=date&&(task.endDate??task.date)>=date):[];
      const routineItems=day?data.routines.filter(routine=>routineOccursOnDate(routine,date)):[];
      const isToday=date===isoDate();
      const itemCount=taskItems.length+routineItems.length;
      return <div key={index} className={`relative min-h-24 border-b border-r border-[#e5e7e2] p-1 text-left sm:min-h-32 sm:p-2 ${isToday?'bg-[#edf4ef]':day?'hover:bg-[#f4f5f1]':'bg-[#f3f1eb]/60'}`}>
        {day&&<><button aria-label={`${formatDate(date)} 업무 추가`} onClick={()=>openCreateTask(date)} className="absolute inset-0 z-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#2f6b4f]"/><div className="pointer-events-none relative z-10"><span className={`grid size-7 place-items-center rounded-full text-xs font-bold ${isToday?'bg-[#2f6b4f] text-white':'text-[#56635b]'}`}>{day}</span><div className="mt-1 space-y-1">{taskItems.slice(0,3).map(task=>{const category=data.categories.find(item=>item.id===task.categoryId);const isRange=Boolean(task.endDate&&task.endDate!==task.date);return <button key={task.id} onClick={()=>openTask(task.id)} className={`pointer-events-auto block w-full truncate px-1 py-1 text-left text-[9px] font-black text-[#17231c] sm:text-[11px] ${isRange?'rounded-sm ring-1 ring-black/5':'rounded-md'}`} style={{background:category?.color??'#9aa49d'}}>{task.priority==='urgent'?'! ':''}{task.title}</button>})}{taskItems.length<3&&routineItems.slice(0,3-taskItems.length).map(routine=>{const category=data.categories.find(item=>item.id===routine.categoryId);return <button key={`routine-${routine.id}`} onClick={()=>openRoutine(routine.id)} className="pointer-events-auto block w-full truncate rounded-md border border-dashed border-[#2f6b4f]/40 bg-white/70 px-1 py-1 text-left text-[9px] font-black text-[#2f6b4f] sm:text-[11px]"><Repeat2 className="mr-1 inline size-3"/><span style={{color:category?.color??'#2f6b4f'}}>루틴</span> {routine.title}</button>})}{itemCount>3&&<span className="block text-[10px] font-bold text-[#526158]">+{itemCount-3}개 더 있음</span>}</div></div></>}
      </div>;
    })}</div>
  </article>;
}

function TasksView({ data,tasks,statusFilter,setStatusFilter,memberFilter,setMemberFilter,openTask }: { data:WorkspaceState;tasks:Task[];statusFilter:string;setStatusFilter:(value:string)=>void;memberFilter:string;setMemberFilter:(value:string)=>void;openTask:(id:string)=>void }) {
  return <section className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-4 sm:p-5"><div className="mb-4 flex flex-col gap-3 sm:flex-row"><label className="flex items-center gap-2 text-sm font-bold"><ListFilter className="size-4"/><select value={statusFilter} onChange={(event)=>setStatusFilter(event.target.value)} className={inputClass}><option value="all">모든 상태</option>{Object.entries(statusLabel).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><select aria-label="담당자 필터" value={memberFilter} onChange={(event)=>setMemberFilter(event.target.value)} className={inputClass}><option value="all">모든 담당자</option>{data.members.filter(member=>member.active).map(member=><option key={member.id} value={member.id}>{member.name}</option>)}</select></div><div className="space-y-2">{tasks.length?tasks.sort((a,b)=>a.date.localeCompare(b.date)).map(task=><TaskCard key={task.id} task={task} data={data} openTask={openTask}/>):<Empty title="조건에 맞는 업무가 없습니다."/>}</div></section>;
}

function RoutinesView({ data,canEdit,openCreate,openRoutine,updateData }: { data:WorkspaceState;canEdit:boolean;openCreate:()=>void;openRoutine:(id:string)=>void;updateData:(fn:(data:WorkspaceState)=>WorkspaceState,message?:string)=>void }) {
  function createToday(routine:Routine){const task:Task={id:uid('task'),title:routine.title,description:`${routine.cadence} 루틴에서 생성된 업무입니다.`,date:isoDate(),categoryId:routine.categoryId,assigneeId:routine.assigneeId,collaborators:[],priority:'normal',status:'scheduled',type:'routine',checklist:routine.checklist.map(text=>({id:uid('check'),text,done:false})),comments:[],createdBy:routine.assigneeId,createdAt:new Date().toISOString()};updateData(current=>({...current,tasks:[...current.tasks,task]}),'오늘 업무로 생성했습니다.');}
  return <div className="space-y-4"><div className="flex items-center justify-between"><p className="text-sm text-[#748078]">사용 중인 루틴은 다음 실행일부터 캘린더에 자동 표시됩니다.</p>{canEdit&&<Button onClick={openCreate}><Plus/>루틴 추가</Button>}</div><div className="grid gap-3 lg:grid-cols-2">{data.routines.map(routine=>{const category=data.categories.find(item=>item.id===routine.categoryId);const member=data.members.find(item=>item.id===routine.assigneeId);return <article key={routine.id} className={`relative rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-5 transition hover:-translate-y-0.5 hover:border-[#adc2b4] ${!routine.active?'opacity-60':''}`}><button aria-label={`${routine.title} 상세 보기`} onClick={()=>openRoutine(routine.id)} className="absolute inset-0 z-0 cursor-pointer rounded-3xl focus:outline-none focus:ring-2 focus:ring-[#2f6b4f]"/><div className="pointer-events-none relative z-10"><div className="flex items-start justify-between gap-3"><div><div className="mb-2 flex items-center gap-2"><CategoryDot category={category}/><span className="text-xs font-bold text-[#748078]">{category?.name}</span></div><h3 className="font-black">{routine.title}</h3><p className="mt-1 text-sm text-[#748078]">{routine.cadence} · {member?.name}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-black ${routine.active?'bg-[#e3eee7] text-[#2f6b4f]':'bg-[#ecebe6] text-[#7b847e]'}`}>{routine.active?'사용 중':'중단됨'}</span></div><div className="mt-4 rounded-xl bg-[#f1f2ed] p-3"><p className="text-xs font-bold text-[#748078]">체크리스트 {routine.checklist.length}개 · 다음 {formatDate(routine.nextDate)}</p>{routine.referenceUrl&&<a href={routine.referenceUrl} target="_blank" rel="noreferrer" className="pointer-events-auto mt-2 inline-flex items-center gap-1 text-xs font-bold text-[#2f6b4f]"><Link2 className="size-3"/>참고 링크</a>}</div>{canEdit&&<div className="mt-4 flex flex-wrap gap-2"><Button size="sm" variant="outline" className="pointer-events-auto" onClick={()=>createToday(routine)}><Play/>오늘 실행</Button><Button size="sm" variant="outline" className="pointer-events-auto" onClick={()=>updateData(current=>({...current,routines:current.routines.map(item=>item.id===routine.id?{...item,active:!item.active}:item)}),routine.active?'루틴을 중단했습니다. 과거 이력은 유지됩니다.':'루틴을 다시 시작했습니다.')} >{routine.active?<Pause/>:<Play/>}{routine.active?'중단':'재시작'}</Button></div>}</div></article>})}</div></div>;
}

function NotesView({ data,canEdit,isAdmin,openCreate,openTask,updateData,actor }: { data:WorkspaceState;canEdit:boolean;isAdmin:boolean;openCreate:()=>void;openTask:(id:string)=>void;updateData:(fn:(data:WorkspaceState)=>WorkspaceState,message?:string)=>void;actor:Member }) {
  function convert(note:SpecialNote){if(note.convertedTaskId)return openTask(note.convertedTaskId);const task:Task={id:uid('task'),title:note.body.slice(0,40),description:`${note.label}\n위치: ${note.location}\n${note.body}`,date:note.date,categoryId:note.categoryId,assigneeId:actor.id,collaborators:[],priority:note.urgent?'urgent':'normal',status:'scheduled',type:'issue',checklist:[],comments:[],sourceNoteId:note.id,createdBy:actor.id,createdAt:new Date().toISOString()};updateData(current=>({...current,tasks:[...current.tasks,task],notes:current.notes.map(item=>item.id===note.id?{...item,convertedTaskId:task.id}:item)}),'특이사항을 정식 업무로 전환했습니다.');}
  const activeNotes=[...data.notes].filter(note=>!note.completed).sort((a,b)=>Number(b.urgent)-Number(a.urgent)||b.date.localeCompare(a.date)||a.label.localeCompare(b.label));
  const archivedNotes=[...data.notes].filter(note=>note.completed).sort((a,b)=>(b.completedAt??b.createdAt).localeCompare(a.completedAt??a.createdAt));
  function toggleNote(note:SpecialNote){if(!isAdmin)return;const completed=!note.completed;updateData(current=>({...current,notes:current.notes.map(item=>item.id===note.id?{...item,completed,completedAt:completed?new Date().toISOString():undefined}:item)}),completed?'특이사항을 완료 보관함으로 이동했습니다.':'특이사항을 진행 목록으로 복원했습니다.');}
  function NoteCard({note,archived=false}:{note:SpecialNote;archived?:boolean}){const category=data.categories.find(item=>item.id===note.categoryId);const author=data.members.find(member=>member.id===note.createdBy);return <article className={`rounded-3xl border bg-[#fbfaf5] p-5 ${note.urgent&&!archived?'border-[#e3b5ae]':'border-[#d8ded4]'} ${archived?'opacity-65':''}`}><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div className="flex min-w-0 flex-1 items-start gap-3"><input aria-label={`${note.label} 완료`} type="checkbox" checked={Boolean(note.completed)} disabled={!isAdmin} readOnly onClick={()=>toggleNote(note)} className="mt-1 size-5 shrink-0 accent-[#2f6b4f]"/><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-[#f0c85a] px-2 py-1 text-[10px] font-black">{note.label}</span>{note.urgent&&<span className="rounded-full bg-[#fae0dc] px-2 py-1 text-[10px] font-black text-[#9b453c]">긴급</span>}<span className="flex items-center gap-1 text-xs font-bold text-[#748078]"><CategoryDot category={category}/>{category?.name}</span></div><h3 className={`mt-3 font-black ${archived?'line-through':''}`}>{note.body}</h3><p className="mt-2 text-sm text-[#748078]">{formatDate(note.date)} · {note.location} · {author?.name}</p></div></div>{isAdmin&&!archived&&<Button variant="outline" onClick={()=>convert(note)}>{note.convertedTaskId?<FileText/>:<RefreshCw/>}{note.convertedTaskId?'연결 업무 보기':'업무로 전환'}</Button>}</div></article>}
  return <div className="space-y-6"><div className="flex items-center justify-between"><p className="text-sm text-[#748078]">완료 체크는 관리자만 가능하며 완료 항목은 아래 보관함으로 이동합니다.</p>{canEdit&&<Button onClick={openCreate}><Plus/>특이사항 등록</Button>}</div><section><h3 className="mb-3 font-black">진행 중 특이사항 {activeNotes.length}</h3><div className="space-y-3">{activeNotes.length?activeNotes.map(note=><NoteCard key={note.id} note={note}/>):<Empty title="진행 중인 특이사항이 없습니다."/>}</div></section><section className="rounded-3xl border border-[#d8ded4] bg-[#efeee8] p-4"><div className="mb-3 flex items-center justify-between"><div><h3 className="font-black">완료 보관함</h3><p className="text-xs text-[#748078]">완료된 특이사항을 스크롤해 확인할 수 있습니다.</p></div><span className="rounded-full bg-white px-2 py-1 text-xs font-black">{archivedNotes.length}건</span></div><div className="max-h-80 space-y-3 overflow-y-auto pr-1">{archivedNotes.length?archivedNotes.map(note=><NoteCard key={note.id} note={note} archived/>):<Empty title="보관된 특이사항이 없습니다."/>}</div></section></div>;
}

function TeamView({ data,openTask }: { data:WorkspaceState;openTask:(id:string)=>void }) {
  return <div className="grid gap-4 xl:grid-cols-3">{data.members.filter(member=>member.active).map(member=>{const assigned=data.tasks.filter(task=>task.assigneeId===member.id&&task.status!=='completed');const requests=assigned.filter(task=>task.status==='completion_requested');return <article key={member.id} className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-5"><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-full bg-[#e3eee7] font-black text-[#2f6b4f]">{member.name.slice(0,1)}</span><div><h3 className="font-black">{member.name}</h3><p className="text-xs text-[#748078]">{member.team} · {roleLabel(member)}</p></div></div><div className="my-4 grid grid-cols-2 gap-2"><div className="rounded-xl bg-[#f1f2ed] p-3"><strong className="text-xl">{assigned.length}</strong><p className="text-xs text-[#748078]">진행 업무</p></div><div className="rounded-xl bg-[#fff1dd] p-3"><strong className="text-xl">{requests.length}</strong><p className="text-xs text-[#806743]">완료 요청</p></div></div><div className="space-y-2">{assigned.slice(0,3).map(task=><button key={task.id} onClick={()=>openTask(task.id)} className="block w-full truncate rounded-lg border border-[#e0e3de] bg-white px-3 py-2 text-left text-xs font-bold hover:border-[#adc2b4]">{task.title}</button>)}</div></article>})}</div>;
}

function NewsView({ data,isAdmin,updateData }: { data:WorkspaceState;isAdmin:boolean;updateData:(fn:(data:WorkspaceState)=>WorkspaceState,message?:string)=>void }) {
  async function importFiles(files:FileList|null){if(!files)return;const imported:NewsItem[]=[];for(const file of Array.from(files)){const text=await file.text();const title=text.match(/^#\s+(.+)$/m)?.[1]??file.name.replace(/\.md$/i,'');const url=text.match(/https?:\/\/\S+/)?.[0];imported.push({id:uid('news'),title,summary:text.replace(/^#.*$/m,'').replace(/\s+/g,' ').trim().slice(0,180)||'내용 없음',source:file.name,collectedAt:isoDate(),url});}updateData(current=>({...current,news:[...imported,...current.news]}),`${imported.length}개의 관광뉴스 문서를 가져왔습니다.`);}
  const recent=data.news.filter(item=>(new Date(isoDate()).getTime()-new Date(item.collectedAt).getTime())/86400000<=3);
  return <div><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-[#748078]">조회일 기준 최근 3일 문서 {recent.length}건</p>{isAdmin&&<label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-[#2f6b4f] px-4 text-sm font-bold text-white"><FileText className="size-4"/>Markdown 가져오기<input type="file" accept=".md,text/markdown" multiple className="sr-only" onChange={(event)=>importFiles(event.target.files)}/></label>}</div><div className="grid gap-3 lg:grid-cols-2">{recent.length?recent.map(item=><article key={item.id} className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-5"><div className="mb-3 flex items-center justify-between"><span className="rounded-full bg-[#e3eee7] px-2 py-1 text-[10px] font-black text-[#2f6b4f]">{item.collectedAt}</span><Newspaper className="size-4 text-[#6f7b73]"/></div><h3 className="font-black">{item.title}</h3><p className="mt-2 text-sm leading-6 text-[#66736b]">{item.summary}</p><div className="mt-4 flex items-center justify-between text-xs text-[#7a857e]"><span>{item.source}</span>{item.url&&<a href={item.url} target="_blank" rel="noreferrer" className="font-bold text-[#2f6b4f]">원문 보기</a>}</div></article>):<Empty title="최근 3일 이내 관광뉴스가 없습니다."/>}</div></div>;
}

function SettingsView({ data,isAdmin,pendingRegistrations,openMember,refreshPendingRegistrations,approveRegistration,updateData }: { data:WorkspaceState;isAdmin:boolean;pendingRegistrations:RegistrationRequest[];openMember:()=>void;refreshPendingRegistrations:()=>Promise<void>;approveRegistration:(id:string,role:Exclude<Role,'admin'>,team:string)=>Promise<void>;updateData:(fn:(data:WorkspaceState)=>WorkspaceState,message?:string)=>void }) {
  function addCategory(){const name=window.prompt('새 업무 분류 이름을 입력하세요.');if(!name)return;updateData(current=>({...current,categories:[...current.categories,{id:uid('category'),name,color:'#5f7f70',active:true}]}),'업무 분류를 추가했습니다.');}
  function retire(member:Member){if(member.role==='admin')return;const admin=data.members.find(item=>item.role==='admin'&&item.active);if(!admin||!window.confirm(`${member.name} 계정을 비활성화하고 미완료 업무를 ${admin.name}님에게 인계할까요?`))return;updateData(current=>({...current,members:current.members.map(item=>item.id===member.id?{...item,active:false}:item),tasks:current.tasks.map(task=>task.assigneeId===member.id&&task.status!=='completed'?{...task,assigneeId:admin.id}:task),routines:current.routines.map(routine=>routine.assigneeId===member.id?{...routine,assigneeId:admin.id}:routine)}),'계정을 비활성화하고 미완료 업무를 인계했습니다.');}
  return <div className="space-y-5">{isAdmin&&<section className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-5"><div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><div className="flex items-center gap-2"><h3 className="font-black">가입 승인 대기</h3><span className="rounded-full bg-[#fff1dd] px-2 py-0.5 text-xs font-black text-[#806743]">{pendingRegistrations.length}</span></div><p className="mt-1 text-xs text-[#748078]">권한과 소속을 확인한 뒤 승인해 주세요.</p></div><Button variant="outline" onClick={()=>void refreshPendingRegistrations()}><RefreshCw/>새로고침</Button></div><div className="space-y-3">{pendingRegistrations.length?pendingRegistrations.map(registration=><PendingRegistrationCard key={registration.id} registration={registration} approveRegistration={approveRegistration}/>):<Empty title="승인을 기다리는 가입 신청이 없습니다."/>}</div></section>}<div className="grid gap-5 xl:grid-cols-2"><section className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-5"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-black">사용자와 권한</h3><p className="text-xs text-[#748078]">최종 완료 권한은 관리자만 가집니다.</p></div>{isAdmin&&<Button variant="outline" onClick={openMember}><UserPlus/>추가</Button>}</div><div className="space-y-2">{data.members.map(member=><div key={member.id} className={`flex items-center gap-3 rounded-xl border border-[#e0e3de] bg-white p-3 ${!member.active?'opacity-50':''}`}><span className="grid size-9 place-items-center rounded-full bg-[#e3eee7] text-sm font-black text-[#2f6b4f]">{member.name.slice(0,1)}</span><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{member.name}</strong><span className="block truncate text-xs text-[#748078]">{member.email} · {roleLabel(member)}</span></span>{member.active&&member.role!=='admin'&&isAdmin&&<Button aria-label={`${member.name} 퇴사 처리`} size="sm" variant="outline" onClick={()=>retire(member)}><LogOut/>퇴사 처리</Button>}{!member.active&&<span className="text-xs font-bold">비활성</span>}</div>)}</div></section><section className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-5"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-black">업무 분류</h3><p className="text-xs text-[#748078]">분류를 중단해도 과거 기록은 유지됩니다.</p></div>{isAdmin&&<Button variant="outline" onClick={addCategory}><Plus/>추가</Button>}</div><div className="space-y-2">{data.categories.map(category=><div key={category.id} className={`flex items-center gap-3 rounded-xl border border-[#e0e3de] bg-white p-3 ${!category.active?'opacity-50':''}`}><CategoryDot category={category}/><strong className="flex-1 text-sm">{category.name}</strong>{isAdmin&&<Button size="sm" variant="outline" onClick={()=>updateData(current=>({...current,categories:current.categories.map(item=>item.id===category.id?{...item,active:!item.active}:item)}),category.active?'분류를 비활성화했습니다.':'분류를 활성화했습니다.')}>{category.active?<Pause/>:<Play/>}{category.active?'중단':'복원'}</Button>}</div>)}</div></section></div></div>;
}

function PendingRegistrationCard({ registration,approveRegistration }: { registration:RegistrationRequest;approveRegistration:(id:string,role:Exclude<Role,'admin'>,team:string)=>Promise<void> }) {
  const [role,setRole]=useState<Exclude<Role,'admin'>>('member');
  const [team,setTeam]=useState('파크사업팀');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  async function submit(event:FormSubmitEvent){event.preventDefault();if(!team.trim())return;setBusy(true);setError('');try{await approveRegistration(registration.id,role,team.trim());}catch(caught){setError(caught instanceof Error?caught.message:'가입 승인을 완료하지 못했습니다.');setBusy(false);}}
  return <form onSubmit={submit} className="rounded-2xl border border-[#e0e3de] bg-white p-4"><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#fff1dd] font-black text-[#806743]">{registration.name.slice(0,1)}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{registration.name}</strong><span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${registration.emailConfirmed?'bg-[#e7f0eb] text-[#2f6b4f]':'bg-[#f1f0eb] text-[#6a776e]'}`}>{registration.emailConfirmed?'이메일 인증됨':'승인 시 이메일 인증'}</span></div><p className="mt-1 truncate text-xs text-[#748078]">{registration.email}</p><p className="mt-1 text-[10px] text-[#929b95]">신청 {new Date(registration.requestedAt).toLocaleString('ko-KR')}</p></div></div><div className="mt-4 grid gap-2 sm:grid-cols-[1fr_150px_auto]"><input aria-label={`${registration.name} 소속`} value={team} onChange={(event)=>setTeam(event.target.value)} required className={inputClass} placeholder="소속"/><select aria-label={`${registration.name} 권한`} value={role} onChange={(event)=>setRole(event.target.value as Exclude<Role,'admin'>)} className={inputClass}><option value="member">팀원</option><option value="commenter">조회·댓글</option></select><Button type="submit" disabled={busy}>{busy?<LoaderCircle className="animate-spin"/>:<Check/>}승인</Button></div>{error&&<p role="alert" className="mt-2 rounded-lg bg-[#f7e8e4] px-3 py-2 text-xs font-semibold text-[#8d342e]">{error}</p>}</form>;
}

function NotificationsView({ data,isAdmin,openTask,setTaskStatus }: { data:WorkspaceState;isAdmin:boolean;openTask:(id:string)=>void;setTaskStatus:(id:string,status:Task['status'])=>void }) {
  const requests=data.tasks.filter(task=>task.status==='completion_requested');
  return <section className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-5"><div className="mb-4 flex items-center gap-2"><ShieldCheck className="size-5 text-[#2f6b4f]"/><h3 className="font-black">최종 완료 요청함</h3></div><div className="space-y-2">{requests.length?requests.map(task=><div key={task.id} className="flex flex-col gap-3 rounded-2xl border border-[#e0e3de] bg-white p-4 sm:flex-row sm:items-center"><button onClick={()=>openTask(task.id)} className="min-w-0 flex-1 text-left"><strong className="block truncate text-sm">{task.title}</strong><span className="text-xs text-[#748078]">{formatDate(task.date)} · {data.members.find(member=>member.id===task.assigneeId)?.name}</span></button>{isAdmin&&<div className="flex gap-2"><Button variant="outline" onClick={()=>setTaskStatus(task.id,'in_progress')}>반려</Button><Button onClick={()=>setTaskStatus(task.id,'completed')}><Check/>최종 완료</Button></div>}</div>):<Empty title="확인할 완료 요청이 없습니다."/>}</div></section>;
}

function ModalShell({ title,description,close,children }: { title:string;description:string;close:()=>void;children:React.ReactNode }) {
  useEffect(() => {
    const body = document.body;
    const scrollY = window.scrollY;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    return () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;
      window.scrollTo(0, scrollY);
    };
  }, []);

  return <div className="fixed inset-0 z-[60] grid place-items-end overflow-hidden p-0 sm:place-items-center sm:p-4"><button aria-label="대화상자 닫기" className="absolute inset-0 bg-[#17231c]/30 backdrop-blur-[2px]" onClick={close}/><dialog open aria-label={title} className="relative m-0 max-h-[92vh] w-full overscroll-contain overflow-y-auto rounded-t-3xl bg-[#fbfaf5] p-5 text-[#26352d] shadow-2xl sm:m-auto sm:max-w-xl sm:rounded-3xl"><div className="mb-5 flex items-start justify-between gap-4"><div><h2 className="text-xl font-black">{title}</h2><p className="mt-1 text-sm text-[#748078]">{description}</p></div><Button aria-label="닫기" variant="ghost" size="icon" onClick={close}><X/></Button></div>{children}</dialog></div>;
}

function TaskForm({ data,actor,defaultDate,close,save }: { data:WorkspaceState;actor:Member;defaultDate:string;close:()=>void;save:(task:Task)=>void }) {
  function submit(event:FormSubmitEvent){event.preventDefault();const form=new FormData(event.currentTarget);const startDate=formText(form,'date');const endDate=formText(form,'endDate')||undefined;if(endDate&&endDate<startDate){window.alert('종료일은 시작일보다 빠를 수 없습니다.');return;}const checklist=formText(form,'checklist').split('\n').map(text=>text.trim()).filter(Boolean).map(text=>({id:uid('check'),text,done:false}));save({id:uid('task'),title:formText(form,'title'),description:formText(form,'description'),date:startDate,endDate,categoryId:formText(form,'category'),assigneeId:formText(form,'assignee'),collaborators:[],priority:formText(form,'priority') as Task['priority'],status:'scheduled',type:formText(form,'type') as Task['type'],checklist,comments:[],createdBy:actor.id,createdAt:new Date().toISOString()});close();}
  return <ModalShell title="새 업무" description="업무명·날짜·담당자만 입력해도 바로 등록됩니다." close={close}><form onSubmit={submit} className="space-y-4"><Field label="업무명"><input name="title" required className={inputClass} placeholder="예: 시설 조치 결과 확인"/></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="시작일"><input name="date" type="date" defaultValue={defaultDate} required className={inputClass}/></Field><Field label="종료일"><input name="endDate" type="date" className={inputClass}/></Field></div><div className="grid gap-3 sm:grid-cols-2"><Field label="담당자"><select name="assignee" className={inputClass} defaultValue={actor.id}>{data.members.filter(member=>member.active&&member.role!=='commenter').map(member=><option key={member.id} value={member.id}>{member.name}</option>)}</select></Field><Field label="업무 분류"><select name="category" className={inputClass}>{data.categories.filter(item=>item.active).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field></div><div className="grid gap-3 sm:grid-cols-2"><Field label="유형"><select name="type" className={inputClass}><option value="task">일반 업무</option><option value="routine">루틴 업무</option><option value="issue">현장 이슈</option><option value="event">행사·프로젝트</option></select></Field><Field label="우선순위"><select name="priority" className={inputClass}><option value="normal">보통</option><option value="urgent">긴급</option><option value="low">낮음</option></select></Field></div><Field label="설명"><textarea name="description" className={textAreaClass} placeholder="업무 내용과 완료 기준을 적어주세요."/></Field><Field label="체크리스트"><textarea name="checklist" className={textAreaClass} placeholder={'한 줄에 하나씩 입력\n예: 현장 사진 확인\n담당 부서 회신 확인'}/></Field><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={close}>취소</Button><Button type="submit">업무 등록</Button></div></form></ModalShell>;
}

function NoteForm({ data,actor,close,save }: { data:WorkspaceState;actor:Member;close:()=>void;save:(note:SpecialNote)=>void }) {
  function submit(event:FormSubmitEvent){event.preventDefault();const form=new FormData(event.currentTarget);const date=formText(form,'date');const count=data.notes.filter(note=>note.date===date).length+1;save({id:uid('note'),label:`특이사항-${date.replaceAll('-','')}-${String(count).padStart(3,'0')}`,date,categoryId:formText(form,'category'),location:formText(form,'location'),body:formText(form,'body'),urgent:form.get('urgent')==='on',createdBy:actor.id,createdAt:new Date().toISOString()});close();}
  return <ModalShell title="특이사항 등록" description="현장에서 발견한 내용을 먼저 간단히 남겨주세요." close={close}><form onSubmit={submit} className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><Field label="발생일"><input name="date" type="date" required defaultValue={isoDate()} className={inputClass}/></Field><Field label="위치"><input name="location" required className={inputClass} placeholder="예: 야외가든"/></Field></div><Field label="분류"><select name="category" className={inputClass}>{data.categories.filter(item=>item.active).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="내용"><textarea name="body" required className={textAreaClass} placeholder="무슨 일이 있었는지 적어주세요."/></Field><label className="flex items-center gap-2 rounded-xl bg-[#fff1dd] p-3 text-sm font-bold"><input name="urgent" type="checkbox" className="size-4 accent-[#c9574d]"/>긴급 확인이 필요한 특이사항</label><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={close}>취소</Button><Button type="submit">특이사항 등록</Button></div></form></ModalShell>;
}

function RoutineForm({ data,close,save }: { data:WorkspaceState;close:()=>void;save:(routine:Routine)=>void }) {
  function submit(event:FormSubmitEvent){event.preventDefault();const form=new FormData(event.currentTarget);save({id:uid('routine'),title:formText(form,'title'),categoryId:formText(form,'category'),assigneeId:formText(form,'assignee'),cadence:formText(form,'cadence'),checklist:formText(form,'checklist').split('\n').map(item=>item.trim()).filter(Boolean),referenceUrl:formText(form,'referenceUrl')||undefined,active:true,nextDate:formText(form,'nextDate')});close();}
  return <ModalShell title="새 루틴" description="반복 주기와 기본 체크리스트를 등록합니다." close={close}><form onSubmit={submit} className="space-y-4"><Field label="루틴명"><input name="title" required className={inputClass}/></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="담당자"><select name="assignee" className={inputClass}>{data.members.filter(member=>member.active&&member.role!=='commenter').map(member=><option key={member.id} value={member.id}>{member.name}</option>)}</select></Field><Field label="분류"><select name="category" className={inputClass}>{data.categories.filter(item=>item.active).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field></div><div className="grid gap-3 sm:grid-cols-2"><Field label="반복 주기"><input name="cadence" required className={inputClass} placeholder="예: 매주 월요일"/></Field><Field label="다음 실행일"><input name="nextDate" type="date" required defaultValue={isoDate()} className={inputClass}/></Field></div><Field label="참고 링크"><input name="referenceUrl" type="url" className={inputClass} placeholder="https://"/></Field><Field label="체크리스트"><textarea name="checklist" className={textAreaClass} placeholder="한 줄에 하나씩 입력"/></Field><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={close}>취소</Button><Button type="submit">루틴 등록</Button></div></form></ModalShell>;
}

function InteractiveRoutineDetail({ routine,data,canEdit,close,toggleChecklist }: { routine:Routine;data:WorkspaceState;canEdit:boolean;close:()=>void;toggleChecklist:(routineId:string,index:number)=>void }) {
  const category=data.categories.find(item=>item.id===routine.categoryId);
  const member=data.members.find(item=>item.id===routine.assigneeId);
  const completed=routine.checklist.filter((_,index)=>routine.checklistDone?.[index]).length;
  return <ModalShell title={routine.title} description="등록된 루틴 상세 내용" close={close}>
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2"><span className={`rounded-full px-2 py-1 text-xs font-black ${routine.active?'bg-[#e3eee7] text-[#2f6b4f]':'bg-[#ecebe6] text-[#7b847e]'}`}>{routine.active?'사용 중':'중단됨'}</span><span className="rounded-full bg-[#f1f0eb] px-2 py-1 text-xs font-bold">{category?.name}</span></div>
      <dl className="grid gap-3 rounded-2xl bg-[#f1f2ed] p-4 text-sm sm:grid-cols-2"><div><dt className="text-xs font-bold text-[#748078]">담당자</dt><dd className="mt-1 font-black">{member?.name??'미배정'}</dd></div><div><dt className="text-xs font-bold text-[#748078]">반복 주기</dt><dd className="mt-1 font-black">{routine.cadence}</dd></div><div><dt className="text-xs font-bold text-[#748078]">다음 실행일</dt><dd className="mt-1 font-black">{formatDate(routine.nextDate)}</dd></div><div><dt className="text-xs font-bold text-[#748078]">캘린더 표시</dt><dd className="mt-1 font-black">{routine.active?'자동 표시':'표시 중단'}</dd></div></dl>
      <section>
        <h3 className="mb-2 text-sm font-black">체크리스트 {completed}/{routine.checklist.length}</h3>
        {routine.checklist.length?<ul className="space-y-2">{routine.checklist.map((item,index)=>{
          const done=Boolean(routine.checklistDone?.[index]);
          return <li key={`${routine.id}-${index}`} className="flex items-start gap-3 rounded-xl border border-[#e0e3de] bg-white p-3 text-sm">
            <input type="checkbox" aria-label={`${item} 완료`} checked={done} disabled={!canEdit} onChange={()=>toggleChecklist(routine.id,index)} className="mt-0.5 size-5 shrink-0 accent-[#2f6b4f]"/>
            <span className={`min-w-0 flex-1 ${done?'text-[#879089] line-through':''}`}><LinkifiedText text={item}/></span>
          </li>;
        })}</ul>:<p className="text-sm text-[#748078]">등록된 체크리스트가 없습니다.</p>}
      </section>
      {routine.referenceUrl&&<a href={routine.referenceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-[#d8ded4] bg-white px-4 py-3 text-sm font-bold text-[#2f6b4f]"><Link2 className="size-4"/>참고 링크 새 창에서 열기</a>}
    </div>
  </ModalShell>;
}

function RoutineDetail({ routine,data,close }: { routine:Routine;data:WorkspaceState;close:()=>void }) {
  const category=data.categories.find(item=>item.id===routine.categoryId);
  const member=data.members.find(item=>item.id===routine.assigneeId);
  return <ModalShell title={routine.title} description="등록된 루틴 상세 내용" close={close}><div className="space-y-5"><div className="flex flex-wrap gap-2"><span className={`rounded-full px-2 py-1 text-xs font-black ${routine.active?'bg-[#e3eee7] text-[#2f6b4f]':'bg-[#ecebe6] text-[#7b847e]'}`}>{routine.active?'사용 중':'중단됨'}</span><span className="rounded-full bg-[#f1f0eb] px-2 py-1 text-xs font-bold">{category?.name}</span></div><dl className="grid gap-3 rounded-2xl bg-[#f1f2ed] p-4 text-sm sm:grid-cols-2"><div><dt className="text-xs font-bold text-[#748078]">담당자</dt><dd className="mt-1 font-black">{member?.name??'미배정'}</dd></div><div><dt className="text-xs font-bold text-[#748078]">반복 주기</dt><dd className="mt-1 font-black">{routine.cadence}</dd></div><div><dt className="text-xs font-bold text-[#748078]">다음 실행일</dt><dd className="mt-1 font-black">{formatDate(routine.nextDate)}</dd></div><div><dt className="text-xs font-bold text-[#748078]">캘린더 표시</dt><dd className="mt-1 font-black">{routine.active?'자동 표시':'표시 중단'}</dd></div></dl><section><h3 className="mb-2 text-sm font-black">체크리스트 {routine.checklist.length}</h3>{routine.checklist.length?<ul className="space-y-2">{routine.checklist.map((item,index)=><li key={`${routine.id}-${index}`} className="flex items-start gap-2 rounded-xl border border-[#e0e3de] bg-white p-3 text-sm"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#e3eee7] text-[10px] font-black text-[#2f6b4f]">{index+1}</span>{item}</li>)}</ul>:<p className="text-sm text-[#748078]">등록된 체크리스트가 없습니다.</p>}</section>{routine.referenceUrl&&<a href={routine.referenceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-[#d8ded4] bg-white px-4 py-3 text-sm font-bold text-[#2f6b4f]"><Link2 className="size-4"/>참고 링크 열기</a>}</div></ModalShell>;
}

function EditTaskForm({ data,task,close,save }: { data:WorkspaceState;task:Task;close:()=>void;save:(task:Task)=>void }) {
  function submit(event:FormSubmitEvent){event.preventDefault();const form=new FormData(event.currentTarget);const startDate=formText(form,'date');const endDate=formText(form,'endDate')||undefined;if(endDate&&endDate<startDate){window.alert('종료일은 시작일보다 빠를 수 없습니다.');return;}const oldChecklist=task.checklist;const checklist=formText(form,'checklist').split('\n').map(text=>text.trim()).filter(Boolean).map((text,index)=>oldChecklist[index]?.text===text?oldChecklist[index]:{id:uid('check'),text,done:false});save({...task,title:formText(form,'title'),description:formText(form,'description'),date:startDate,endDate,categoryId:formText(form,'category'),assigneeId:formText(form,'assignee'),priority:formText(form,'priority') as Task['priority'],type:formText(form,'type') as Task['type'],checklist});close();}
  return <ModalShell title="업무 수정" description="캘린더에 등록된 업무 내용을 변경합니다." close={close}><form onSubmit={submit} className="space-y-4"><Field label="업무명"><input name="title" required defaultValue={task.title} className={inputClass}/></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="시작일"><input name="date" type="date" defaultValue={task.date} required className={inputClass}/></Field><Field label="종료일"><input name="endDate" type="date" defaultValue={task.endDate} className={inputClass}/></Field></div><div className="grid gap-3 sm:grid-cols-2"><Field label="담당자"><select name="assignee" className={inputClass} defaultValue={task.assigneeId}>{data.members.filter(member=>member.active&&member.role!=='commenter').map(member=><option key={member.id} value={member.id}>{member.name}</option>)}</select></Field><Field label="업무 분류"><select name="category" className={inputClass} defaultValue={task.categoryId}>{data.categories.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field></div><div className="grid gap-3 sm:grid-cols-2"><Field label="유형"><select name="type" className={inputClass} defaultValue={task.type}><option value="task">일반 업무</option><option value="routine">루틴 업무</option><option value="issue">현장 이슈</option><option value="event">행사·프로젝트</option></select></Field><Field label="우선순위"><select name="priority" className={inputClass} defaultValue={task.priority}><option value="normal">보통</option><option value="urgent">긴급</option><option value="low">낮음</option></select></Field></div><Field label="설명"><textarea name="description" defaultValue={task.description} className={textAreaClass}/></Field><Field label="체크리스트"><textarea name="checklist" defaultValue={task.checklist.map(item=>item.text).join('\n')} className={textAreaClass}/></Field><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={close}>취소</Button><Button type="submit"><Pencil/>수정 저장</Button></div></form></ModalShell>;
}

function MemberForm({ close,save }: { close:()=>void;save:(member:Member)=>void }) {
  function submit(event:FormSubmitEvent){event.preventDefault();const form=new FormData(event.currentTarget);save({id:uid('member'),name:formText(form,'name'),email:formText(form,'email'),role:formText(form,'role') as Member['role'],team:formText(form,'team'),active:true});close();}
  return <ModalShell title="사용자 추가" description="초대할 사용자의 이메일과 권한을 입력합니다." close={close}><form onSubmit={submit} className="space-y-4"><Field label="이름"><input name="name" required className={inputClass}/></Field><Field label="이메일"><input name="email" type="email" required className={inputClass}/></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="소속"><input name="team" required defaultValue="파크사업팀" className={inputClass}/></Field><Field label="권한"><select name="role" className={inputClass}><option value="member">팀원</option><option value="commenter">조회·댓글</option></select></Field></div><div className="rounded-xl bg-[#fff8df] p-3 text-xs leading-5 text-[#6f623d]">퇴사자가 생기면 기존 계정을 재사용하지 않고 비활성화한 뒤, 새 사용자를 추가합니다. 미완료 업무와 루틴만 관리자에게 인계됩니다.</div><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={close}>취소</Button><Button type="submit">사용자 추가</Button></div></form></ModalShell>;
}

function TaskDetail({ task,data,canEdit,isAdmin,close,edit,toggleChecklist,setTaskStatus,deleteTask,addComment }: { task:Task;data:WorkspaceState;canEdit:boolean;isAdmin:boolean;close:()=>void;edit:()=>void;toggleChecklist:(taskId:string,checkId:string)=>void;setTaskStatus:(taskId:string,status:Task['status'])=>void;deleteTask:(taskId:string)=>void;addComment:(body:string)=>void }) {
  const [comment,setComment]=useState('');const category=data.categories.find(item=>item.id===task.categoryId);const assignee=data.members.find(member=>member.id===task.assigneeId);
  function submitComment(event:FormSubmitEvent){event.preventDefault();if(!comment.trim())return;addComment(comment.trim());setComment('');}
  return <ModalShell title={task.title} description={`${formatDate(task.date)}${task.endDate?` ~ ${formatDate(task.endDate)}`:''} · ${category?.name} · ${assignee?.name}`} close={close}>
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2"><span className="rounded-full bg-[#e3eee7] px-2 py-1 text-xs font-bold text-[#2f6b4f]">{statusLabel[task.status]}</span><span className="rounded-full bg-[#f1f0eb] px-2 py-1 text-xs font-bold">{priorityLabel[task.priority]}</span>{task.endDate&&<span className="rounded-full bg-[#fff1dd] px-2 py-1 text-xs font-bold text-[#806743]">{dday(task.endDate)}</span>}</div>
      <p className="whitespace-pre-line text-sm leading-6 text-[#5f6d64]"><LinkifiedText text={task.description||'설명이 없습니다.'}/></p>
      {task.checklist.length>0&&<section>
        <h3 className="mb-2 text-sm font-black">체크리스트</h3>
        <div className="space-y-2">{task.checklist.map(item=><label key={item.id} className={`flex w-full items-center gap-3 rounded-xl bg-[#f1f2ed] p-3 text-left text-sm ${canEdit?'cursor-pointer':'cursor-default'}`}>
          <input
            type="checkbox"
            aria-label={`${item.text} 완료`}
            checked={item.done}
            disabled={!canEdit}
            onChange={()=>toggleChecklist(task.id,item.id)}
            className="size-5 shrink-0 accent-[#2f6b4f]"
          />
          <span className={item.done?'text-[#879089] line-through':''}><LinkifiedText text={item.text}/></span>
        </label>)}</div>
      </section>}
      <section><h3 className="mb-2 text-sm font-black">댓글 {task.comments.length}</h3><div className="max-h-44 space-y-2 overflow-y-auto">{task.comments.map(comment=>{const author=data.members.find(member=>member.id===comment.authorId);return <div key={comment.id} className="rounded-xl bg-[#f1f2ed] p-3"><div className="mb-1 flex items-center justify-between"><strong className="text-xs">{author?.name??'사용자'}</strong><span className="text-[10px] text-[#859088]">{new Date(comment.createdAt).toLocaleString('ko-KR')}</span></div><p className="text-sm">{comment.body}</p></div>})}</div><form onSubmit={submitComment} className="mt-2 flex gap-2"><input value={comment} onChange={(event)=>setComment(event.target.value)} className={inputClass} placeholder="의견을 남겨주세요."/><Button type="submit" aria-label="댓글 등록"><MessageCircle/></Button></form></section>
      <div className="flex flex-wrap justify-between gap-2 border-t border-[#e0e3de] pt-4"><div className="flex gap-2">{isAdmin&&<Button variant="destructive" onClick={()=>deleteTask(task.id)}><Trash2/>삭제</Button>}{canEdit&&<Button variant="outline" onClick={edit}><Pencil/>수정</Button>}</div><div className="flex flex-wrap gap-2">{canEdit&&task.status==='scheduled'&&<Button variant="outline" onClick={()=>setTaskStatus(task.id,'in_progress')}>진행 시작</Button>}{canEdit&&task.status==='in_progress'&&<Button onClick={()=>setTaskStatus(task.id,'completion_requested')}>완료 요청</Button>}{isAdmin&&task.status==='completion_requested'&&<><Button variant="outline" onClick={()=>setTaskStatus(task.id,'in_progress')}>반려</Button><Button onClick={()=>setTaskStatus(task.id,'completed')}><Check/>최종 완료</Button></>}{isAdmin&&task.status==='completed'&&<Button variant="outline" onClick={()=>setTaskStatus(task.id,'in_progress')}>다시 열기</Button>}</div></div>
    </div>
  </ModalShell>;
}

function Field({ label,children }: { label:string;children:React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-black text-[#617068]">{label}</span>{children}</label>; }
function Empty({ title,action,onClick }: { title:string;action?:string;onClick?:()=>void }) { return <div className="grid min-h-36 place-items-center rounded-2xl border border-dashed border-[#cfd5ce] bg-[#f4f3ee] p-6 text-center"><div><ClipboardList className="mx-auto mb-2 size-6 text-[#8a958d]"/><p className="text-sm font-bold text-[#6f7b73]">{title}</p>{action&&onClick&&<Button variant="outline" size="sm" className="mt-3" onClick={onClick}>{action}</Button>}</div></div>; }
