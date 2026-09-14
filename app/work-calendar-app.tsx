'use client';

import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import {
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  ClipboardList,
  Download,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  Leaf,
  Link2,
  ListFilter,
  LoaderCircle,
  LogOut,
  Menu,
  MessageCircle,
  Newspaper,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Repeat2,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type {
  Category,
  Comment,
  Member,
  NewsItem,
  ReferenceLink,
  RegistrationRequest,
  Role,
  Routine,
  SpecialNote,
  Task,
  WorkspaceState,
} from '@/lib/types';

type View =
  | 'today'
  | 'calendar'
  | 'tasks'
  | 'routines'
  | 'notes'
  | 'team'
  | 'news'
  | 'settings'
  | 'notifications';
type Modal =
  | 'task'
  | 'editTask'
  | 'note'
  | 'routine'
  | 'editRoutine'
  | 'routineDetail'
  | 'member'
  | 'detail'
  | null;
type AppHistoryEntry = {
  kind: 'guard' | 'screen';
  view: View;
  modal: Modal;
  selectedTaskId: string | null;
  selectedRoutineId: string | null;
  selectedDate: string;
  selectedTime: string | null;
};

const appHistoryKey = '__snoopyWorkCalendar';

/** 이 이메일만 오늘 화면에서 모든 담당자의 업무를 파악할 수 있습니다. 그 외 사용자는 자신이 담당자이거나
 * 협업자로 지정된 업무만 오늘/지연/D-day 목록에서 보게 됩니다. */
const FULL_ACCESS_EMAIL = 'sn.gardenmanager@gmail.com';

function isTaskVisibleTo(task: Task, member: Pick<Member, 'id' | 'email'>) {
  return (
    member.email === FULL_ACCESS_EMAIL ||
    task.assigneeId === member.id ||
    task.collaborators.includes(member.id)
  );
}

const viewMeta: Record<
  View,
  { label: string; icon: typeof CalendarDays; subtitle: string }
> = {
  today: {
    label: '오늘',
    icon: LayoutDashboard,
    subtitle: '오늘 처리해야 할 일과 확인 요청을 모았습니다.',
  },
  calendar: {
    label: '캘린더',
    icon: CalendarDays,
    subtitle: '팀 일정을 월간 캘린더로 확인합니다.',
  },
  tasks: {
    label: '전체 업무',
    icon: ClipboardList,
    subtitle: '담당자와 상태별로 업무를 찾고 관리합니다.',
  },
  routines: {
    label: '루틴 관리',
    icon: Repeat2,
    subtitle: '반복 업무를 추가하고 잠시 멈추거나 다시 시작합니다.',
  },
  notes: {
    label: '특이사항',
    icon: CircleAlert,
    subtitle: '현장에서 발견한 내용을 순서대로 기록합니다.',
  },
  team: {
    label: '팀 현황',
    icon: Users,
    subtitle: '담당자별 업무량과 완료 요청을 확인합니다.',
  },
  news: {
    label: '관광뉴스',
    icon: Newspaper,
    subtitle: '최근 3일 이내 관광 관련 문서를 모아봅니다.',
  },
  settings: {
    label: '설정',
    icon: Settings,
    subtitle: '업무 분류와 사용자를 관리합니다.',
  },
  notifications: {
    label: '알림',
    icon: Bell,
    subtitle: '확인이 필요한 변동 사항입니다.',
  },
};

const statusLabel = {
  scheduled: '예정',
  in_progress: '진행 중',
  completion_requested: '완료 요청',
  completed: '최종 완료',
} as const;
const priorityLabel = { urgent: '긴급', normal: '보통', low: '낮음' } as const;
const inputClass =
  'h-11 w-full rounded-xl border border-[#d8ded4] bg-white px-3 text-sm outline-none transition focus:border-[#2f6b4f] focus:ring-2 focus:ring-[#2f6b4f]/10';
const textAreaClass =
  'min-h-24 w-full resize-y rounded-xl border border-[#d8ded4] bg-white p-3 text-sm outline-none transition focus:border-[#2f6b4f] focus:ring-2 focus:ring-[#2f6b4f]/10';
type FormSubmitEvent = Parameters<
  NonNullable<ComponentProps<'form'>['onSubmit']>
>[0];

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

/** 종일 업무는 0, 오전(12시 이전 시작)은 1, 오후는 2를 반환합니다. */
function taskTimeSlot(time?: string) {
  if (!time) return 0;
  return time < '12:00' ? 1 : 2;
}

function formatClockTime(value: string) {
  const [hourText, minuteText] = value.split(':');
  const hour = Number(hourText);
  const period = hour < 12 ? '오전' : '오후';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${period} ${displayHour}:${minuteText}`;
}

/** 시작 시간만 있으면 단일 시각을, 종료 시간까지 있으면 "몇시 - 몇시" 범위를 표시합니다. */
function formatTaskTime(time?: string, endTime?: string) {
  if (!time) return '종일';
  const start = formatClockTime(time);
  return endTime ? `${start} - ${formatClockTime(endTime)}` : start;
}

function timeToMinutes(value: string) {
  const [hourText, minuteText] = value.split(':');
  return Number(hourText) * 60 + Number(minuteText);
}

function minutesToTime(value: number) {
  const normalized = ((value % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(
    normalized % 60,
  ).padStart(2, '0')}`;
}

function addMinutesToTime(value: string, minutes: number) {
  return minutesToTime(timeToMinutes(value) + minutes);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function isTaskOverdue(task: Task) {
  return task.status !== 'completed' && (task.endDate ?? task.date) < isoDate();
}

/** 캘린더 막대 배경색: 긴급은 파란색, 지연은 빨간색으로 분류(카테고리 색상 무시)를 덮어씁니다. */
function taskBarBackground(task: Task, categoryColor?: string) {
  if (task.status !== 'completed' && task.priority === 'urgent') {
    return '#1d4ed8';
  }
  if (isTaskOverdue(task)) return '#dc2626';
  return categoryColor ?? '#9aa49d';
}

/** 날짜 오름차순, 같은 날짜면 종일 → 오전 → 오후, 같은 시간대면 시각 오름차순으로 정렬합니다. */
function compareTaskSchedule(
  aDate: string,
  aTime: string | undefined,
  bDate: string,
  bTime: string | undefined,
) {
  return (
    aDate.localeCompare(bDate) ||
    taskTimeSlot(aTime) - taskTimeSlot(bTime) ||
    (aTime ?? '').localeCompare(bTime ?? '')
  );
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
  return Math.round(
    (new Date(`${to}T00:00:00`).getTime() -
      new Date(`${from}T00:00:00`).getTime()) /
      86400000,
  );
}

function routineOccursOnDate(routine: Routine, date: string) {
  if (!routine.active || date < routine.nextDate) return false;
  const difference = dayDifference(routine.nextDate, date);
  if (/매일/.test(routine.cadence)) return true;
  if (/격주|2주/.test(routine.cadence)) return difference % 14 === 0;
  if (/매주|주간|주 1회/.test(routine.cadence)) return difference % 7 === 0;
  if (/매월|월간|월 1회/.test(routine.cadence))
    return Number(date.slice(8, 10)) === Number(routine.nextDate.slice(8, 10));
  return date === routine.nextDate;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function dateKeyOf(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** 일주일치 날짜 배열(빈 칸은 '')을 기준으로 종일/여러 날 업무를 겹치지 않는 레인에 배치합니다. */
function computeWeekSegments(tasks: Task[], weekDateKeys: string[]) {
  const segments = tasks
    .flatMap((task) => {
      const occupied = weekDateKeys
        .map((date, column) =>
          date &&
          task.date <= date &&
          (task.endDate ?? task.date) >= date
            ? column
            : -1,
        )
        .filter((column) => column >= 0);
      return occupied.length
        ? [
            {
              task,
              start: occupied[0],
              end: occupied[occupied.length - 1],
              lane: 0,
            },
          ]
        : [];
    })
    .sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const laneEnds: number[] = [];
  for (const segment of segments) {
    const openLane = laneEnds.findIndex((end) => end < segment.start);
    segment.lane = openLane < 0 ? laneEnds.length : openLane;
    laneEnds[segment.lane] = segment.end;
  }
  return segments;
}

type TimedBlock = { task: Task; startMin: number; endMin: number };

/** 시간이 겹치는 업무들을 클러스터별로 묶어 나란히 표시할 레인을 계산합니다. */
function layoutTimedBlocks(blocks: TimedBlock[]) {
  const sorted = [...blocks].sort(
    (a, b) => a.startMin - b.startMin || a.endMin - b.endMin,
  );
  const results: (TimedBlock & { lane: number; laneCount: number })[] = [];
  let cluster: (TimedBlock & { lane: number })[] = [];
  let clusterEnd = -Infinity;
  const laneEnds: number[] = [];
  const flushCluster = () => {
    if (!cluster.length) return;
    const laneCount = Math.max(...cluster.map((item) => item.lane)) + 1;
    for (const item of cluster) results.push({ ...item, laneCount });
    cluster = [];
    laneEnds.length = 0;
  };
  for (const block of sorted) {
    if (block.startMin >= clusterEnd) {
      flushCluster();
      clusterEnd = -Infinity;
    }
    const openLane = laneEnds.findIndex((end) => end <= block.startMin);
    const lane = openLane < 0 ? laneEnds.length : openLane;
    laneEnds[lane] = block.endMin;
    clusterEnd = Math.max(clusterEnd, block.endMin);
    cluster.push({ ...block, lane });
  }
  flushCluster();
  return results;
}

function assigneeNames(task: Task, data: WorkspaceState) {
  return [task.assigneeId, ...task.collaborators]
    .map((id) => data.members.find((member) => member.id === id)?.name)
    .filter((name): name is string => Boolean(name));
}

function roleLabel(member: Member) {
  return member.role === 'admin'
    ? '관리자'
    : member.role === 'member'
      ? '팀원'
      : '댓글 사용자';
}

function formText(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function routineLinks(routine: Routine): ReferenceLink[] {
  if (routine.referenceLinks?.length) return routine.referenceLinks;
  return routine.referenceUrl
    ? [
        {
          id: `${routine.id}-legacy-link`,
          title: '참고 링크',
          url: routine.referenceUrl,
          afterChecklistIndex: routine.checklist.length,
        },
      ]
    : [];
}

function routineChecklistWithLinks(routine: Routine) {
  const links = routineLinks(routine);
  const result: string[] = links
    .filter((link) => link.afterChecklistIndex === 0)
    .map((link) => `${link.title}: ${link.url}`);
  routine.checklist.forEach((item, index) => {
    result.push(item);
    result.push(
      ...links
        .filter((link) => link.afterChecklistIndex === index + 1)
        .map((link) => `${link.title}: ${link.url}`),
    );
  });
  return result;
}

function mergeWorkspaceStates(
  preferred: WorkspaceState,
  fallback: WorkspaceState,
): WorkspaceState {
  const deletedIds = new Set([
    ...(preferred.deletedIds ?? []),
    ...(fallback.deletedIds ?? []),
  ]);
  const mergeById = <T extends { id: string }>(
    primary: T[],
    secondary: T[],
  ) => {
    const merged = new Map(secondary.map((item) => [item.id, item]));
    primary.forEach((item) => merged.set(item.id, item));
    return [...merged.values()].filter((item) => !deletedIds.has(item.id));
  };
  return {
    members: mergeById(preferred.members, fallback.members),
    categories: mergeById(preferred.categories, fallback.categories),
    tasks: mergeById(preferred.tasks, fallback.tasks),
    routines: mergeById(preferred.routines, fallback.routines),
    notes: mergeById(preferred.notes, fallback.notes),
    deletedIds: [...deletedIds],
  };
}

function defaultAssigneeId(data: WorkspaceState, actor: Member) {
  return data.members.some(
    (member) =>
      member.id === actor.id && member.active && member.role !== 'commenter',
  )
    ? actor.id
    : (data.members.find(
        (member) => member.active && member.role !== 'commenter',
      )?.id ?? actor.id);
}

function icalEscape(value: string) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replace(/\r?\n/g, '\\n');
}

function icalDate(value: string) {
  return value.replaceAll('-', '');
}

function exportCalendarIcal(data: WorkspaceState) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const events = data.tasks.flatMap((task) => {
    const category =
      data.categories.find((item) => item.id === task.categoryId)?.name ?? '';
    const names = assigneeNames(task, data);
    const description = [
      task.description,
      names.length ? `담당자: ${names.join(', ')}` : '',
      ...task.checklist.map((item) => `${item.done ? '✓' : '□'} ${item.text}`),
    ]
      .filter(Boolean)
      .join('\n');
    return [
      'BEGIN:VEVENT',
      `UID:${icalEscape(task.id)}@snoopygarden.work`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icalDate(task.date)}`,
      `DTEND;VALUE=DATE:${icalDate(shiftIsoDate(task.endDate ?? task.date, 1))}`,
      `SUMMARY:${icalEscape(task.title)}`,
      `DESCRIPTION:${icalEscape(description)}`,
      category ? `CATEGORIES:${icalEscape(category)}` : '',
      `STATUS:${task.status === 'completed' ? 'COMPLETED' : 'CONFIRMED'}`,
      'END:VEVENT',
    ]
      .filter(Boolean)
      .join('\r\n');
  });
  const routines = data.routines
    .filter((routine) => routine.active)
    .map((routine) => {
      const rule = /매일/.test(routine.cadence)
        ? 'FREQ=DAILY'
        : /격주|2주/.test(routine.cadence)
          ? 'FREQ=WEEKLY;INTERVAL=2'
          : /매주|주간|주 1회/.test(routine.cadence)
            ? 'FREQ=WEEKLY'
            : /매월|월간|월 1회/.test(routine.cadence)
              ? 'FREQ=MONTHLY'
              : '';
      return [
        'BEGIN:VEVENT',
        `UID:${icalEscape(routine.id)}@snoopygarden.routine`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${icalDate(routine.nextDate)}`,
        `DTEND;VALUE=DATE:${icalDate(shiftIsoDate(routine.nextDate, 1))}`,
        `SUMMARY:${icalEscape(`[루틴] ${routine.title}`)}`,
        `DESCRIPTION:${icalEscape([routine.cadence, ...routineChecklistWithLinks(routine)].join('\n'))}`,
        rule ? `RRULE:${rule}` : '',
        'END:VEVENT',
      ]
        .filter(Boolean)
        .join('\r\n');
    });
  const contents = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Snoopy Garden//Work Calendar//KO',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:스누피가든 업무캘린더',
    ...events,
    ...routines,
    'END:VCALENDAR',
    '',
  ].join('\r\n');
  downloadBlob(
    new Blob([contents], { type: 'text/calendar;charset=utf-8' }),
    `스누피가든_업무캘린더_${isoDate()}.ics`,
  );
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
  const [pendingRegistrations, setPendingRegistrations] = useState<
    RegistrationRequest[]
  >(initialPendingRegistrations);
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [view, setView] = useState<View>('today');
  const [modal, setModal] = useState<Modal>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedRoutineId, setSelectedRoutineId] = useState<string | null>(
    null,
  );
  const [selectedDate, setSelectedDate] = useState(isoDate());
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [memberFilter, setMemberFilter] = useState('all');
  const [taskFocus, setTaskFocus] = useState<
    'today' | 'overdue' | 'dday' | null
  >(null);
  const [monthCursor, setMonthCursor] = useState(
    () => new Date(`${isoDate().slice(0, 7)}-01T00:00:00`),
  );
  const [toast, setToast] = useState('');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const pendingRegistrationsLoaded = useRef(false);
  const skipSave = useRef(true);
  const deletedIdsRef = useRef(new Set<string>());
  const dataRef = useRef(data);
  const actorRef = useRef(actor);
  const viewRef = useRef(view);
  const modalRef = useRef(modal);
  const selectedTaskIdRef = useRef(selectedTaskId);
  const selectedRoutineIdRef = useRef(selectedRoutineId);
  const selectedDateRef = useRef(selectedDate);
  const selectedTimeRef = useRef(selectedTime);
  const collectingDesktopNews = useRef(false);
  const newsFullyLoaded = useRef(false);
  const newsLoadingFull = useRef(false);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  useEffect(() => {
    actorRef.current = actor;
  }, [actor]);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  useEffect(() => {
    modalRef.current = modal;
  }, [modal]);
  useEffect(() => {
    selectedTaskIdRef.current = selectedTaskId;
  }, [selectedTaskId]);
  useEffect(() => {
    selectedRoutineIdRef.current = selectedRoutineId;
  }, [selectedRoutineId]);
  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);
  useEffect(() => {
    selectedTimeRef.current = selectedTime;
  }, [selectedTime]);

  useEffect(() => {
    const key = `snoopy-work-calendar-offline:${actor.email.toLowerCase()}`;
    const timer = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return;
        const offline = JSON.parse(raw) as WorkspaceState;
        const recovered = mergeWorkspaceStates(initialData, offline);
        if (JSON.stringify(recovered) !== JSON.stringify(initialData)) {
          setData(recovered);
          setToast('기기에 남아 있던 업무 기록을 서버 데이터와 합쳤습니다.');
        }
      } catch {
        window.localStorage.removeItem(key);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [actor.email, initialData]);

  useEffect(() => {
    const currentEntry = (): AppHistoryEntry => ({
      kind: 'screen',
      view: viewRef.current,
      modal: modalRef.current,
      selectedTaskId: selectedTaskIdRef.current,
      selectedRoutineId: selectedRoutineIdRef.current,
      selectedDate: selectedDateRef.current,
      selectedTime: selectedTimeRef.current,
    });
    const existingEntry = window.history.state?.[appHistoryKey] as
      | AppHistoryEntry
      | undefined;

    if (existingEntry?.kind !== 'screen') {
      if (!existingEntry) {
        window.history.replaceState(
          {
            ...window.history.state,
            [appHistoryKey]: { ...currentEntry(), kind: 'guard' },
          },
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
      selectedTimeRef.current = entry.selectedTime ?? null;
      setView(entry.view);
      setModal(entry.modal);
      setSelectedTaskId(entry.selectedTaskId);
      setSelectedRoutineId(entry.selectedRoutineId);
      setSelectedDate(entry.selectedDate);
      setSelectedTime(entry.selectedTime ?? null);
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
      const deletedIds = [...deletedIdsRef.current];
      window.localStorage.setItem(
        `snoopy-work-calendar-offline:${actor.email.toLowerCase()}`,
        JSON.stringify(data),
      );
      try {
        const response = await fetch('/api/state', {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ state: data, deletedIds }),
        });
        if (response.status === 401) {
          await onSignOut();
          return;
        }
        const result = (await response.json()) as {
          error?: string;
          state?: WorkspaceState;
        };
        if (!response.ok) {
          setToast(
            result.error ?? '서버에 저장하지 못해 기기에 임시 저장했습니다.',
          );
          return;
        }
        deletedIds.forEach((id) => deletedIdsRef.current.delete(id));
        if (
          result.state &&
          dataRef.current === data &&
          JSON.stringify(result.state) !== JSON.stringify(data)
        ) {
          window.localStorage.setItem(
            `snoopy-work-calendar-offline:${actor.email.toLowerCase()}`,
            JSON.stringify(result.state),
          );
          skipSave.current = true;
          setData(result.state);
        }
      } catch {
        setToast(
          '연결이 없어 기기에 임시 저장했습니다. 연결되면 다시 저장됩니다.',
        );
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [accessToken, actor.email, data, onSignOut]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/news?limit=10', {
          headers: { authorization: `Bearer ${accessToken}` },
          cache: 'no-store',
          signal: controller.signal,
        });
        const result = (await response.json()) as {
          items?: NewsItem[];
          error?: string;
        };
        if (response.status === 401) {
          await onSignOut();
          return;
        }
        if (!response.ok)
          throw new Error(result.error ?? '관광뉴스를 불러오지 못했습니다.');
        if (!newsFullyLoaded.current) setNewsItems(result.items ?? []);
      } catch {
        if (controller.signal.aborted) return;
        // 관광뉴스는 부가 기능이라 실패해도 조용히 넘어간다.
      }
    })();
    return () => controller.abort();
  }, [accessToken, onSignOut]);

  useEffect(() => {
    if (
      actor.role !== 'admin' ||
      !window.snoopyDesktop ||
      collectingDesktopNews.current
    )
      return;
    collectingDesktopNews.current = true;
    void (async () => {
      const result = await window.snoopyDesktop!.collectRecentNews();
      if (result.error) {
        setToast('관광뉴스 폴더를 읽지 못했습니다. 폴더 경로를 확인해 주세요.');
        return;
      }
      if (result.skipped) return;
      const response = await fetch('/api/news/digest', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ items: result.items }),
      });
      const digestResult = (await response.json()) as {
        error?: string;
        items?: NewsItem[];
      };
      if (response.status === 401) {
        await onSignOut();
        return;
      }
      if (!response.ok) {
        setToast(
          digestResult.error ?? '최근 3일 관광뉴스를 정리하지 못했습니다.',
        );
        return;
      }
      if (result.snapshotId) {
        await window.snoopyDesktop!.markNewsSynced(result.snapshotId);
      }
      newsFullyLoaded.current = true;
      setNewsItems(digestResult.items ?? []);
    })().catch(() => setToast('관광뉴스 자동 동기화를 완료하지 못했습니다.'));
  }, [accessToken, actor.role, onSignOut]);

  const selectedTask =
    data.tasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedRoutine =
    data.routines.find((routine) => routine.id === selectedRoutineId) ?? null;
  const today = isoDate();
  const isAdmin = actor.role === 'admin';
  const canEdit = actor.role !== 'commenter';

  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const visibleTasks = useMemo(
    () =>
      data.tasks.filter((task) => {
        const matchesSearch = `${task.title} ${task.description}`
          .toLowerCase()
          .includes(deferredSearch);
        const matchesStatus =
          statusFilter === 'all' || task.status === statusFilter;
        const matchesMember =
          memberFilter === 'all' ||
          task.assigneeId === memberFilter ||
          task.collaborators.includes(memberFilter);
        return matchesSearch && matchesStatus && matchesMember;
      }),
    [data.tasks, deferredSearch, statusFilter, memberFilter],
  );

  const { completionRequests, overdue, todayTasks, ddayTasks } = useMemo(() => {
    const nextCompletionRequests: Task[] = [];
    const nextOverdue: Task[] = [];
    const nextTodayTasks: Task[] = [];
    const nextDdayTasks: Task[] = [];
    for (const task of data.tasks) {
      const endDate = task.endDate ?? task.date;
      if (task.status === 'completion_requested') {
        nextCompletionRequests.push(task);
      }
      if (!isTaskVisibleTo(task, actor)) continue;
      if (task.status !== 'completed') {
        if (endDate < today) {
          nextOverdue.push(task);
        } else {
          nextTodayTasks.push(task);
        }
      }
      const dayDiff = dayDifference(today, endDate);
      if (dayDiff <= 7) {
        nextDdayTasks.push(task);
      }
    }
    const byEndDateAsc = (a: Task, b: Task) =>
      compareTaskSchedule(
        a.endDate ?? a.date,
        a.time,
        b.endDate ?? b.date,
        b.time,
      );
    nextOverdue.sort(byEndDateAsc);
    nextTodayTasks.sort(byEndDateAsc);
    nextDdayTasks.sort(byEndDateAsc);
    return {
      completionRequests: nextCompletionRequests,
      overdue: nextOverdue,
      todayTasks: nextTodayTasks,
      ddayTasks: nextDdayTasks,
    };
  }, [data.tasks, today, actor]);

  const taskFocusLabel =
    taskFocus === 'today'
      ? '오늘 업무'
      : taskFocus === 'overdue'
        ? '지연 업무'
        : taskFocus === 'dday'
          ? 'D-day · 7일 이내 마감'
          : null;
  const taskFocusTasks = useMemo(() => {
    if (!taskFocus) return null;
    const source =
      taskFocus === 'today'
        ? todayTasks
        : taskFocus === 'overdue'
          ? overdue
          : ddayTasks.filter((task) => task.status !== 'completed');
    return source.filter((task) =>
      `${task.title} ${task.description}`
        .toLowerCase()
        .includes(deferredSearch),
    );
  }, [taskFocus, todayTasks, overdue, ddayTasks, deferredSearch]);

  function updateData(
    updater: (current: WorkspaceState) => WorkspaceState,
    message?: string,
  ) {
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
      selectedTime: selectedTimeRef.current,
      ...overrides,
    };
    window.history.pushState(
      { ...window.history.state, [appHistoryKey]: entry },
      '',
      window.location.href,
    );
  }

  function openModal(
    nextModal: Exclude<Modal, null>,
    options: Partial<AppHistoryEntry> = {},
  ) {
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
    if (options.selectedTime !== undefined) {
      selectedTimeRef.current = options.selectedTime;
      setSelectedTime(options.selectedTime);
    }
    setModal(nextModal);
    pushAppHistory({ ...options, modal: nextModal });
  }

  function closeModal() {
    const entry = window.history.state?.[appHistoryKey] as
      | AppHistoryEntry
      | undefined;
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

  function openCreateTask(date = today, time: string | null = null) {
    if (!canEdit) return setToast('댓글 사용자는 업무를 등록할 수 없습니다.');
    openModal('task', { selectedDate: date, selectedTime: time });
  }

  function openRoutine(routineId: string) {
    openModal('routineDetail', { selectedRoutineId: routineId });
  }

  function editTask(taskId: string) {
    if (!canEdit) return setToast('댓글 사용자는 업무를 수정할 수 없습니다.');
    openModal('editTask', { selectedTaskId: taskId });
  }

  function editRoutine(routineId: string) {
    if (!canEdit) return setToast('댓글 사용자는 루틴을 수정할 수 없습니다.');
    openModal('editRoutine', { selectedRoutineId: routineId });
  }

  function setTaskStatus(taskId: string, status: Task['status']) {
    if (status === 'completed' && !isAdmin)
      return setToast('최종 완료는 관리자만 처리할 수 있습니다.');
    updateData(
      (current) => ({
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === taskId ? { ...task, status } : task,
        ),
      }),
      status === 'completed'
        ? '최종 완료했습니다.'
        : '업무 상태를 변경했습니다.',
    );
  }

  function toggleChecklist(taskId: string, checkId: string) {
    if (!canEdit)
      return setToast('댓글 사용자는 체크리스트를 수정할 수 없습니다.');
    updateData((current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              checklist: task.checklist.map((item) =>
                item.id === checkId ? { ...item, done: !item.done } : item,
              ),
            }
          : task,
      ),
    }));
  }

  function toggleRoutineChecklist(routineId: string, index: number) {
    if (!canEdit)
      return setToast('댓글 사용자는 체크리스트를 수정할 수 없습니다.');
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

  function deleteTaskComment(taskId: string, commentId: string) {
    if (!isAdmin) return;
    updateData(
      (current) => ({
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                comments: task.comments.filter(
                  (comment) => comment.id !== commentId,
                ),
              }
            : task,
        ),
      }),
      '댓글을 삭제했습니다.',
    );
  }

  function deleteTask(taskId: string) {
    if (!isAdmin) return setToast('업무 삭제는 관리자만 할 수 있습니다.');
    if (!window.confirm('이 업무를 삭제할까요?')) return;
    deletedIdsRef.current.add(taskId);
    updateData(
      (current) => ({
        ...current,
        tasks: current.tasks.filter((task) => task.id !== taskId),
      }),
      '업무를 삭제했습니다.',
    );
    closeModal();
  }

  function deleteRoutine(routineId: string) {
    if (!isAdmin) return setToast('루틴 삭제는 관리자만 할 수 있습니다.');
    if (
      !window.confirm('이 루틴을 삭제할까요? 과거에 생성된 업무는 유지됩니다.')
    )
      return;
    deletedIdsRef.current.add(routineId);
    updateData(
      (current) => ({
        ...current,
        routines: current.routines.filter(
          (routine) => routine.id !== routineId,
        ),
      }),
      '루틴을 삭제했습니다.',
    );
    closeModal();
  }

  async function refreshWorkspace() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const deletedIds = [...deletedIdsRef.current];
      const response = await fetch('/api/state', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ state: dataRef.current, deletedIds }),
      });
      const result = (await response.json()) as {
        error?: string;
        state?: WorkspaceState;
      };
      if (response.status === 401) {
        await onSignOut();
        return;
      }
      if (!response.ok) {
        throw new Error(result.error ?? '최신 데이터를 불러오지 못했습니다.');
      }
      deletedIds.forEach((id) => deletedIdsRef.current.delete(id));
      if (result.state) {
        window.localStorage.setItem(
          `snoopy-work-calendar-offline:${actor.email.toLowerCase()}`,
          JSON.stringify(result.state),
        );
        skipSave.current = true;
        setData(result.state);
      }
      setToast('캘린더를 최신 내용으로 새로고침했습니다.');
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : '최신 데이터를 불러오지 못했습니다.',
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function refreshPendingRegistrations(silent = false) {
    try {
      const response = await fetch('/api/auth/registrations', {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      });
      const result = (await response.json()) as {
        registrations?: RegistrationRequest[];
        error?: string;
      };
      if (response.status === 401) {
        await onSignOut();
        return;
      }
      if (!response.ok)
        throw new Error(
          result.error ?? '가입 대기 목록을 불러오지 못했습니다.',
        );
      setPendingRegistrations(result.registrations ?? []);
      pendingRegistrationsLoaded.current = true;
      if (!silent) setToast('가입 대기 목록을 새로고침했습니다.');
    } catch (error) {
      pendingRegistrationsLoaded.current = false;
      setToast(
        error instanceof Error
          ? error.message
          : '가입 대기 목록을 불러오지 못했습니다.',
      );
    }
  }

  async function loadAllNews() {
    if (newsFullyLoaded.current || newsLoadingFull.current) return;
    newsLoadingFull.current = true;
    try {
      const response = await fetch('/api/news', {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      });
      const result = (await response.json()) as {
        items?: NewsItem[];
        error?: string;
      };
      if (response.status === 401) {
        await onSignOut();
        return;
      }
      if (!response.ok) {
        throw new Error(result.error ?? '관광뉴스를 불러오지 못했습니다.');
      }
      newsFullyLoaded.current = true;
      setNewsItems(result.items ?? []);
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : '관광뉴스를 불러오지 못했습니다.',
      );
    } finally {
      newsLoadingFull.current = false;
    }
  }

  async function importNewsFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const imported: NewsItem[] = [];
    for (const file of Array.from(files)) {
      const text = await file.text();
      const title =
        text.match(/^#\s+(.+)$/m)?.[1] ?? file.name.replace(/\.md$/i, '');
      const url = text.match(/https?:\/\/\S+/)?.[0];
      imported.push({
        id: uid('news'),
        title,
        category: '직접 등록',
        source: file.name,
        collectedAt: isoDate(),
        url,
      });
    }
    try {
      const response = await fetch('/api/news', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ items: imported }),
      });
      const result = (await response.json()) as {
        items?: NewsItem[];
        error?: string;
      };
      if (response.status === 401) {
        await onSignOut();
        return;
      }
      if (!response.ok)
        throw new Error(result.error ?? '관광뉴스를 저장하지 못했습니다.');
      setNewsItems(result.items ?? []);
      setToast(`${imported.length}개의 관광뉴스 문서를 가져왔습니다.`);
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : '관광뉴스를 저장하지 못했습니다.',
      );
    }
  }

  async function editNewsItem(item: NewsItem) {
    const title = window.prompt('뉴스 제목', item.title);
    if (title === null || !title.trim()) return;
    const category = window.prompt('카테고리', item.category);
    if (category === null || !category.trim()) return;
    const source = window.prompt('출처', item.source);
    if (source === null || !source.trim()) return;
    const collectedAt = window.prompt('등록일(YYYY-MM-DD)', item.collectedAt);
    if (collectedAt === null || !/^\d{4}-\d{2}-\d{2}$/.test(collectedAt))
      return;
    const url = window.prompt('원문 URL(없으면 비워두기)', item.url ?? '');
    if (url === null) return;
    const nextItem: NewsItem = {
      ...item,
      title: title.trim(),
      category: category.trim(),
      source: source.trim(),
      collectedAt,
      url: normalizeUrl(url) || undefined,
    };
    try {
      const response = await fetch('/api/news', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ item: nextItem }),
      });
      const result = (await response.json()) as {
        items?: NewsItem[];
        error?: string;
      };
      if (response.status === 401) {
        await onSignOut();
        return;
      }
      if (!response.ok)
        throw new Error(result.error ?? '관광뉴스를 수정하지 못했습니다.');
      setNewsItems(result.items ?? []);
      setToast('관광뉴스를 수정했습니다.');
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : '관광뉴스를 수정하지 못했습니다.',
      );
    }
  }

  async function deleteNewsItem(item: NewsItem) {
    if (!window.confirm('이 관광뉴스를 삭제할까요?')) return;
    try {
      const response = await fetch(
        `/api/news?id=${encodeURIComponent(item.id)}`,
        {
          method: 'DELETE',
          headers: { authorization: `Bearer ${accessToken}` },
        },
      );
      const result = (await response.json()) as {
        items?: NewsItem[];
        error?: string;
      };
      if (response.status === 401) {
        await onSignOut();
        return;
      }
      if (!response.ok)
        throw new Error(result.error ?? '관광뉴스를 삭제하지 못했습니다.');
      setNewsItems(result.items ?? []);
      setToast('관광뉴스를 삭제했습니다.');
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : '관광뉴스를 삭제하지 못했습니다.',
      );
    }
  }

  async function approveRegistration(
    id: string,
    role: Exclude<Role, 'admin'>,
    team: string,
  ) {
    const response = await fetch('/api/auth/registrations', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ id, role, team }),
    });
    const result = (await response.json()) as {
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
    setData((current) => ({
      ...current,
      members: [...current.members, result.member!],
    }));
    setPendingRegistrations(result.registrations ?? []);
    setToast(`${result.member.name}님의 가입을 승인했습니다.`);
  }

  function navigate(next: View) {
    if (next === 'settings' && isAdmin && !pendingRegistrationsLoaded.current) {
      pendingRegistrationsLoaded.current = true;
      void refreshPendingRegistrations(true);
    }
    if (next === 'news') void loadAllNews();
    if (next !== 'tasks') setTaskFocus(null);
    if (viewRef.current !== next || modalRef.current) {
      viewRef.current = next;
      modalRef.current = null;
      setView(next);
      setModal(null);
      pushAppHistory({ view: next, modal: null });
    }
    setMobileMenu(false);
  }

  function focusTaskList(focus: 'today' | 'overdue' | 'dday') {
    setTaskFocus(focus);
    navigate('tasks');
  }

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = async () => {
      await context.registerTool(
        {
          name: 'list_today_tasks',
          title: '오늘 업무 조회',
          description:
            '현재 사용자에게 보이는 오늘의 스누피가든 업무를 조회합니다.',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: false },
          execute() {
            return dataRef.current.tasks
              .filter(
                (task) =>
                  task.date === isoDate() && task.status !== 'completed',
              )
              .map((task) => ({
                id: task.id,
                title: task.title,
                status: statusLabel[task.status],
              }));
          },
        },
        { signal: lifecycle.signal },
      );
      await context.registerTool(
        {
          name: 'create_work_task',
          title: '업무 등록',
          description:
            '제목과 날짜를 받아 새 일반 업무를 등록하고 화면에 즉시 표시합니다.',
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string', minLength: 1 },
              date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            },
            required: ['title', 'date'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute(input) {
            const value = input as { title?: unknown; date?: unknown };
            if (
              typeof value.title !== 'string' ||
              !value.title.trim() ||
              typeof value.date !== 'string' ||
              !/^\d{4}-\d{2}-\d{2}$/.test(value.date)
            ) {
              throw new Error('title과 YYYY-MM-DD 형식의 date가 필요합니다.');
            }
            if (actorRef.current.role === 'commenter')
              throw new Error('댓글 사용자는 업무를 등록할 수 없습니다.');
            const task: Task = {
              id: uid('task'),
              title: value.title.trim(),
              description: '',
              date: value.date,
              categoryId:
                dataRef.current.categories.find((item) => item.active)?.id ??
                'park',
              assigneeId: defaultAssigneeId(dataRef.current, actorRef.current),
              collaborators: [],
              priority: 'normal',
              status: 'scheduled',
              type: 'task',
              checklist: [],
              comments: [],
              createdBy: actorRef.current.id,
              createdAt: new Date().toISOString(),
            };
            setData((current) => ({
              ...current,
              tasks: [...current.tasks, task],
            }));
            setView('calendar');
            return {
              id: task.id,
              title: task.title,
              date: task.date,
              status: '예정',
            };
          },
        },
        { signal: lifecycle.signal },
      );
    };
    void register().catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  return (
    <main className="min-h-screen bg-[#f5f3ec] text-[#26352d]">
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-[#d8ded4] bg-[#fbfaf5]/95 px-4 backdrop-blur md:px-7">
        <div className="flex items-center gap-3">
          <Button
            aria-label="메뉴"
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileMenu((open) => !open)}
          >
            <Menu />
          </Button>
          <div className="grid size-10 place-items-center rounded-2xl bg-[#2f6b4f] text-white shadow-sm">
            <Leaf className="size-5" />
          </div>
          <div>
            <p className="hidden text-[11px] font-bold tracking-[0.12em] text-[#708076] sm:block">
              SNOOPY GARDEN
            </p>
            <h1 className="text-sm font-extrabold tracking-tight sm:text-base">
              파크사업팀 워크 캘린더
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            aria-label="알림"
            variant="outline"
            size="icon"
            className="relative rounded-full bg-white"
            onClick={() => navigate('notifications')}
          >
            <Bell />
            {completionRequests.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-[#a83f36] text-[9px] font-black text-white">
                {completionRequests.length}
              </span>
            )}
          </Button>
          <button
            onClick={() => navigate('settings')}
            className="hidden items-center gap-2 rounded-full border border-[#d8ded4] bg-white py-1 pl-1 pr-3 sm:flex"
          >
            <span className="grid size-8 place-items-center rounded-full bg-[#f0c85a] text-xs font-black text-[#4f431f]">
              {actor.name.slice(0, 1)}
            </span>
            <span className="text-sm font-bold">{actor.name}</span>
            <span className="rounded-full bg-[#e7f0eb] px-2 py-0.5 text-[10px] font-bold text-[#2f6b4f]">
              {roleLabel(actor)}
            </span>
          </button>
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

      <div className="mx-auto grid max-w-[1680px] md:grid-cols-[230px_minmax(0,1fr)]">
        <Sidebar
          view={view}
          navigate={navigate}
          openCreateTask={openCreateTask}
        />
        {mobileMenu && (
          <div className="fixed inset-0 z-30 md:hidden">
            <button
              aria-label="메뉴 닫기"
              className="absolute inset-0 bg-black/20"
              onClick={() => setMobileMenu(false)}
            />
            <aside className="relative h-full w-64 bg-[#fbfaf5] p-4 pt-20">
              <SidebarContent
                view={view}
                navigate={navigate}
                openCreateTask={openCreateTask}
              />
            </aside>
          </div>
        )}

        <section className="min-w-0 p-4 pb-24 md:p-7 md:pb-8">
          <div className="mb-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div>
              <p className="mb-1 text-sm font-semibold text-[#5f6d64]">
                {new Date().toLocaleDateString('ko-KR', {
                  timeZone: 'Asia/Seoul',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  weekday: 'long',
                })}
              </p>
              <h2 className="text-2xl font-black tracking-tight md:text-3xl">
                {viewMeta[view].label}
              </h2>
              <p className="mt-1 text-sm text-[#5f6d64]">
                {viewMeta[view].subtitle}
              </p>
            </div>
            <div className="flex gap-2">
              {view === 'today' ? (
                <Button
                  variant="outline"
                  className="h-11 rounded-xl bg-white"
                  disabled={refreshing}
                  onClick={() => void refreshWorkspace()}
                >
                  <RefreshCw className={refreshing ? 'animate-spin' : ''} />
                  전체 새로고침
                </Button>
              ) : (
                <div className="relative flex-1 sm:w-64 sm:flex-none">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#89938c]" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    aria-label="업무 검색"
                    placeholder="업무 검색"
                    className={`${inputClass} pl-9`}
                  />
                </div>
              )}
              {canEdit && (
                <Button
                  className="h-11 rounded-xl bg-[#2f6b4f] px-4 text-white hover:bg-[#255940]"
                  onClick={() => openCreateTask()}
                >
                  <Plus />
                  업무 추가
                </Button>
              )}
            </div>
          </div>

          {view === 'today' && (
            <TodayView
              data={data}
              news={newsItems}
              actor={actor}
              todayTasks={todayTasks}
              requests={completionRequests}
              overdue={overdue}
              ddayTasks={ddayTasks}
              isAdmin={isAdmin}
              openTask={openTask}
              openRoutine={openRoutine}
              setTaskStatus={setTaskStatus}
              navigate={navigate}
              focusTaskList={focusTaskList}
              openCreateTask={openCreateTask}
            />
          )}
          {view === 'calendar' && (
            <CalendarView
              data={data}
              tasks={visibleTasks}
              month={monthCursor}
              setMonth={setMonthCursor}
              openTask={openTask}
              openRoutine={openRoutine}
              openCreateTask={openCreateTask}
              refresh={refreshWorkspace}
              refreshing={refreshing}
            />
          )}
          {view === 'tasks' && (
            <TasksView
              data={data}
              tasks={taskFocusTasks ?? visibleTasks}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              memberFilter={memberFilter}
              setMemberFilter={setMemberFilter}
              openTask={openTask}
              focusLabel={taskFocusLabel}
              clearFocus={() => setTaskFocus(null)}
            />
          )}
          {view === 'routines' && (
            <RoutinesView
              data={data}
              canEdit={canEdit}
              openCreate={() => openModal('routine')}
              openRoutine={openRoutine}
              updateData={updateData}
            />
          )}
          {view === 'notes' && (
            <NotesView
              data={data}
              canEdit={canEdit}
              isAdmin={isAdmin}
              openCreate={() => openModal('note')}
              openTask={openTask}
              updateData={updateData}
              actor={actor}
              markDeleted={(id) => deletedIdsRef.current.add(id)}
            />
          )}
          {view === 'team' && <TeamView data={data} openTask={openTask} />}
          {view === 'news' && (
            <NewsView
              news={newsItems}
              isAdmin={isAdmin}
              onImport={importNewsFiles}
              onEdit={editNewsItem}
              onDelete={deleteNewsItem}
            />
          )}
          {view === 'settings' && (
            <SettingsView
              data={data}
              actor={actor}
              isAdmin={isAdmin}
              pendingRegistrations={pendingRegistrations}
              openMember={() => openModal('member')}
              refreshPendingRegistrations={refreshPendingRegistrations}
              approveRegistration={approveRegistration}
              updateData={updateData}
            />
          )}
          {view === 'notifications' && (
            <NotificationsView
              data={data}
              isAdmin={isAdmin}
              openTask={openTask}
              setTaskStatus={setTaskStatus}
            />
          )}
        </section>
      </div>

      <nav
        className="fixed inset-x-3 bottom-3 z-30 grid grid-cols-5 rounded-2xl border border-[#d8ded4] bg-[#fbfaf5]/95 p-1.5 shadow-[0_12px_40px_rgba(41,56,47,0.16)] backdrop-blur md:hidden"
        aria-label="모바일 메뉴"
      >
        {(
          [
            ['today', LayoutDashboard, '오늘'],
            ['calendar', CalendarDays, '캘린더'],
            ['add', Plus, '추가'],
            ['notes', CircleAlert, '특이사항'],
            ['team', Users, '팀'],
          ] as const
        ).map(([key, Icon, label]) => (
          <button
            key={key}
            onClick={() => (key === 'add' ? openCreateTask() : navigate(key))}
            className={`flex flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-bold ${view === key ? 'bg-[#e3eee7] text-[#245b43]' : 'text-[#59675e]'}`}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </nav>

      {modal === 'task' && (
        <TaskForm
          data={data}
          actor={actor}
          defaultDate={selectedDate}
          defaultTime={selectedTime ?? undefined}
          close={closeModal}
          save={(task) =>
            updateData(
              (current) => ({ ...current, tasks: [...current.tasks, task] }),
              '새 업무를 등록했습니다.',
            )
          }
        />
      )}
      {modal === 'editTask' && selectedTask && (
        <EditTaskForm
          data={data}
          task={selectedTask}
          close={closeModal}
          save={(updatedTask) =>
            updateData(
              (current) => ({
                ...current,
                tasks: current.tasks.map((task) =>
                  task.id === updatedTask.id ? updatedTask : task,
                ),
              }),
              '업무 내용을 수정했습니다.',
            )
          }
        />
      )}
      {modal === 'note' && (
        <NoteForm
          data={data}
          actor={actor}
          close={closeModal}
          save={(note) =>
            updateData(
              (current) => ({ ...current, notes: [note, ...current.notes] }),
              '특이사항을 등록했습니다.',
            )
          }
        />
      )}
      {modal === 'routine' && (
        <RoutineForm
          data={data}
          close={closeModal}
          save={(routine) =>
            updateData(
              (current) => ({
                ...current,
                routines: [...current.routines, routine],
              }),
              '새 루틴을 등록했습니다.',
            )
          }
        />
      )}
      {modal === 'editRoutine' && selectedRoutine && (
        <EditRoutineForm
          data={data}
          routine={selectedRoutine}
          close={closeModal}
          save={(updatedRoutine) =>
            updateData(
              (current) => ({
                ...current,
                routines: current.routines.map((routine) =>
                  routine.id === updatedRoutine.id ? updatedRoutine : routine,
                ),
              }),
              '루틴 내용을 수정했습니다.',
            )
          }
        />
      )}
      {modal === 'member' && (
        <MemberForm
          close={closeModal}
          save={(member) =>
            updateData(
              (current) => ({
                ...current,
                members: [...current.members, member],
              }),
              '사용자를 추가했습니다.',
            )
          }
        />
      )}
      {modal === 'detail' && selectedTask && (
        <TaskDetail
          task={selectedTask}
          data={data}
          canEdit={canEdit}
          isAdmin={isAdmin}
          close={closeModal}
          edit={() => editTask(selectedTask.id)}
          toggleChecklist={toggleChecklist}
          setTaskStatus={setTaskStatus}
          deleteTask={deleteTask}
          deleteComment={deleteTaskComment}
          addComment={(body) =>
            updateData(
              (current) => ({
                ...current,
                tasks: current.tasks.map((task) =>
                  task.id === selectedTask.id
                    ? {
                        ...task,
                        comments: [
                          ...task.comments,
                          {
                            id: uid('comment'),
                            authorId: actor.id,
                            body,
                            createdAt: new Date().toISOString(),
                          },
                        ],
                      }
                    : task,
                ),
              }),
              '댓글을 등록했습니다.',
            )
          }
        />
      )}
      {modal === 'routineDetail' && selectedRoutine && (
        <InteractiveRoutineDetail
          routine={selectedRoutine}
          data={data}
          canEdit={canEdit}
          isAdmin={isAdmin}
          close={closeModal}
          edit={() => editRoutine(selectedRoutine.id)}
          deleteRoutine={() => deleteRoutine(selectedRoutine.id)}
          toggleChecklist={toggleRoutineChecklist}
        />
      )}
      {toast && (
        <output className="fixed bottom-24 left-1/2 z-[70] -translate-x-1/2 rounded-full bg-[#26352d] px-4 py-2.5 text-sm font-bold text-white shadow-xl md:bottom-7">
          {toast}
        </output>
      )}
    </main>
  );
}

function Sidebar({
  view,
  navigate,
  openCreateTask,
}: {
  view: View;
  navigate: (view: View) => void;
  openCreateTask: () => void;
}) {
  return (
    <aside className="hidden min-h-[calc(100vh-64px)] border-r border-[#d8ded4] bg-[#fbfaf5] p-4 md:block">
      <SidebarContent
        view={view}
        navigate={navigate}
        openCreateTask={openCreateTask}
      />
    </aside>
  );
}

function SidebarContent({
  view,
  navigate,
  openCreateTask,
}: {
  view: View;
  navigate: (view: View) => void;
  openCreateTask: () => void;
}) {
  const items: View[] = [
    'today',
    'calendar',
    'tasks',
    'routines',
    'notes',
    'team',
    'news',
  ];
  return (
    <>
      <Button
        className="mb-6 h-11 w-full rounded-xl bg-[#2f6b4f] text-white shadow-sm hover:bg-[#255940]"
        onClick={openCreateTask}
      >
        <Plus />새 업무
      </Button>
      <nav className="space-y-1" aria-label="주요 메뉴">
        {items.map((key) => {
          const { icon: Icon, label } = viewMeta[key];
          return (
            <button
              key={key}
              onClick={() => navigate(key)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition ${view === key ? 'bg-[#e3eee7] text-[#245b43]' : 'text-[#6a776e] hover:bg-[#efeee8]'}`}
            >
              <Icon className="size-4" />
              {label}
            </button>
          );
        })}
      </nav>
      <div className="mt-8 border-t border-[#dde1da] pt-4">
        <button
          onClick={() => navigate('settings')}
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold ${view === 'settings' ? 'bg-[#e3eee7] text-[#245b43]' : 'text-[#6a776e] hover:bg-[#efeee8]'}`}
        >
          <Settings className="size-4" />
          설정
        </button>
      </div>
    </>
  );
}

function CategoryDot({ category }: { category?: Category }) {
  return (
    <span
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={{ background: category?.color ?? '#9ca3af' }}
    />
  );
}

function LinkifiedText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/[^\s]+)/g).map((part, index) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="inline-flex items-center gap-1 break-all font-bold text-[#2f6b4f] underline decoration-[#2f6b4f]/35 underline-offset-2"
          >
            <Link2 className="size-3 shrink-0" />
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** 긴급 업무는 "‼ [긴급]" 파란 표시를, 지연 업무(완료 제외)는 빨간 글씨를 덧붙입니다. */
function TaskTitleText({ task }: { task: Task }) {
  const isUrgent = task.status !== 'completed' && task.priority === 'urgent';
  const overdueFlag = isTaskOverdue(task);
  const colorClass = isUrgent
    ? 'text-[#1d4ed8]'
    : overdueFlag
      ? 'text-[#c0392b]'
      : '';
  return (
    <span className={colorClass}>
      {isUrgent && <span className="font-black">‼ [긴급] </span>}
      {task.title}
    </span>
  );
}

function TaskCard({
  task,
  data,
  openTask,
}: {
  task: Task;
  data: WorkspaceState;
  openTask: (id: string) => void;
}) {
  const category = data.categories.find((item) => item.id === task.categoryId);
  const names = assigneeNames(task, data);
  return (
    <button
      onClick={() => openTask(task.id)}
      className="group flex w-full items-center gap-3 rounded-2xl border border-[#dbe0d9] bg-white p-3 text-left shadow-[0_5px_18px_rgba(55,74,62,0.04)] transition hover:-translate-y-0.5 hover:border-[#adc2b4] hover:shadow-md"
    >
      <span
        className={`grid size-10 shrink-0 place-items-center rounded-xl ${task.status === 'completed' ? 'bg-[#e2eee7] text-[#2f6b4f]' : task.priority === 'urgent' ? 'bg-[#fae0dc] text-[#a3483e]' : 'bg-[#f0efe9] text-[#657269]'}`}
      >
        {task.status === 'completed' ? (
          <Check className="size-5" />
        ) : (
          <ClipboardCheck className="size-5" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <CategoryDot category={category} />
          <strong
            className={`truncate text-sm ${task.status === 'completed' ? 'text-[#879089] line-through' : ''}`}
          >
            <TaskTitleText task={task} />
          </strong>
        </span>
        <span className="mt-1 block truncate text-xs text-[#5f6d64]">
          {formatDate(task.date)} · {formatTaskTime(task.time, task.endTime)} ·{' '}
          {names.length ? names.join(', ') : '미배정'} ·{' '}
          {statusLabel[task.status]}
        </span>
      </span>
      <ChevronRight className="size-4 text-[#9aa49d] transition group-hover:translate-x-0.5" />
    </button>
  );
}

function TodayView({
  data,
  news,
  actor,
  todayTasks,
  requests,
  overdue,
  ddayTasks,
  isAdmin,
  openTask,
  openRoutine,
  setTaskStatus,
  navigate,
  focusTaskList,
  openCreateTask,
}: {
  data: WorkspaceState;
  news: NewsItem[];
  actor: Member;
  todayTasks: Task[];
  requests: Task[];
  overdue: Task[];
  ddayTasks: Task[];
  isAdmin: boolean;
  openTask: (id: string) => void;
  openRoutine: (id: string) => void;
  setTaskStatus: (id: string, status: Task['status']) => void;
  navigate: (view: View) => void;
  focusTaskList: (focus: 'today' | 'overdue' | 'dday') => void;
  openCreateTask: (date?: string, time?: string | null) => void;
}) {
  const today = isoDate();
  const previousDate = shiftIsoDate(today, -1);
  const previousNotes = data.notes.filter(
    (item) => item.date === previousDate && !item.completed,
  );
  const widgetTasks = data.tasks.filter((task) => isTaskVisibleTo(task, actor));
  const sortedDdayTasks = [...ddayTasks].sort(
    (a, b) =>
      Number(a.status === 'completed') - Number(b.status === 'completed') ||
      compareTaskSchedule(
        a.endDate ?? a.date,
        a.time,
        b.endDate ?? b.date,
        b.time,
      ),
  );
  const recentNews = news
    .filter((item) => {
      const age = dayDifference(item.collectedAt, isoDate());
      return age >= 0 && age <= 2;
    })
    .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
  const metrics: {
    label: string;
    value: number;
    note: string;
    onClick: () => void;
  }[] = [
    {
      label: '오늘 업무',
      value: todayTasks.length,
      note: '오늘 진행할 업무',
      onClick: () => focusTaskList('today'),
    },
    {
      label: '완료 요청',
      value: requests.length,
      note: '관리자 확인 필요',
      onClick: () => navigate('notifications'),
    },
    {
      label: '지연 업무',
      value: overdue.length,
      note: '마감일 경과',
      onClick: () => focusTaskList('overdue'),
    },
    {
      label: 'D-day 업무',
      value: ddayTasks.filter((task) => task.status !== 'completed').length,
      note: '7일 이내 마감',
      onClick: () => focusTaskList('dday'),
    },
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {metrics.map((metric, index) => (
          <button
            key={metric.label}
            onClick={metric.onClick}
            className="rounded-2xl border border-[#d8ded4] bg-[#fbfaf5] p-4 text-left shadow-[0_7px_22px_rgba(55,74,62,0.05)] transition hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between">
              <p className="text-xs font-bold text-[#56645b]">{metric.label}</p>
              {index === 1 && (
                <CheckCircle2 className="size-4 text-[#2f6b4f]" />
              )}
            </div>
            <strong className="mt-2 block text-2xl font-black">
              {metric.value}
            </strong>
            <p className="mt-1 text-xs text-[#5f6d64]">{metric.note}</p>
          </button>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <section className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-4 shadow-[0_12px_36px_rgba(55,74,62,0.06)] sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="font-black">{actor.name}님의 오늘 업무</h3>
                <p className="text-xs text-[#5f6d64]">
                  마감일이 지나지 않은 모든 업무를 마감 임박순으로 표시합니다.
                </p>
              </div>
              <Button variant="outline" onClick={() => openCreateTask()}>
                <Plus />
                추가
              </Button>
            </div>
            <div className="space-y-2">
              {todayTasks.length ? (
                todayTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    data={data}
                    openTask={openTask}
                  />
                ))
              ) : (
                <Empty
                  title="진행 중인 업무가 없습니다."
                  action="업무 추가"
                  onClick={() => openCreateTask()}
                />
              )}
            </div>
          </section>
          <section className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-4 sm:p-5">
            <div className="mb-4">
              <h3 className="font-black">D-day · 7일 이내 마감</h3>
              <p className="text-xs text-[#748078]">
                날짜가 임박한 순서이며, 완료 업무는 아래로 이동합니다.
              </p>
            </div>
            <div className="space-y-2">
              {sortedDdayTasks.length ? (
                sortedDdayTasks.map((task) => (
                  <div
                    key={task.id}
                    className={`flex items-center gap-3 rounded-2xl border border-[#dbe0d9] bg-white p-3 ${task.status === 'completed' ? 'opacity-55' : ''}`}
                  >
                    <input
                      aria-label={`${task.title} 완료`}
                      type="checkbox"
                      checked={task.status === 'completed'}
                      disabled={!isAdmin}
                      readOnly
                      onClick={() =>
                        setTaskStatus(
                          task.id,
                          task.status === 'completed'
                            ? 'in_progress'
                            : 'completed',
                        )
                      }
                      className="size-5 shrink-0 accent-[#2f6b4f]"
                    />
                    <button
                      onClick={() => openTask(task.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <strong
                        className={`block truncate text-sm ${task.status === 'completed' ? 'line-through' : ''}`}
                      >
                        <TaskTitleText task={task} />
                      </strong>
                      <span className="mt-1 block text-xs text-[#748078]">
                        {priorityLabel[task.priority]} ·{' '}
                        {formatDate(task.endDate ?? task.date)} ·{' '}
                        {formatTaskTime(task.time, task.endTime)} ·{' '}
                        {dday(task.endDate ?? task.date)}
                      </span>
                    </button>
                  </div>
                ))
              ) : (
                <Empty title="7일 이내 마감 업무가 없습니다." />
              )}
            </div>
            {!isAdmin && (
              <p className="mt-3 text-xs text-[#748078]">
                최종 완료 체크는 관리자만 할 수 있습니다.
              </p>
            )}
          </section>
        </div>
        <aside className="space-y-4">
          <section className="rounded-3xl bg-[#2f6b4f] p-5 text-white shadow-[0_14px_34px_rgba(39,91,67,0.2)]">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-black">이번 주 핵심</h3>
              <span className="rounded-full bg-white/15 px-2 py-1 text-[10px] font-bold">
                자동 요약
              </span>
            </div>
            <ul className="space-y-3 text-sm">
              <li className="flex gap-3">
                <span className="min-w-10 font-black text-[#f2cf6b]">
                  {requests.length}건
                </span>
                <span>최종 완료 확인 대기</span>
              </li>
              <li className="flex gap-3">
                <span className="min-w-10 font-black text-[#f2cf6b]">
                  {overdue.length}건
                </span>
                <span>마감이 지난 업무</span>
              </li>
              <li className="flex gap-3">
                <span className="min-w-10 font-black text-[#f2cf6b]">
                  {
                    ddayTasks.filter((task) => task.status !== 'completed')
                      .length
                  }
                  건
                </span>
                <span>7일 이내 마감 업무</span>
              </li>
            </ul>
          </section>
          <button
            onClick={() => navigate('notes')}
            className="w-full rounded-3xl border border-[#e3d5ad] bg-[#fff8df] p-5 text-left transition hover:-translate-y-0.5"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-black">전일 특이사항</h3>
              <span className="rounded-full bg-[#f0c85a] px-2 py-1 text-[10px] font-black">
                {formatDate(previousDate)}
              </span>
            </div>
            {previousNotes.length ? (
              previousNotes.slice(0, 3).map((note) => (
                <div
                  key={note.id}
                  className="border-t border-[#eadcae] py-2 first:border-0 first:pt-0"
                >
                  <p className="text-sm font-bold">{note.body}</p>
                  <p className="mt-1 text-xs text-[#7b6d43]">
                    {note.location} · {note.urgent ? '긴급 확인' : '일반'}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm font-bold">
                전일 등록된 특이사항이 없습니다.
              </p>
            )}
          </button>
        </aside>
      </div>
      <section className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-black">관광뉴스 요약</h3>
            <p className="text-xs text-[#748078]">
              최근 등록된 관광 동향을 한눈에 확인하세요.
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate('news')}>
            <Newspaper />
            전체 보기
          </Button>
        </div>
        {recentNews.length ? (
          <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
            {recentNews.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-xl bg-[#f1f2ed] px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{item.title}</p>
                  <p className="text-[10px] text-[#748078]">
                    {item.collectedAt} · {item.source}
                  </p>
                </div>
                {item.url && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-xs font-bold text-[#2f6b4f]"
                  >
                    원문보기
                  </a>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Empty title="최근 3일 이내 등록된 관광뉴스가 없습니다." />
        )}
      </section>
      <div className="hidden lg:block">
        <TodayCalendarWidget
          data={data}
          tasks={widgetTasks}
          openTask={openTask}
          openRoutine={openRoutine}
        />
      </div>
    </div>
  );
}

/** 컴퓨터 화면 전용 달력 위젯입니다. 날짜를 누르면 해당 날짜의 전체 일정을 모달로 보여줍니다. */
function TodayCalendarWidget({
  data,
  tasks,
  openTask,
  openRoutine,
}: {
  data: WorkspaceState;
  tasks: Task[];
  openTask: (id: string) => void;
  openRoutine: (id: string) => void;
}) {
  const [cursor, setCursor] = useState(() => new Date());
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const year = cursor.getFullYear();
  const monthIndex = cursor.getMonth();
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const offset = new Date(year, monthIndex, 1).getDay();
  const cells = Array.from({ length: 42 }, (_, index) => {
    const day = index - offset + 1;
    return day > 0 && day <= days ? day : null;
  });
  const dateKey = (day: number) =>
    `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return (
    <section className="overflow-hidden rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] shadow-[0_12px_36px_rgba(55,74,62,0.06)]">
      <div className="flex items-center justify-between border-b border-[#e0e4de] px-5 py-4">
        <h3 className="font-black">달력 위젯</h3>
        <div className="flex items-center gap-1">
          <Button
            aria-label="이전 달"
            variant="ghost"
            size="icon"
            onClick={() => setCursor(new Date(year, monthIndex - 1, 1))}
          >
            <ChevronLeft />
          </Button>
          <span className="min-w-20 text-center text-sm font-bold">
            {year}년 {monthIndex + 1}월
          </span>
          <Button
            aria-label="다음 달"
            variant="ghost"
            size="icon"
            onClick={() => setCursor(new Date(year, monthIndex + 1, 1))}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-[#e0e4de] bg-[#f1f2ed]">
        {['일', '월', '화', '수', '목', '금', '토'].map((day, index) => (
          <div
            key={day}
            className={`py-1.5 text-center text-[11px] font-bold ${index === 0 ? 'text-[#b44a42]' : index === 6 ? 'text-[#416b8f]' : 'text-[#5f6d64]'}`}
          >
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, index) => {
          const date = day ? dateKey(day) : '';
          const dayTasks = day
            ? tasks.filter(
                (task) =>
                  task.date <= date && (task.endDate ?? task.date) >= date,
              )
            : [];
          const dayNotes = day
            ? data.notes.filter((note) => note.date === date)
            : [];
          const isToday = date === isoDate();
          return (
            <button
              key={index}
              type="button"
              disabled={!day}
              onClick={() => day && setExpandedDate(date)}
              className={`flex min-h-16 flex-col items-center gap-1 border-b border-r border-[#e5e7e2] p-1.5 text-left disabled:cursor-default ${isToday ? 'bg-[#edf4ef]' : day ? 'hover:bg-[#f4f5f1]' : 'bg-[#f3f1eb]/60'}`}
            >
              {day && (
                <>
                  <span
                    className={`grid size-6 place-items-center rounded-full text-[11px] font-bold ${isToday ? 'bg-[#2f6b4f] text-white' : index % 7 === 0 ? 'text-[#b44a42]' : index % 7 === 6 ? 'text-[#416b8f]' : 'text-[#56635b]'}`}
                  >
                    {day}
                  </span>
                  {(dayTasks.length > 0 || dayNotes.length > 0) && (
                    <span className="text-center text-[9px] font-bold leading-tight text-[#748078]">
                      {dayTasks.length > 0 ? `업무 ${dayTasks.length}` : ''}
                      {dayTasks.length > 0 && dayNotes.length > 0 ? ' · ' : ''}
                      {dayNotes.length > 0 ? `특이 ${dayNotes.length}` : ''}
                    </span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </div>
      {expandedDate && (
        <DayItemsModal
          date={expandedDate}
          data={data}
          tasks={tasks}
          close={() => setExpandedDate(null)}
          openTask={openTask}
          openRoutine={openRoutine}
        />
      )}
    </section>
  );
}

function CalendarView({
  data,
  tasks,
  month,
  setMonth,
  openTask,
  openRoutine,
  openCreateTask,
  refresh,
  refreshing,
}: {
  data: WorkspaceState;
  tasks: Task[];
  month: Date;
  setMonth: (date: Date) => void;
  openTask: (id: string) => void;
  openRoutine: (id: string) => void;
  openCreateTask: (date?: string, time?: string | null) => void;
  refresh: () => Promise<void>;
  refreshing: boolean;
}) {
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month');
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const offset = new Date(year, monthIndex, 1).getDay();
  const cells = Array.from({ length: 42 }, (_, index) => {
    const day = index - offset + 1;
    return day > 0 && day <= days ? day : null;
  });
  const dateKey = (day: number) =>
    `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const weeks = Array.from({ length: 6 }, (_, index) =>
    cells.slice(index * 7, index * 7 + 7),
  );
  const weekStart = startOfWeek(month);
  const weekEnd = addDays(weekStart, 6);
  const headerTitle =
    viewMode === 'month'
      ? `${year}년 ${monthIndex + 1}월`
      : weekStart.getFullYear() === weekEnd.getFullYear() &&
          weekStart.getMonth() === weekEnd.getMonth()
        ? `${weekStart.getFullYear()}년 ${weekStart.getMonth() + 1}월 ${weekStart.getDate()}일 - ${weekEnd.getDate()}일`
        : `${weekStart.getFullYear()}년 ${weekStart.getMonth() + 1}월 ${weekStart.getDate()}일 - ${weekEnd.getMonth() + 1}월 ${weekEnd.getDate()}일`;
  function goPrev() {
    if (viewMode === 'month') setMonth(new Date(year, monthIndex - 1, 1));
    else setMonth(addDays(month, -7));
  }
  function goNext() {
    if (viewMode === 'month') setMonth(new Date(year, monthIndex + 1, 1));
    else setMonth(addDays(month, 7));
  }
  function goToday() {
    if (viewMode === 'month') {
      setMonth(new Date(`${isoDate().slice(0, 7)}-01T00:00:00`));
    } else {
      setMonth(new Date());
    }
  }
  return (
    <article className="overflow-hidden rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] shadow-[0_12px_36px_rgba(55,74,62,0.06)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e0e4de] px-3 py-4 sm:px-6">
        <div className="flex items-center gap-1 sm:gap-2">
          <Button aria-label="이전" variant="ghost" size="icon" onClick={goPrev}>
            <ChevronLeft />
          </Button>
          <h3 className="text-base font-black sm:text-lg">{headerTitle}</h3>
          <Button aria-label="다음" variant="ghost" size="icon" onClick={goNext}>
            <ChevronRight />
          </Button>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="flex items-center gap-0.5 rounded-lg border border-[#d8ded4] bg-white p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('month')}
              className={`rounded-md px-2.5 py-1 text-xs font-bold transition ${viewMode === 'month' ? 'bg-[#2f6b4f] text-white' : 'text-[#5f6d64]'}`}
            >
              월
            </button>
            <button
              type="button"
              onClick={() => setViewMode('week')}
              className={`rounded-md px-2.5 py-1 text-xs font-bold transition ${viewMode === 'week' ? 'bg-[#2f6b4f] text-white' : 'text-[#5f6d64]'}`}
            >
              주
            </button>
          </div>
          <Button
            variant="outline"
            className="rounded-xl bg-white px-2 sm:px-3"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            <RefreshCw className={refreshing ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">새로고침</span>
          </Button>
          <Button
            variant="outline"
            className="rounded-xl bg-white px-2 sm:px-3"
            onClick={() => exportCalendarIcal(data)}
          >
            <Download />
            <span className="hidden sm:inline">iCal</span>
          </Button>
          <Button
            variant="outline"
            className="rounded-xl bg-white"
            onClick={goToday}
          >
            오늘
          </Button>
        </div>
      </div>
      {viewMode === 'week' ? (
        <WeekCalendarGrid
          data={data}
          tasks={tasks}
          weekStart={weekStart}
          openTask={openTask}
          openRoutine={openRoutine}
          openCreateTask={openCreateTask}
          openDay={setExpandedDate}
        />
      ) : (
        <>
          <div className="grid grid-cols-7 border-b border-[#e0e4de] bg-[#f1f2ed]">
            {['일', '월', '화', '수', '목', '금', '토'].map((day, index) => (
              <div
                key={day}
                className={`py-2 text-center text-xs font-bold ${index === 0 ? 'text-[#b44a42]' : index === 6 ? 'text-[#416b8f]' : 'text-[#5f6d64]'}`}
              >
                {day}
              </div>
            ))}
          </div>
          <div role="grid" aria-label={`${year}년 ${monthIndex + 1}월 업무 캘린더`}>
            {weeks.map((week, weekIndex) => {
          const segments = computeWeekSegments(
            tasks,
            week.map((day) => (day ? dateKey(day) : '')),
          );
          return (
            <div key={weekIndex} className="relative">
              <div className="grid grid-cols-7">
                {week.map((day, column) => {
                  const date = day ? dateKey(day) : '';
                  const allRoutines = day
                    ? data.routines.filter((routine) =>
                        routineOccursOnDate(routine, date),
                      )
                    : [];
                  const routines = allRoutines.slice(0, 2);
                  const visibleTaskIds = new Set(
                    segments
                      .filter(
                        (segment) =>
                          segment.lane < 3 &&
                          segment.start <= column &&
                          segment.end >= column,
                      )
                      .map((segment) => segment.task.id),
                  );
                  const hiddenTaskCount = day
                    ? tasks.filter(
                        (task) =>
                          task.date <= date &&
                          (task.endDate ?? task.date) >= date &&
                          !visibleTaskIds.has(task.id),
                      ).length
                    : 0;
                  const hiddenCount =
                    hiddenTaskCount + Math.max(0, allRoutines.length - 2);
                  const isToday = date === isoDate();
                  return (
                    <div
                      key={column}
                      className={`relative min-h-36 border-b border-r border-[#e5e7e2] p-1 text-left sm:min-h-40 sm:p-2 ${isToday ? 'bg-[#edf4ef]' : day ? 'hover:bg-[#f4f5f1]' : 'bg-[#f3f1eb]/60'}`}
                    >
                      {day && (
                        <>
                          <button
                            aria-label={`${formatDate(date)} 업무 추가`}
                            onClick={() => openCreateTask(date)}
                            className="absolute inset-0 z-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#2f6b4f]"
                          />
                          <div className="pointer-events-none relative z-10">
                            <span
                              className={`grid size-7 place-items-center rounded-full text-xs font-bold ${isToday ? 'bg-[#2f6b4f] text-white' : column === 0 ? 'text-[#b44a42]' : column === 6 ? 'text-[#416b8f]' : 'text-[#56635b]'}`}
                            >
                              {day}
                            </span>
                            <div className="mt-[78px] space-y-1">
                              {routines.map((routine) => {
                                const category = data.categories.find(
                                  (item) => item.id === routine.categoryId,
                                );
                                return (
                                  <button
                                    key={routine.id}
                                    onClick={() => openRoutine(routine.id)}
                                    className="pointer-events-auto block w-full truncate rounded-md border border-dashed border-[#2f6b4f]/40 bg-white/80 px-1 py-1 text-left text-[9px] font-black text-[#2f6b4f] sm:text-[10px]"
                                  >
                                    <Repeat2 className="mr-1 inline size-3" />
                                    <span
                                      style={{
                                        color: category?.color ?? '#2f6b4f',
                                      }}
                                    >
                                      루틴
                                    </span>{' '}
                                    {routine.title}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          {hiddenCount > 0 && (
                            <button
                              type="button"
                              className="pointer-events-auto absolute bottom-1 left-1 right-1 z-30 rounded-md bg-white/95 px-1 py-1 text-center text-[10px] font-black text-[#2f6b4f] shadow-sm ring-1 ring-[#ccd7cf] hover:bg-[#edf4ef]"
                              onClick={() => setExpandedDate(date)}
                            >
                              +{hiddenCount}개 더보기
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="pointer-events-none absolute inset-0 grid grid-cols-7">
                {segments
                  .filter((segment) => segment.lane < 3)
                  .map(({ task, start, end, lane }) => {
                    const category = data.categories.find(
                      (item) => item.id === task.categoryId,
                    );
                    return (
                      <button
                        key={`${task.id}-${weekIndex}`}
                        type="button"
                        aria-label={`${task.title}, ${formatDate(task.date)}부터 ${formatDate(task.endDate ?? task.date)}까지`}
                        onClick={() => openTask(task.id)}
                        className="pointer-events-auto relative z-20 row-start-1 h-5 min-w-0 self-start truncate rounded-md px-2 text-left text-[9px] font-black text-white shadow-sm ring-1 ring-black/5 sm:text-[11px]"
                        style={{
                          gridColumn: `${start + 1} / ${end + 2}`,
                          marginTop: `${38 + lane * 24}px`,
                          marginLeft: start === 0 ? 0 : 2,
                          marginRight: end === 6 ? 0 : 2,
                          background: taskBarBackground(task, category?.color),
                          textShadow: '0 1px 2px rgba(0, 0, 0, 0.35)',
                        }}
                      >
                        {task.priority === 'urgent' ? '‼[긴급] ' : ''}
                        {task.title}
                      </button>
                    );
                  })}
              </div>
            </div>
          );
            })}
          </div>
        </>
      )}
      {expandedDate && (
        <DayItemsModal
          date={expandedDate}
          data={data}
          tasks={tasks}
          close={() => setExpandedDate(null)}
          openTask={openTask}
          openRoutine={openRoutine}
        />
      )}
    </article>
  );
}

const WEEK_GRID_START_HOUR = 6;
const WEEK_GRID_END_HOUR = 24;
const WEEK_GRID_HOUR_HEIGHT = 56;

/** 주간 캘린더: 시간이 없는(종일) 업무·루틴은 상단에, 시간이 있는 업무는 시작~종료 시각에 맞춘
 * 세로 그리드에 배치합니다. 같은 시간대에 겹치는 업무는 자동으로 나란히 배치됩니다. */
function WeekCalendarGrid({
  data,
  tasks,
  weekStart,
  openTask,
  openRoutine,
  openCreateTask,
  openDay,
}: {
  data: WorkspaceState;
  tasks: Task[];
  weekStart: Date;
  openTask: (id: string) => void;
  openRoutine: (id: string) => void;
  openCreateTask: (date?: string, time?: string | null) => void;
  openDay: (date: string) => void;
}) {
  const weekdayLabels = ['일', '월', '화', '수', '목', '금', '토'];
  const dayDates = Array.from({ length: 7 }, (_, index) =>
    addDays(weekStart, index),
  );
  const dateKeys = dayDates.map(dateKeyOf);
  const todayKey = isoDate();

  const allDayTasks = tasks.filter((task) => !task.time);
  const allDaySegments = computeWeekSegments(allDayTasks, dateKeys);
  const visibleAllDaySegments = allDaySegments.filter(
    (segment) => segment.lane < 3,
  );
  const overflowAllDayByDay = dateKeys.map(
    (date) =>
      allDayTasks.filter(
        (task) =>
          task.date <= date &&
          (task.endDate ?? task.date) >= date &&
          !visibleAllDaySegments.some((segment) => segment.task.id === task.id),
      ).length,
  );
  const allDayRowHeight = Math.max(1, Math.min(3, allDaySegments.length ? Math.max(...allDaySegments.map((segment) => segment.lane + 1)) : 1)) * 24 + 8;

  const routinesByDay = dateKeys.map((date) =>
    data.routines.filter((routine) => routineOccursOnDate(routine, date)),
  );

  const hours = Array.from(
    { length: WEEK_GRID_END_HOUR - WEEK_GRID_START_HOUR },
    (_, index) => WEEK_GRID_START_HOUR + index,
  );
  const gridHeight = hours.length * WEEK_GRID_HOUR_HEIGHT;
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  return (
    <div>
      <div className="grid grid-cols-[52px_repeat(7,minmax(0,1fr))] border-b border-[#e0e4de] bg-[#f1f2ed]">
        <div />
        {dateKeys.map((date, index) => {
          const isToday = date === todayKey;
          return (
            <div key={date} className="py-2 text-center">
              <p
                className={`text-xs font-bold ${index === 0 ? 'text-[#b44a42]' : index === 6 ? 'text-[#416b8f]' : 'text-[#5f6d64]'}`}
              >
                {weekdayLabels[index]}
              </p>
              <p
                className={`mx-auto mt-1 grid size-7 place-items-center rounded-full text-sm font-black ${isToday ? 'bg-[#2f6b4f] text-white' : 'text-[#263b2e]'}`}
              >
                {dayDates[index].getDate()}
              </p>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-[52px_repeat(7,minmax(0,1fr))] border-b border-[#e0e4de] bg-[#fbfaf5]">
        <div className="py-1 pr-1 text-right text-[9px] font-bold text-[#9aa49d]">
          종일
        </div>
        <div className="relative col-span-7">
          <div
            className="grid grid-cols-7"
            style={{ minHeight: `${allDayRowHeight}px` }}
          >
            {visibleAllDaySegments.map(({ task, start, end, lane }) => {
              const category = data.categories.find(
                (item) => item.id === task.categoryId,
              );
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => openTask(task.id)}
                  className="relative z-10 row-start-1 h-6 min-w-0 self-start truncate rounded-md px-2 text-left text-[10px] font-black text-white shadow-sm ring-1 ring-black/5"
                  style={{
                    gridColumn: `${start + 1} / ${end + 2}`,
                    marginTop: `${lane * 26 + 2}px`,
                    marginLeft: start === 0 ? 0 : 2,
                    marginRight: end === 6 ? 0 : 2,
                    background: taskBarBackground(task, category?.color),
                    textShadow: '0 1px 2px rgba(0, 0, 0, 0.35)',
                  }}
                >
                  {task.priority === 'urgent' ? '‼[긴급] ' : ''}
                  {task.title}
                </button>
              );
            })}
          </div>
        </div>
        <div className="col-span-8 grid grid-cols-[52px_repeat(7,minmax(0,1fr))]">
          <div />
          {overflowAllDayByDay.map((count, index) => {
            const extraRoutines = Math.max(0, routinesByDay[index].length - 2);
            const total = count + extraRoutines;
            return total > 0 ? (
              <button
                key={dateKeys[index]}
                type="button"
                onClick={() => openDay(dateKeys[index])}
                className="px-1 pb-1 text-left text-[9px] font-bold text-[#2f6b4f]"
              >
                +{total}개 더보기
              </button>
            ) : (
              <div key={dateKeys[index]} />
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-[52px_repeat(7,minmax(0,1fr))] border-b border-[#e0e4de] bg-[#fbfaf5]">
        <div />
        {routinesByDay.map((routines, index) => (
          <div key={dateKeys[index]} className="space-y-1 p-1">
            {routines.slice(0, 2).map((routine) => (
              <button
                key={routine.id}
                onClick={() => openRoutine(routine.id)}
                className="block w-full truncate rounded-md border border-dashed border-[#2f6b4f]/40 bg-white/80 px-1 py-0.5 text-left text-[9px] font-black text-[#2f6b4f]"
              >
                <Repeat2 className="mr-1 inline size-3" />
                {routine.title}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <div
          className="grid grid-cols-[52px_repeat(7,minmax(0,1fr))]"
          style={{ height: `${gridHeight}px` }}
        >
          <div className="relative">
            {hours.map((hour) => (
              <div
                key={hour}
                className="absolute right-2 -translate-y-1/2 text-[10px] font-bold text-[#9aa49d]"
                style={{ top: `${(hour - WEEK_GRID_START_HOUR) * WEEK_GRID_HOUR_HEIGHT}px` }}
              >
                {hour === 0
                  ? '12AM'
                  : hour < 12
                    ? `${hour}AM`
                    : hour === 12
                      ? '12PM'
                      : `${hour - 12}PM`}
              </div>
            ))}
          </div>
          {dateKeys.map((date) => {
            const dayBlocks: TimedBlock[] = tasks
              .filter(
                (task) =>
                  task.time &&
                  task.date <= date &&
                  (task.endDate ?? task.date) >= date,
              )
              .map((task) => {
                const startMin = clamp(
                  timeToMinutes(task.time!),
                  WEEK_GRID_START_HOUR * 60,
                  WEEK_GRID_END_HOUR * 60 - 15,
                );
                const rawEndMin = task.endTime
                  ? timeToMinutes(task.endTime)
                  : timeToMinutes(task.time!) + 60;
                const endMin = clamp(
                  Math.max(rawEndMin, startMin + 15),
                  startMin + 15,
                  WEEK_GRID_END_HOUR * 60,
                );
                return { task, startMin, endMin };
              });
            const laidOut = layoutTimedBlocks(dayBlocks);
            const isToday = date === todayKey;
            return (
              <div
                key={date}
                className={`relative border-l border-[#e5e7e2] ${isToday ? 'bg-[#edf4ef]/40' : ''}`}
              >
                {hours.map((hour, index) => (
                  <div
                    key={hour}
                    className="absolute inset-x-0 border-t border-[#eceee9]"
                    style={{ top: `${index * WEEK_GRID_HOUR_HEIGHT}px` }}
                  />
                ))}
                <button
                  type="button"
                  aria-label={`${formatDate(date)} 시간대 업무 추가`}
                  onClick={(event) => {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    const slot = clamp(
                      Math.floor(
                        ((event.clientY - bounds.top) / WEEK_GRID_HOUR_HEIGHT) *
                          2,
                      ),
                      0,
                      hours.length * 2 - 1,
                    );
                    openCreateTask(
                      date,
                      minutesToTime(WEEK_GRID_START_HOUR * 60 + slot * 30),
                    );
                  }}
                  className="absolute inset-0 z-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#2f6b4f]"
                />
                {isToday &&
                  nowMinutes >= WEEK_GRID_START_HOUR * 60 &&
                  nowMinutes <= WEEK_GRID_END_HOUR * 60 && (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-30 border-t-2 border-[#dc2626]"
                      style={{
                        top: `${((nowMinutes - WEEK_GRID_START_HOUR * 60) / 60) * WEEK_GRID_HOUR_HEIGHT}px`,
                      }}
                    />
                  )}
                {laidOut.map(({ task, startMin, endMin, lane, laneCount }) => {
                  const category = data.categories.find(
                    (item) => item.id === task.categoryId,
                  );
                  const top =
                    ((startMin - WEEK_GRID_START_HOUR * 60) / 60) *
                    WEEK_GRID_HOUR_HEIGHT;
                  const height = Math.max(
                    18,
                    ((endMin - startMin) / 60) * WEEK_GRID_HOUR_HEIGHT - 2,
                  );
                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => openTask(task.id)}
                      className="absolute z-20 overflow-hidden rounded-md px-1.5 py-0.5 text-left text-[10px] font-bold leading-tight text-white shadow-sm ring-1 ring-black/10"
                      style={{
                        top: `${top}px`,
                        height: `${height}px`,
                        left: `${(lane / laneCount) * 100}%`,
                        width: `calc(${100 / laneCount}% - 2px)`,
                        background: taskBarBackground(task, category?.color),
                        textShadow: '0 1px 2px rgba(0, 0, 0, 0.35)',
                      }}
                    >
                      <span className="block truncate">
                        {task.priority === 'urgent' ? '‼[긴급] ' : ''}
                        {task.title}
                      </span>
                      <span className="block truncate text-[9px] font-normal opacity-90">
                        {formatTaskTime(task.time, task.endTime)}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DayItemsModal({
  date,
  data,
  tasks,
  close,
  openTask,
  openRoutine,
}: {
  date: string;
  data: WorkspaceState;
  tasks: Task[];
  close: () => void;
  openTask: (id: string) => void;
  openRoutine: (id: string) => void;
}) {
  const dayTasks = tasks
    .filter((task) => task.date <= date && (task.endDate ?? task.date) >= date)
    .sort(
      (a, b) =>
        taskTimeSlot(a.time) - taskTimeSlot(b.time) ||
        (a.time ?? '').localeCompare(b.time ?? ''),
    );
  const routines = data.routines.filter((routine) =>
    routineOccursOnDate(routine, date),
  );
  return (
    <ModalShell
      title={`${formatDate(date)} 전체 일정`}
      description="해당 날짜에 등록된 업무와 루틴을 모두 표시합니다."
      close={close}
    >
      <div className="max-h-[65vh] space-y-2 overflow-y-auto overscroll-contain pr-1">
        {dayTasks.map((task) => {
          const category = data.categories.find(
            (item) => item.id === task.categoryId,
          );
          return (
            <button
              key={task.id}
              type="button"
              aria-label={`일정 열기: ${task.title}`}
              className="flex w-full items-start gap-3 rounded-2xl border border-[#dfe4dc] bg-white p-3 text-left hover:bg-[#f3f6f2]"
              onClick={() => {
                close();
                openTask(task.id);
              }}
            >
              <span
                className="mt-1 size-3 shrink-0 rounded-full"
                style={{ background: category?.color ?? '#9aa49d' }}
              />
              <span className="min-w-0">
                <span className="block font-black text-[#263b2e]">
                  <TaskTitleText task={task} />
                </span>
                <span className="block text-xs text-[#718078]">
                  {formatTaskTime(task.time, task.endTime)} ·{' '}
                  {category?.name ?? '미분류'} · {statusLabel[task.status]}
                </span>
              </span>
            </button>
          );
        })}
        {routines.map((routine) => (
          <button
            key={routine.id}
            type="button"
            className="flex w-full items-start gap-3 rounded-2xl border border-dashed border-[#2f6b4f]/40 bg-white p-3 text-left hover:bg-[#f3f6f2]"
            onClick={() => {
              close();
              openRoutine(routine.id);
            }}
          >
            <Repeat2 className="mt-0.5 size-4 shrink-0 text-[#2f6b4f]" />
            <span className="font-black text-[#263b2e]">{routine.title}</span>
          </button>
        ))}
        {dayTasks.length === 0 && routines.length === 0 && (
          <p className="py-8 text-center text-sm text-[#718078]">
            등록된 일정이 없습니다.
          </p>
        )}
      </div>
    </ModalShell>
  );
}

function TasksView({
  data,
  tasks,
  statusFilter,
  setStatusFilter,
  memberFilter,
  setMemberFilter,
  openTask,
  focusLabel,
  clearFocus,
}: {
  data: WorkspaceState;
  tasks: Task[];
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  memberFilter: string;
  setMemberFilter: (value: string) => void;
  openTask: (id: string) => void;
  focusLabel: string | null;
  clearFocus: () => void;
}) {
  return (
    <section className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-4 sm:p-5">
      {focusLabel ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#e3eee7] px-4 py-3">
          <p className="text-sm font-bold text-[#245b43]">
            {focusLabel} · {tasks.length}건 보는 중
          </p>
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-lg bg-white"
            onClick={clearFocus}
          >
            전체 업무 보기
          </Button>
        </div>
      ) : (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row">
          <label className="flex items-center gap-2 text-sm font-bold">
            <ListFilter className="size-4" />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className={inputClass}
            >
              <option value="all">모든 상태</option>
              {Object.entries(statusLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <select
            aria-label="담당자 필터"
            value={memberFilter}
            onChange={(event) => setMemberFilter(event.target.value)}
            className={inputClass}
          >
            <option value="all">모든 담당자</option>
            {data.members
              .filter((member) => member.active)
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
          </select>
        </div>
      )}
      <div className="space-y-2">
        {tasks.length ? (
          [...tasks]
            .sort(
              (a, b) =>
                Number(b.priority === 'urgent') -
                  Number(a.priority === 'urgent') ||
                compareTaskSchedule(a.date, a.time, b.date, b.time),
            )
            .map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                data={data}
                openTask={openTask}
              />
            ))
        ) : (
          <Empty title="조건에 맞는 업무가 없습니다." />
        )}
      </div>
    </section>
  );
}

function RoutinesView({
  data,
  canEdit,
  openCreate,
  openRoutine,
  updateData,
}: {
  data: WorkspaceState;
  canEdit: boolean;
  openCreate: () => void;
  openRoutine: (id: string) => void;
  updateData: (
    fn: (data: WorkspaceState) => WorkspaceState,
    message?: string,
  ) => void;
}) {
  function createToday(routine: Routine) {
    const task: Task = {
      id: uid('task'),
      title: routine.title,
      description: `${routine.cadence} 루틴에서 생성된 업무입니다.`,
      date: isoDate(),
      categoryId: routine.categoryId,
      assigneeId: routine.assigneeId,
      collaborators: [],
      priority: 'normal',
      status: 'scheduled',
      type: 'routine',
      checklist: routineChecklistWithLinks(routine).map((text) => ({
        id: uid('check'),
        text,
        done: false,
      })),
      comments: [],
      createdBy: routine.assigneeId,
      createdAt: new Date().toISOString(),
    };
    updateData(
      (current) => ({ ...current, tasks: [...current.tasks, task] }),
      '오늘 업무로 생성했습니다.',
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#748078]">
          사용 중인 루틴은 다음 실행일부터 캘린더에 자동 표시됩니다.
        </p>
        {canEdit && (
          <Button onClick={openCreate}>
            <Plus />
            루틴 추가
          </Button>
        )}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {data.routines.map((routine) => {
          const category = data.categories.find(
            (item) => item.id === routine.categoryId,
          );
          const member = data.members.find(
            (item) => item.id === routine.assigneeId,
          );
          const links = routineLinks(routine);
          return (
            <article
              key={routine.id}
              className={`relative rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-5 transition hover:-translate-y-0.5 hover:border-[#adc2b4] ${!routine.active ? 'opacity-60' : ''}`}
            >
              <button
                aria-label={`${routine.title} 상세 보기`}
                onClick={() => openRoutine(routine.id)}
                className="absolute inset-0 z-0 cursor-pointer rounded-3xl focus:outline-none focus:ring-2 focus:ring-[#2f6b4f]"
              />
              <div className="pointer-events-none relative z-10">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <CategoryDot category={category} />
                      <span className="text-xs font-bold text-[#748078]">
                        {category?.name}
                      </span>
                    </div>
                    <h3 className="font-black">{routine.title}</h3>
                    <p className="mt-1 text-sm text-[#748078]">
                      {routine.cadence} · {member?.name}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-[10px] font-black ${routine.active ? 'bg-[#e3eee7] text-[#2f6b4f]' : 'bg-[#ecebe6] text-[#7b847e]'}`}
                  >
                    {routine.active ? '사용 중' : '중단됨'}
                  </span>
                </div>
                <div className="mt-4 rounded-xl bg-[#f1f2ed] p-3">
                  <p className="text-xs font-bold text-[#748078]">
                    체크리스트 {routine.checklist.length}개 · 링크{' '}
                    {links.length}개 · 다음 {formatDate(routine.nextDate)}
                  </p>
                </div>
                {canEdit && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="pointer-events-auto"
                      onClick={() => createToday(routine)}
                    >
                      <Play />
                      오늘 실행
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="pointer-events-auto"
                      onClick={() =>
                        updateData(
                          (current) => ({
                            ...current,
                            routines: current.routines.map((item) =>
                              item.id === routine.id
                                ? { ...item, active: !item.active }
                                : item,
                            ),
                          }),
                          routine.active
                            ? '루틴을 중단했습니다. 과거 이력은 유지됩니다.'
                            : '루틴을 다시 시작했습니다.',
                        )
                      }
                    >
                      {routine.active ? <Pause /> : <Play />}
                      {routine.active ? '중단' : '재시작'}
                    </Button>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function NotesView({
  data,
  canEdit,
  isAdmin,
  openCreate,
  openTask,
  updateData,
  actor,
  markDeleted,
}: {
  data: WorkspaceState;
  canEdit: boolean;
  isAdmin: boolean;
  openCreate: () => void;
  openTask: (id: string) => void;
  updateData: (
    fn: (data: WorkspaceState) => WorkspaceState,
    message?: string,
  ) => void;
  actor: Member;
  markDeleted: (id: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [editingNote, setEditingNote] = useState<SpecialNote | null>(null);
  const [viewingNote, setViewingNote] = useState<SpecialNote | null>(null);
  const activeNotes = [...data.notes]
    .filter((note) => !note.completed)
    .sort(
      (a, b) =>
        Number(b.urgent) - Number(a.urgent) ||
        b.date.localeCompare(a.date) ||
        a.label.localeCompare(b.label),
    );
  const archivedNotes = [...data.notes]
    .filter((note) => note.completed)
    .sort((a, b) =>
      (b.completedAt ?? b.createdAt).localeCompare(
        a.completedAt ?? a.createdAt,
      ),
    );
  function convert(note: SpecialNote) {
    if (note.convertedTaskId) return openTask(note.convertedTaskId);
    const task: Task = {
      id: uid('task'),
      title: note.body.slice(0, 40),
      description: `${note.label}\n위치: ${note.location}\n${note.body}`,
      date: note.date,
      categoryId: note.categoryId,
      assigneeId: defaultAssigneeId(data, actor),
      collaborators: [],
      priority: note.urgent ? 'urgent' : 'normal',
      status: 'scheduled',
      type: 'issue',
      checklist: [],
      comments: [],
      sourceNoteId: note.id,
      createdBy: actor.id,
      createdAt: new Date().toISOString(),
    };
    updateData(
      (current) => ({
        ...current,
        tasks: [...current.tasks, task],
        notes: current.notes.map((item) =>
          item.id === note.id ? { ...item, convertedTaskId: task.id } : item,
        ),
      }),
      '특이사항을 정식 업무로 전환했습니다.',
    );
  }
  function toggleNote(note: SpecialNote) {
    if (!isAdmin) return;
    const completed = !note.completed;
    updateData(
      (current) => ({
        ...current,
        notes: current.notes.map((item) =>
          item.id === note.id
            ? {
                ...item,
                completed,
                completedAt: completed ? new Date().toISOString() : undefined,
              }
            : item,
        ),
      }),
      completed
        ? '특이사항을 완료 보관함으로 이동했습니다.'
        : '특이사항을 진행 목록으로 복원했습니다.',
    );
  }
  function addComment(noteId: string) {
    if (!comment.trim()) return;
    const nextComment: Comment = {
      id: uid('comment'),
      authorId: actor.id,
      body: comment.trim(),
      createdAt: new Date().toISOString(),
    };
    updateData(
      (current) => ({
        ...current,
        notes: current.notes.map((note) =>
          note.id === noteId
            ? { ...note, comments: [...(note.comments ?? []), nextComment] }
            : note,
        ),
      }),
      '피드백을 등록했습니다.',
    );
    setComment('');
  }
  function editNote(note: SpecialNote) {
    if (!isAdmin) return;
    setEditingNote(note);
  }
  function saveNote(next: SpecialNote) {
    updateData(
      (current) => ({
        ...current,
        notes: current.notes.map((item) => (item.id === next.id ? next : item)),
      }),
      '특이사항을 수정했습니다.',
    );
  }
  function deleteNote(note: SpecialNote) {
    if (!isAdmin || !window.confirm('이 특이사항과 댓글을 삭제할까요?')) return;
    markDeleted(note.id);
    updateData(
      (current) => ({
        ...current,
        notes: current.notes.filter((item) => item.id !== note.id),
      }),
      '특이사항을 삭제했습니다.',
    );
  }
  function NoteCard({
    note,
    archived = false,
  }: {
    note: SpecialNote;
    archived?: boolean;
  }) {
    const category = data.categories.find(
      (item) => item.id === note.categoryId,
    );
    const author = data.members.find((member) => member.id === note.createdBy);
    const comments = note.comments ?? [];
    const expanded = expandedId === note.id;
    return (
      <article
        className={`rounded-3xl border bg-[#fbfaf5] p-5 ${note.urgent && !archived ? 'border-[#e3b5ae]' : 'border-[#d8ded4]'} ${archived ? 'opacity-70' : ''}`}
      >
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <input
              aria-label={`${note.label} 완료`}
              type="checkbox"
              checked={Boolean(note.completed)}
              disabled={!isAdmin}
              readOnly
              onClick={() => toggleNote(note)}
              className="mt-1 size-5 shrink-0 accent-[#2f6b4f]"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[#f0c85a] px-2 py-1 text-[10px] font-black">
                  {note.label}
                </span>
                {note.urgent && (
                  <span className="rounded-full bg-[#fae0dc] px-2 py-1 text-[10px] font-black text-[#9b453c]">
                    긴급
                  </span>
                )}
                <span className="flex items-center gap-1 text-xs font-bold text-[#748078]">
                  <CategoryDot category={category} />
                  {category?.name}
                </span>
              </div>
              <h3
                className={`mt-3 line-clamp-4 font-black whitespace-pre-wrap ${archived ? 'line-through' : ''}`}
              >
                {note.body}
              </h3>
              {(note.body.length > 160 || note.body.split('\n').length > 4) && (
                <button
                  type="button"
                  onClick={() => setViewingNote(note)}
                  className="mt-1 text-xs font-bold text-[#2f6b4f]"
                >
                  전체보기
                </button>
              )}
              <p className="mt-2 text-sm text-[#748078]">
                {formatDate(note.date)} · {note.location} · {author?.name}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => editNote(note)}
                >
                  <Pencil />
                  수정
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => deleteNote(note)}
                >
                  <Trash2 />
                  삭제
                </Button>
              </>
            )}
            {isAdmin && !archived && (
              <Button size="sm" variant="outline" onClick={() => convert(note)}>
                {note.convertedTaskId ? <FileText /> : <RefreshCw />}
                {note.convertedTaskId ? '업무 보기' : '업무 전환'}
              </Button>
            )}
          </div>
        </div>
        <div className="mt-4 border-t border-[#e0e3de] pt-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setExpandedId(expanded ? null : note.id);
              setComment('');
            }}
          >
            <MessageCircle />
            피드백 {comments.length}
          </Button>
          {expanded && (
            <div className="mt-3 space-y-2">
              {comments.map((item) => {
                const writer = data.members.find(
                  (member) => member.id === item.authorId,
                );
                return (
                  <div key={item.id} className="rounded-xl bg-[#f1f2ed] p-3">
                    <div className="flex justify-between gap-2 text-xs">
                      <strong>{writer?.name ?? '사용자'}</strong>
                      <span className="text-[#859088]">
                        {new Date(item.createdAt).toLocaleString('ko-KR')}
                      </span>
                    </div>
                    <div className="mt-1 flex items-start justify-between gap-2">
                      <p className="text-sm">{item.body}</p>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() =>
                            updateData(
                              (current) => ({
                                ...current,
                                notes: current.notes.map((entry) =>
                                  entry.id === note.id
                                    ? {
                                        ...entry,
                                        comments: (entry.comments ?? []).filter(
                                          (comment) => comment.id !== item.id,
                                        ),
                                      }
                                    : entry,
                                ),
                              }),
                              '피드백을 삭제했습니다.',
                            )
                          }
                          className="text-xs font-bold text-[#a83f36]"
                        >
                          삭제
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  addComment(note.id);
                }}
                className="flex gap-2"
              >
                <input
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  className={inputClass}
                  placeholder="피드백을 남겨주세요."
                />
                <Button type="submit" aria-label="피드백 등록">
                  <MessageCircle />
                </Button>
              </form>
            </div>
          )}
        </div>
      </article>
    );
  }
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#748078]">
          항목의 피드백 버튼을 눌러 댓글을 남길 수 있습니다.
        </p>
        {canEdit && (
          <Button onClick={openCreate}>
            <Plus />
            특이사항 등록
          </Button>
        )}
      </div>
      <section>
        <h3 className="mb-3 font-black">
          진행 중 특이사항 {activeNotes.length}
        </h3>
        <div className="space-y-3">
          {activeNotes.length ? (
            activeNotes.map((note) => <NoteCard key={note.id} note={note} />)
          ) : (
            <Empty title="진행 중인 특이사항이 없습니다." />
          )}
        </div>
      </section>
      <section className="rounded-3xl border border-[#d8ded4] bg-[#efeee8] p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="font-black">완료 보관함</h3>
            <p className="text-xs text-[#748078]">
              완료된 특이사항과 피드백 기록을 확인합니다.
            </p>
          </div>
          <span className="rounded-full bg-white px-2 py-1 text-xs font-black">
            {archivedNotes.length}건
          </span>
        </div>
        <div className="max-h-[34rem] space-y-3 overflow-y-auto pr-1">
          {archivedNotes.length ? (
            archivedNotes.map((note) => (
              <NoteCard key={note.id} note={note} archived />
            ))
          ) : (
            <Empty title="보관된 특이사항이 없습니다." />
          )}
        </div>
      </section>
      {editingNote && (
        <EditNoteForm
          data={data}
          note={editingNote}
          close={() => setEditingNote(null)}
          save={saveNote}
        />
      )}
      {viewingNote && (
        <ModalShell
          title={viewingNote.label}
          description={`${formatDate(viewingNote.date)} · ${viewingNote.location} · ${data.categories.find((item) => item.id === viewingNote.categoryId)?.name ?? ''}`}
          close={() => setViewingNote(null)}
        >
          <p className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap text-sm leading-6">
            {viewingNote.body}
          </p>
        </ModalShell>
      )}
    </div>
  );
}

function TeamView({
  data,
  openTask,
}: {
  data: WorkspaceState;
  openTask: (id: string) => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      {data.members
        .filter((member) => member.active)
        .map((member) => {
          const assigned = data.tasks.filter(
            (task) =>
              (task.assigneeId === member.id ||
                task.collaborators.includes(member.id)) &&
              task.status !== 'completed',
          );
          const requests = assigned.filter(
            (task) => task.status === 'completion_requested',
          );
          return (
            <article
              key={member.id}
              className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-5"
            >
              <div className="flex items-center gap-3">
                <span className="grid size-11 place-items-center rounded-full bg-[#e3eee7] font-black text-[#2f6b4f]">
                  {member.name.slice(0, 1)}
                </span>
                <div>
                  <h3 className="font-black">{member.name}</h3>
                  <p className="text-xs text-[#748078]">
                    {member.team} · {roleLabel(member)}
                  </p>
                </div>
              </div>
              <div className="my-4 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-[#f1f2ed] p-3">
                  <strong className="text-xl">{assigned.length}</strong>
                  <p className="text-xs text-[#748078]">진행 업무</p>
                </div>
                <div className="rounded-xl bg-[#fff1dd] p-3">
                  <strong className="text-xl">{requests.length}</strong>
                  <p className="text-xs text-[#806743]">완료 요청</p>
                </div>
              </div>
              <div className="space-y-2">
                {assigned.slice(0, 3).map((task) => (
                  <button
                    key={task.id}
                    onClick={() => openTask(task.id)}
                    className="block w-full truncate rounded-lg border border-[#e0e3de] bg-white px-3 py-2 text-left text-xs font-bold hover:border-[#adc2b4]"
                  >
                    {task.title}
                  </button>
                ))}
              </div>
            </article>
          );
        })}
    </div>
  );
}

function groupNewsByCategory(items: NewsItem[]) {
  const groups = new Map<string, NewsItem[]>();
  for (const item of items) {
    const list = groups.get(item.category) ?? [];
    list.push(item);
    groups.set(item.category, list);
  }
  return [...groups.entries()]
    .map(([category, categoryItems]) => ({
      category,
      items: categoryItems.sort((a, b) =>
        b.collectedAt.localeCompare(a.collectedAt),
      ),
    }))
    .sort((a, b) => b.items.length - a.items.length);
}

function NewsView({
  news,
  isAdmin,
  onImport,
  onEdit,
  onDelete,
}: {
  news: NewsItem[];
  isAdmin: boolean;
  onImport: (files: FileList | null) => void;
  onEdit: (item: NewsItem) => void;
  onDelete: (item: NewsItem) => void;
}) {
  const recent = news.filter((item) => {
    const age = dayDifference(item.collectedAt, isoDate());
    return age >= 0 && age <= 2;
  });
  const groups = groupNewsByCategory(recent);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[#748078]">
          최근 3일 이내 {groups.length}개 카테고리에서 {recent.length}건
        </p>
        {isAdmin && (
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-[#2f6b4f] px-4 text-sm font-bold text-white">
            <FileText className="size-4" />
            문서 가져오기
            <input
              type="file"
              accept=".md,.txt,text/markdown,text/plain"
              multiple
              className="sr-only"
              onChange={(event) => onImport(event.target.files)}
            />
          </label>
        )}
      </div>
      {groups.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {groups.map((group, groupIndex) => (
            <section
              key={group.category}
              className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-4 [contain-intrinsic-size:auto_240px] [content-visibility:auto]"
            >
              <h3 className="mb-2 flex items-center gap-2 font-black">
                <Newspaper className="size-4 shrink-0 text-[#6f7b73]" />
                <span className="truncate">
                  {groupIndex + 1}. {group.category}
                </span>
                <span className="shrink-0 text-xs font-normal text-[#748078]">
                  {group.items.length}건
                </span>
              </h3>
              <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                {group.items.map((item, itemIndex) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-sm">
                      {itemIndex + 1}) {item.title}
                    </span>
                    <div className="flex shrink-0 items-center gap-2 text-xs">
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-bold text-[#2f6b4f]"
                        >
                          원문가기
                        </a>
                      )}
                      {isAdmin && (
                        <>
                          <button
                            onClick={() => onEdit(item)}
                            aria-label={`${item.title} 수정`}
                            className="text-[#2f6b4f]"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            onClick={() => onDelete(item)}
                            aria-label={`${item.title} 삭제`}
                            className="text-[#a83f36]"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Empty title="최근 3일 이내 관광뉴스가 없습니다." />
      )}
    </div>
  );
}

function LegacySettingsView({
  data,
  isAdmin,
  pendingRegistrations,
  openMember,
  refreshPendingRegistrations,
  approveRegistration,
  updateData,
}: {
  data: WorkspaceState;
  isAdmin: boolean;
  pendingRegistrations: RegistrationRequest[];
  openMember: () => void;
  refreshPendingRegistrations: () => Promise<void>;
  approveRegistration: (
    id: string,
    role: Exclude<Role, 'admin'>,
    team: string,
  ) => Promise<void>;
  updateData: (
    fn: (data: WorkspaceState) => WorkspaceState,
    message?: string,
  ) => void;
}) {
  function addCategory() {
    const name = window.prompt('새 업무 분류 이름을 입력하세요.');
    if (!name) return;
    updateData(
      (current) => ({
        ...current,
        categories: [
          ...current.categories,
          { id: uid('category'), name, color: '#5f7f70', active: true },
        ],
      }),
      '업무 분류를 추가했습니다.',
    );
  }
  function retire(member: Member) {
    if (member.role === 'admin') return;
    const admin = data.members.find(
      (item) => item.role === 'admin' && item.active,
    );
    if (
      !admin ||
      !window.confirm(
        `${member.name} 계정을 비활성화하고 미완료 업무를 ${admin.name}님에게 인계할까요?`,
      )
    )
      return;
    updateData(
      (current) => ({
        ...current,
        members: current.members.map((item) =>
          item.id === member.id ? { ...item, active: false } : item,
        ),
        tasks: current.tasks.map((task) => {
          const collaborators = task.collaborators.filter(
            (id) => id !== member.id,
          );
          if (task.assigneeId === member.id && task.status !== 'completed') {
            return { ...task, assigneeId: admin.id, collaborators };
          }
          return collaborators.length === task.collaborators.length
            ? task
            : { ...task, collaborators };
        }),
        routines: current.routines.map((routine) =>
          routine.assigneeId === member.id
            ? { ...routine, assigneeId: admin.id }
            : routine,
        ),
      }),
      '계정을 비활성화하고 미완료 업무를 인계했습니다.',
    );
  }
  return (
    <div className="space-y-5">
      {isAdmin && (
        <section className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-5">
          <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black">가입 승인 대기</h3>
                <span className="rounded-full bg-[#fff1dd] px-2 py-0.5 text-xs font-black text-[#806743]">
                  {pendingRegistrations.length}
                </span>
              </div>
              <p className="mt-1 text-xs text-[#748078]">
                권한과 소속을 확인한 뒤 승인해 주세요.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => void refreshPendingRegistrations()}
            >
              <RefreshCw />
              새로고침
            </Button>
          </div>
          <div className="space-y-3">
            {pendingRegistrations.length ? (
              pendingRegistrations.map((registration) => (
                <PendingRegistrationCard
                  key={registration.id}
                  registration={registration}
                  approveRegistration={approveRegistration}
                />
              ))
            ) : (
              <Empty title="승인을 기다리는 가입 신청이 없습니다." />
            )}
          </div>
        </section>
      )}
      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="font-black">사용자와 권한</h3>
              <p className="text-xs text-[#748078]">
                최종 완료 권한은 관리자만 가집니다.
              </p>
            </div>
            {isAdmin && (
              <Button variant="outline" onClick={openMember}>
                <UserPlus />
                추가
              </Button>
            )}
          </div>
          <div className="space-y-2">
            {data.members.map((member) => (
              <div
                key={member.id}
                className={`flex items-center gap-3 rounded-xl border border-[#e0e3de] bg-white p-3 ${!member.active ? 'opacity-50' : ''}`}
              >
                <span className="grid size-9 place-items-center rounded-full bg-[#e3eee7] text-sm font-black text-[#2f6b4f]">
                  {member.name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm">
                    {member.name}
                  </strong>
                  <span className="block truncate text-xs text-[#748078]">
                    {member.email} · {roleLabel(member)}
                  </span>
                </span>
                {member.active && member.role !== 'admin' && isAdmin && (
                  <Button
                    aria-label={`${member.name} 퇴사 처리`}
                    size="sm"
                    variant="outline"
                    onClick={() => retire(member)}
                  >
                    <LogOut />
                    퇴사 처리
                  </Button>
                )}
                {!member.active && (
                  <span className="text-xs font-bold">비활성</span>
                )}
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="font-black">업무 분류</h3>
              <p className="text-xs text-[#748078]">
                분류를 중단해도 과거 기록은 유지됩니다.
              </p>
            </div>
            {isAdmin && (
              <Button variant="outline" onClick={addCategory}>
                <Plus />
                추가
              </Button>
            )}
          </div>
          <div className="space-y-2">
            {data.categories.map((category) => (
              <div
                key={category.id}
                className={`flex items-center gap-3 rounded-xl border border-[#e0e3de] bg-white p-3 ${!category.active ? 'opacity-50' : ''}`}
              >
                <CategoryDot category={category} />
                <strong className="flex-1 text-sm">{category.name}</strong>
                {isAdmin && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      updateData(
                        (current) => ({
                          ...current,
                          categories: current.categories.map((item) =>
                            item.id === category.id
                              ? { ...item, active: !item.active }
                              : item,
                          ),
                        }),
                        category.active
                          ? '분류를 비활성화했습니다.'
                          : '분류를 활성화했습니다.',
                      )
                    }
                  >
                    {category.active ? <Pause /> : <Play />}
                    {category.active ? '중단' : '복원'}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value: unknown) {
  const text = cellText(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function cellText(value: unknown): string {
  if (value instanceof Date) return isoDate(value);
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const item = value as {
      result?: unknown;
      text?: unknown;
      richText?: { text: string }[];
    };
    if (item.result !== undefined) return cellText(item.result);
    if (typeof item.text === 'string') return item.text;
    if (item.richText) return item.richText.map((part) => part.text).join('');
  }
  if (typeof value === 'string') return value.trim();
  if (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  if (typeof value === 'symbol') return value.description ?? '';
  if (typeof value === 'function') return value.name;
  return '';
}

function SettingsView({
  data,
  actor,
  isAdmin,
  pendingRegistrations,
  openMember,
  refreshPendingRegistrations,
  approveRegistration,
  updateData,
}: {
  data: WorkspaceState;
  actor: Member;
  isAdmin: boolean;
  pendingRegistrations: RegistrationRequest[];
  openMember: () => void;
  refreshPendingRegistrations: () => Promise<void>;
  approveRegistration: (
    id: string,
    role: Exclude<Role, 'admin'>,
    team: string,
  ) => Promise<void>;
  updateData: (
    fn: (data: WorkspaceState) => WorkspaceState,
    message?: string,
  ) => void;
}) {
  return (
    <div className="space-y-5">
      <DataTransferPanel
        data={data}
        actor={actor}
        isAdmin={isAdmin}
        updateData={updateData}
      />
      {isAdmin && <AdminMasterEditPanel data={data} updateData={updateData} />}
      <LegacySettingsView
        data={data}
        isAdmin={isAdmin}
        pendingRegistrations={pendingRegistrations}
        openMember={openMember}
        refreshPendingRegistrations={refreshPendingRegistrations}
        approveRegistration={approveRegistration}
        updateData={updateData}
      />
    </div>
  );
}

function AdminMasterEditPanel({
  data,
  updateData,
}: {
  data: WorkspaceState;
  updateData: (
    fn: (data: WorkspaceState) => WorkspaceState,
    message?: string,
  ) => void;
}) {
  function editMember(member: Member) {
    const name = window.prompt('이름', member.name);
    if (name === null || !name.trim()) return;
    const team = window.prompt('소속', member.team);
    if (team === null || !team.trim()) return;
    const roleText = window.prompt(
      '권한: admin / member / commenter',
      member.role,
    );
    if (
      roleText === null ||
      !['admin', 'member', 'commenter'].includes(roleText)
    )
      return;
    updateData(
      (current) => ({
        ...current,
        members: current.members.map((item) =>
          item.id === member.id
            ? {
                ...item,
                name: name.trim(),
                team: team.trim(),
                role: roleText as Role,
              }
            : item,
        ),
      }),
      '사용자 정보를 수정했습니다.',
    );
  }
  function editCategory(category: Category) {
    const name = window.prompt('분류 이름', category.name);
    if (name === null || !name.trim()) return;
    updateData(
      (current) => ({
        ...current,
        categories: current.categories.map((item) =>
          item.id === category.id ? { ...item, name: name.trim() } : item,
        ),
      }),
      '업무 분류를 수정했습니다.',
    );
  }
  return (
    <section className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-5">
      <div className="mb-4">
        <h3 className="font-black">관리자 전체 수정</h3>
        <p className="mt-1 text-xs text-[#748078]">
          사용자·소속·권한과 분류 이름·색상을 수정할 수 있습니다. 업무, 루틴,
          특이사항, 뉴스는 각 화면에서 수정합니다.
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-2">
          {data.members.map((member) => (
            <div
              key={member.id}
              className="flex items-center gap-2 rounded-xl bg-[#f1f2ed] p-3"
            >
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-sm">
                  {member.name}
                </strong>
                <span className="text-xs text-[#748078]">
                  {member.team} · {roleLabel(member)}
                </span>
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => editMember(member)}
              >
                <Pencil />
                수정
              </Button>
            </div>
          ))}
        </div>
        <div className="space-y-2">
          {data.categories.map((category) => (
            <div
              key={category.id}
              className="flex items-center gap-2 rounded-xl bg-[#f1f2ed] p-3"
            >
              <label
                title={`${category.name} 색상 변경`}
                className="relative flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full transition hover:bg-[#e1e5dd] focus-within:ring-2 focus-within:ring-[#2f6b4f]/40"
              >
                <input
                  type="color"
                  aria-label={`${category.name} 색상 선택`}
                  value={category.color}
                  onChange={(event) => {
                    const color = event.target.value;
                    updateData(
                      (current) => ({
                        ...current,
                        categories: current.categories.map((item) =>
                          item.id === category.id ? { ...item, color } : item,
                        ),
                      }),
                      '업무 분류 색상을 변경했습니다.',
                    );
                  }}
                  className="absolute inset-0 size-full cursor-pointer opacity-0"
                />
                <CategoryDot category={category} />
              </label>
              <strong className="min-w-0 flex-1 truncate text-sm">
                {category.name}
              </strong>
              <Button
                size="sm"
                variant="outline"
                onClick={() => editCategory(category)}
              >
                <Pencil />
                수정
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DataTransferPanel({
  data,
  actor,
  isAdmin,
  updateData,
}: {
  data: WorkspaceState;
  actor: Member;
  isAdmin: boolean;
  updateData: (
    fn: (data: WorkspaceState) => WorkspaceState,
    message?: string,
  ) => void;
}) {
  const [from, setFrom] = useState(() => shiftIsoDate(isoDate(), -30));
  const [to, setTo] = useState(isoDate());
  const [busy, setBusy] = useState(false);

  function exportCsv() {
    if (from > to) {
      window.alert('시작일은 종료일보다 빠르거나 같아야 합니다.');
      return;
    }
    const rows: (string | number)[][] = [
      [
        '기록 유형',
        '제목/내용',
        '시작일',
        '종료일',
        '분류',
        '담당자',
        '상태',
        '우선순위',
        '체크리스트 완료',
        '체크리스트 전체',
        '생성일',
      ],
    ];
    data.tasks
      .filter((task) => task.date <= to && (task.endDate ?? task.date) >= from)
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach((task) => {
        rows.push([
          '업무',
          task.title,
          task.date,
          task.endDate ?? task.date,
          data.categories.find((item) => item.id === task.categoryId)?.name ??
            '',
          assigneeNames(task, data).join(', '),
          statusLabel[task.status],
          priorityLabel[task.priority],
          task.checklist.filter((item) => item.done).length,
          task.checklist.length,
          task.createdAt,
        ]);
      });
    data.notes
      .filter((note) => note.date >= from && note.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach((note) => {
        rows.push([
          '특이사항',
          note.body,
          note.date,
          note.date,
          data.categories.find((item) => item.id === note.categoryId)?.name ??
            '',
          data.members.find((item) => item.id === note.createdBy)?.name ?? '',
          note.completed ? '완료' : '진행 중',
          note.urgent ? '긴급' : '보통',
          '',
          '',
          note.createdAt,
        ]);
      });
    const csv =
      '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    downloadBlob(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
      `업무기록_${from}_${to}.csv`,
    );
  }

  async function downloadTemplate() {
    setBusy(true);
    try {
      const { default: ExcelJS } = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('업무업로드');
      sheet.columns = [
        { header: '구분', key: 'kind', width: 12 },
        { header: '제목', key: 'title', width: 32 },
        { header: '시작일', key: 'date', width: 14 },
        { header: '종료일', key: 'endDate', width: 14 },
        { header: '담당자', key: 'assignee', width: 18 },
        { header: '분류', key: 'category', width: 18 },
        { header: '우선순위', key: 'priority', width: 14 },
        { header: '상태', key: 'status', width: 16 },
        { header: '설명', key: 'description', width: 42 },
        { header: '반복주기', key: 'cadence', width: 20 },
        { header: '다음실행일', key: 'nextDate', width: 14 },
        { header: '체크리스트(|로 구분)', key: 'checklist', width: 42 },
        { header: '참고링크(제목|URL|위치;로 구분)', key: 'links', width: 50 },
      ];
      sheet.addRow({
        kind: '업무',
        title: '예시 업무',
        date: isoDate(),
        endDate: isoDate(),
        assignee: actor.name,
        category: data.categories[0]?.name ?? '일반',
        priority: '보통',
        status: '예정',
        description: '필요하면 예시 행을 삭제하세요.',
        checklist: '첫 번째 확인|두 번째 확인',
      });
      const lists = workbook.addWorksheet('선택목록');
      ['구분', '업무', '루틴'].forEach(
        (value, index) => (lists.getCell(index + 1, 1).value = value),
      );
      ['우선순위', '긴급', '보통', '낮음'].forEach(
        (value, index) => (lists.getCell(index + 1, 2).value = value),
      );
      ['상태', '예정', '진행 중', '완료 요청', '최종 완료'].forEach(
        (value, index) => (lists.getCell(index + 1, 3).value = value),
      );
      [
        '담당자',
        ...data.members
          .filter((member) => member.active && member.role !== 'commenter')
          .map((member) => member.name),
      ].forEach((value, index) => (lists.getCell(index + 1, 4).value = value));
      [
        '분류',
        ...data.categories
          .filter((category) => category.active)
          .map((category) => category.name),
      ].forEach((value, index) => (lists.getCell(index + 1, 5).value = value));
      lists.state = 'veryHidden';
      for (let row = 2; row <= 501; row++) {
        sheet.getCell(row, 1).dataValidation = {
          type: 'list',
          allowBlank: false,
          formulae: [`'선택목록'!$A$2:$A$3`],
        };
        sheet.getCell(row, 5).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [
            `'선택목록'!$D$2:$D$${Math.max(2, data.members.filter((member) => member.active && member.role !== 'commenter').length + 1)}`,
          ],
        };
        sheet.getCell(row, 6).dataValidation = {
          type: 'list',
          allowBlank: true,
          showErrorMessage: false,
          formulae: [
            `'선택목록'!$E$2:$E$${Math.max(2, data.categories.filter((category) => category.active).length + 1)}`,
          ],
        };
        sheet.getCell(row, 7).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`'선택목록'!$B$2:$B$4`],
        };
        sheet.getCell(row, 8).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`'선택목록'!$C$2:$C$5`],
        };
      }
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF2F6B4F' },
      };
      const buffer = await workbook.xlsx.writeBuffer();
      downloadBlob(
        new Blob([new Uint8Array(buffer)], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        '스누피가든_대량등록_양식.xlsx',
      );
    } finally {
      setBusy(false);
    }
  }

  async function importWorkbook(file: File) {
    setBusy(true);
    try {
      const { default: ExcelJS } = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(
        new Uint8Array(await file.arrayBuffer()) as never,
      );
      const sheet =
        workbook.getWorksheet('업무업로드') ?? workbook.worksheets[0];
      if (!sheet) throw new Error('읽을 시트가 없습니다.');
      const headers = new Map<string, number>();
      sheet
        .getRow(1)
        .eachCell((cell, column) => headers.set(cellText(cell.value), column));
      const required = ['구분', '제목'];
      if (required.some((header) => !headers.has(header)))
        throw new Error('구분과 제목 컬럼이 필요합니다.');
      const rows: { [key: string]: string }[] = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const item: Record<string, string> = {};
        headers.forEach((column, header) => {
          item[header] = cellText(row.getCell(column).value);
        });
        if (item['제목']) rows.push(item);
      });
      if (!rows.length) throw new Error('등록할 행이 없습니다.');
      updateData((current) => {
        const categories = [...current.categories];
        const createdCategories: Category[] = [];
        const categoryId = (name: string) => {
          const normalized = name.trim() || '일반';
          const existing = [...categories, ...createdCategories].find(
            (item) => item.name === normalized,
          );
          if (existing) return existing.id;
          const created = {
            id: uid('category'),
            name: normalized,
            color: ['#6d8f7c', '#d3a94c', '#7391ad', '#b8756c'][
              createdCategories.length % 4
            ],
            active: true,
          };
          createdCategories.push(created);
          return created.id;
        };
        const memberId = (value: string) =>
          current.members.find(
            (member) =>
              member.name === value ||
              member.email.toLowerCase() === value.toLowerCase(),
          )?.id ?? defaultAssigneeId(current, actor);
        const priority = (value: string): Task['priority'] =>
          value === '긴급' ? 'urgent' : value === '낮음' ? 'low' : 'normal';
        const status = (value: string): Task['status'] =>
          value === '진행 중'
            ? 'in_progress'
            : value === '완료 요청'
              ? 'completion_requested'
              : value === '최종 완료'
                ? 'completed'
                : 'scheduled';
        const tasks: Task[] = [];
        const routines: Routine[] = [];
        for (const row of rows) {
          const checklist = (row['체크리스트(|로 구분)'] ?? '')
            .split('|')
            .map((item) => item.trim())
            .filter(Boolean);
          if (row['구분'] === '루틴') {
            const links = (row['참고링크(제목|URL|위치;로 구분)'] ?? '')
              .split(';')
              .map((entry) => entry.trim())
              .filter(Boolean)
              .flatMap((entry) => {
                const [title, url, position] = entry
                  .split('|')
                  .map((value) => value.trim());
                return title && url
                  ? [
                      {
                        id: uid('link'),
                        title,
                        url: normalizeUrl(url),
                        afterChecklistIndex: Math.min(
                          Number(position) || checklist.length,
                          checklist.length,
                        ),
                      },
                    ]
                  : [];
              });
            routines.push({
              id: uid('routine'),
              title: row['제목'],
              categoryId: categoryId(row['분류'] ?? ''),
              assigneeId: memberId(row['담당자'] ?? ''),
              cadence: row['반복주기'] || '매주',
              checklist,
              checklistDone: checklist.map(() => false),
              referenceLinks: links,
              active: true,
              nextDate: row['다음실행일'] || row['시작일'] || isoDate(),
            });
          } else {
            const start = row['시작일'] || isoDate();
            const end = row['종료일'] || undefined;
            tasks.push({
              id: uid('task'),
              title: row['제목'],
              description: row['설명'] ?? '',
              date: start,
              endDate: end && end >= start ? end : undefined,
              categoryId: categoryId(row['분류'] ?? ''),
              assigneeId: memberId(row['담당자'] ?? ''),
              collaborators: [],
              priority: priority(row['우선순위']),
              status: status(row['상태']),
              type: 'task',
              checklist: checklist.map((text) => ({
                id: uid('check'),
                text,
                done: false,
              })),
              comments: [],
              createdBy: actor.id,
              createdAt: new Date().toISOString(),
            });
          }
        }
        return {
          ...current,
          categories: [...categories, ...createdCategories],
          tasks: [...current.tasks, ...tasks],
          routines: [...current.routines, ...routines],
        };
      }, `${rows.length}개의 업무·루틴을 대량 등록했습니다.`);
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : '엑셀 파일을 읽지 못했습니다.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-5">
      <div className="mb-4">
        <h3 className="font-black">업무 기록 내보내기 · 대량 등록</h3>
        <p className="mt-1 text-xs leading-5 text-[#748078]">
          기간별 기록은 CSV로 내려받고, 관리자는 드롭다운이 포함된 엑셀 양식으로
          업무와 루틴을 한 번에 등록할 수 있습니다. 양식에 없는 분류명은 새
          분류로 자동 생성됩니다.
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl bg-[#f1f2ed] p-4">
          <h4 className="text-sm font-black">기간별 CSV</h4>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input
              aria-label="내보내기 시작일"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className={inputClass}
            />
            <input
              aria-label="내보내기 종료일"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className={inputClass}
            />
            <Button onClick={exportCsv}>
              <Download />
              CSV 받기
            </Button>
          </div>
        </div>
        {isAdmin && (
          <div className="rounded-2xl bg-[#f1f2ed] p-4">
            <h4 className="text-sm font-black">엑셀 대량 등록</h4>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void downloadTemplate()}
              >
                <FileSpreadsheet />
                양식 받기
              </Button>
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-[#2f6b4f] px-4 text-sm font-bold text-white">
                <Upload className="size-4" />
                작성 파일 올리기
                <input
                  type="file"
                  accept=".xlsx"
                  className="sr-only"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file)
                      void importWorkbook(file).catch((error) =>
                        window.alert(
                          error instanceof Error
                            ? error.message
                            : '엑셀 파일을 읽지 못했습니다.',
                        ),
                      );
                    event.currentTarget.value = '';
                  }}
                />
              </label>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function PendingRegistrationCard({
  registration,
  approveRegistration,
}: {
  registration: RegistrationRequest;
  approveRegistration: (
    id: string,
    role: Exclude<Role, 'admin'>,
    team: string,
  ) => Promise<void>;
}) {
  const [role, setRole] = useState<Exclude<Role, 'admin'>>('member');
  const [team, setTeam] = useState('파크사업팀');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormSubmitEvent) {
    event.preventDefault();
    if (!team.trim()) return;
    setBusy(true);
    setError('');
    try {
      await approveRegistration(registration.id, role, team.trim());
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : '가입 승인을 완료하지 못했습니다.',
      );
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-[#e0e3de] bg-white p-4"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#fff1dd] font-black text-[#806743]">
          {registration.name.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-sm">{registration.name}</strong>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-black ${registration.emailConfirmed ? 'bg-[#e7f0eb] text-[#2f6b4f]' : 'bg-[#f1f0eb] text-[#6a776e]'}`}
            >
              {registration.emailConfirmed
                ? '이메일 인증됨'
                : '승인 시 이메일 인증'}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-[#748078]">
            {registration.email}
          </p>
          <p className="mt-1 text-[10px] text-[#929b95]">
            신청 {new Date(registration.requestedAt).toLocaleString('ko-KR')}
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_150px_auto]">
        <input
          aria-label={`${registration.name} 소속`}
          value={team}
          onChange={(event) => setTeam(event.target.value)}
          required
          className={inputClass}
          placeholder="소속"
        />
        <select
          aria-label={`${registration.name} 권한`}
          value={role}
          onChange={(event) =>
            setRole(event.target.value as Exclude<Role, 'admin'>)
          }
          className={inputClass}
        >
          <option value="member">팀원</option>
          <option value="commenter">조회·댓글</option>
        </select>
        <Button type="submit" disabled={busy}>
          {busy ? <LoaderCircle className="animate-spin" /> : <Check />}승인
        </Button>
      </div>
      {error && (
        <p
          role="alert"
          className="mt-2 rounded-lg bg-[#f7e8e4] px-3 py-2 text-xs font-semibold text-[#8d342e]"
        >
          {error}
        </p>
      )}
    </form>
  );
}

function NotificationsView({
  data,
  isAdmin,
  openTask,
  setTaskStatus,
}: {
  data: WorkspaceState;
  isAdmin: boolean;
  openTask: (id: string) => void;
  setTaskStatus: (id: string, status: Task['status']) => void;
}) {
  const requests = data.tasks.filter(
    (task) => task.status === 'completion_requested',
  );
  return (
    <section className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-5">
      <div className="mb-4 flex items-center gap-2">
        <ShieldCheck className="size-5 text-[#2f6b4f]" />
        <h3 className="font-black">최종 완료 요청함</h3>
      </div>
      <div className="space-y-2">
        {requests.length ? (
          requests.map((task) => (
            <div
              key={task.id}
              className="flex flex-col gap-3 rounded-2xl border border-[#e0e3de] bg-white p-4 sm:flex-row sm:items-center"
            >
              <button
                onClick={() => openTask(task.id)}
                className="min-w-0 flex-1 text-left"
              >
                <strong className="block truncate text-sm">{task.title}</strong>
                <span className="text-xs text-[#748078]">
                  {formatDate(task.date)} ·{' '}
                  {assigneeNames(task, data).join(', ')}
                </span>
              </button>
              {isAdmin && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setTaskStatus(task.id, 'in_progress')}
                  >
                    반려
                  </Button>
                  <Button onClick={() => setTaskStatus(task.id, 'completed')}>
                    <Check />
                    최종 완료
                  </Button>
                </div>
              )}
            </div>
          ))
        ) : (
          <Empty title="확인할 완료 요청이 없습니다." />
        )}
      </div>
    </section>
  );
}

function ModalShell({
  title,
  description,
  close,
  children,
}: {
  title: string;
  description: string;
  close: () => void;
  children: React.ReactNode;
}) {
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

  return (
    <div className="fixed inset-0 z-[60] grid place-items-end overflow-hidden p-0 sm:place-items-center sm:p-4">
      <button
        aria-label="대화상자 닫기"
        className="absolute inset-0 bg-[#17231c]/30 backdrop-blur-[2px]"
        onClick={close}
      />
      <dialog
        open
        aria-label={title}
        className="relative m-0 max-h-[92vh] w-full overscroll-contain overflow-y-auto rounded-t-3xl bg-[#fbfaf5] p-5 text-[#26352d] shadow-2xl sm:m-auto sm:max-w-xl sm:rounded-3xl"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black">{title}</h2>
            <p className="mt-1 text-sm text-[#748078]">{description}</p>
          </div>
          <Button aria-label="닫기" variant="ghost" size="icon" onClick={close}>
            <X />
          </Button>
        </div>
        {children}
      </dialog>
    </div>
  );
}

function CollaboratorsField({
  data,
  defaultSelected,
}: {
  data: WorkspaceState;
  defaultSelected: string[];
}) {
  const options = data.members.filter(
    (member) => member.active && member.role !== 'commenter',
  );
  if (!options.length) return null;
  return (
    <Field label="추가 담당자 (복수 선택 가능)">
      <div className="flex flex-wrap gap-2">
        {options.map((member) => (
          <label
            key={member.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#d8ded4] bg-white px-3 py-1.5 text-xs font-bold transition has-[:checked]:border-[#2f6b4f] has-[:checked]:bg-[#e3eee7] has-[:checked]:text-[#245b43]"
          >
            <input
              type="checkbox"
              name="collaborators"
              value={member.id}
              defaultChecked={defaultSelected.includes(member.id)}
              className="size-3.5 accent-[#2f6b4f]"
            />
            {member.name}
          </label>
        ))}
      </div>
    </Field>
  );
}

type TimePickerParts = {
  period: '' | 'am' | 'pm';
  hour: string;
  minute: string;
};

function timePickerParts(value: string): TimePickerParts {
  if (!/^\d{2}:(00|30)$/.test(value)) {
    return { period: '', hour: '', minute: '' };
  }
  const [hourText, minute] = value.split(':');
  const hour = Number(hourText);
  return {
    period: hour < 12 ? 'am' : 'pm',
    hour: String(hour % 12 || 12).padStart(2, '0'),
    minute,
  };
}

function timeFromPickerParts({ period, hour, minute }: TimePickerParts) {
  if (!period || !hour || !minute) return '';
  const hour24 = (Number(hour) % 12) + (period === 'pm' ? 12 : 0);
  return `${String(hour24).padStart(2, '0')}:${minute}`;
}

function TimePicker({
  name,
  label,
  value,
  onChange,
}: {
  name: 'time' | 'endTime';
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [parts, setParts] = useState<TimePickerParts>(() =>
    timePickerParts(value),
  );

  function updatePart(part: keyof TimePickerParts, nextValue: string) {
    const nextParts = { ...parts, [part]: nextValue } as TimePickerParts;
    setParts(nextParts);
    onChange(timeFromPickerParts(nextParts));
  }

  function clearTime() {
    setParts({ period: '', hour: '', minute: '' });
    onChange('');
  }

  return (
    <div className="rounded-xl border border-[#d8ded4] bg-white p-2">
      <input name={name} type="hidden" value={value} />
      <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-1.5">
        <select
          aria-label={`${label} 오전 또는 오후`}
          value={parts.period}
          onChange={(event) => updatePart('period', event.target.value)}
          className="h-9 min-w-0 rounded-lg border border-[#d8ded4] bg-white px-2 text-sm font-bold outline-none focus:border-[#2f6b4f] focus:ring-2 focus:ring-[#2f6b4f]/10"
        >
          <option value="">오전/오후</option>
          <option value="am">오전</option>
          <option value="pm">오후</option>
        </select>
        <select
          aria-label={`${label} 시`}
          value={parts.hour}
          onChange={(event) => updatePart('hour', event.target.value)}
          className="h-9 min-w-0 rounded-lg border border-[#d8ded4] bg-white px-2 text-sm font-bold outline-none focus:border-[#2f6b4f] focus:ring-2 focus:ring-[#2f6b4f]/10"
        >
          <option value="">시</option>
          {Array.from({ length: 12 }, (_, index) => {
            const hour = String(index + 1).padStart(2, '0');
            return (
              <option key={hour} value={hour}>
                {hour}시
              </option>
            );
          })}
        </select>
        <select
          aria-label={`${label} 분`}
          value={parts.minute}
          onChange={(event) => updatePart('minute', event.target.value)}
          className="h-9 min-w-0 rounded-lg border border-[#d8ded4] bg-white px-2 text-sm font-bold outline-none focus:border-[#2f6b4f] focus:ring-2 focus:ring-[#2f6b4f]/10"
        >
          <option value="">분</option>
          <option value="00">00분</option>
          <option value="30">30분</option>
        </select>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 px-0.5 text-[11px]">
        <span className="font-bold text-[#748078]">
          {value ? formatClockTime(value) : '시간 미정 (종일 업무)'}
        </span>
        {(value || parts.period || parts.hour || parts.minute) && (
          <button
            type="button"
            onClick={clearTime}
            className="font-bold text-[#5f6d64] underline underline-offset-2 hover:text-[#2f6b4f]"
          >
            시간 없음
          </button>
        )}
      </div>
    </div>
  );
}

function TaskForm({
  data,
  actor,
  defaultDate,
  defaultTime,
  close,
  save,
}: {
  data: WorkspaceState;
  actor: Member;
  defaultDate: string;
  defaultTime?: string;
  close: () => void;
  save: (task: Task) => void;
}) {
  const assigneeId = defaultAssigneeId(data, actor);
  const startsOvernight = Boolean(
    defaultTime && timeToMinutes(defaultTime) + 60 >= 1440,
  );
  const [startDate, setStartDate] = useState(defaultDate);
  const [endDate, setEndDate] = useState(
    startsOvernight ? shiftIsoDate(defaultDate, 1) : '',
  );
  const [time, setTime] = useState(defaultTime ?? '');
  const [endTime, setEndTime] = useState(
    defaultTime ? addMinutesToTime(defaultTime, 60) : '',
  );
  const [autoEndDate, setAutoEndDate] = useState(startsOvernight);

  function updateStartDate(nextDate: string) {
    setStartDate(nextDate);
    if (autoEndDate) setEndDate(shiftIsoDate(nextDate, 1));
  }

  function updateEndDate(nextDate: string) {
    setEndDate(nextDate);
    setAutoEndDate(false);
  }

  function updateStartTime(nextTime: string) {
    setTime(nextTime);
    if (!nextTime) {
      setEndTime('');
      if (autoEndDate) setEndDate('');
      setAutoEndDate(false);
      return;
    }

    setEndTime(addMinutesToTime(nextTime, 60));
    const endsOvernight = timeToMinutes(nextTime) + 60 >= 1440;
    if (endsOvernight) {
      setEndDate(shiftIsoDate(startDate, 1));
    } else if (autoEndDate) {
      setEndDate('');
    }
    setAutoEndDate(endsOvernight);
  }

  function submit(event: FormSubmitEvent) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const startDate = formText(form, 'date');
    const endDate = formText(form, 'endDate') || undefined;
    if (endDate && endDate < startDate) {
      window.alert('종료일은 시작일보다 빠를 수 없습니다.');
      return;
    }
    const time = formText(form, 'time') || undefined;
    const endTime = formText(form, 'endTime') || undefined;
    if (time && endTime && endTime <= time && (!endDate || endDate <= startDate)) {
      window.alert('종료 시간은 시작 시간보다 늦어야 합니다.');
      return;
    }
    const checklist = formText(form, 'checklist')
      .split('\n')
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => ({ id: uid('check'), text, done: false }));
    const primaryAssignee = formText(form, 'assignee');
    const collaborators = [
      ...new Set(form.getAll('collaborators').map(String)),
    ].filter((id) => id !== primaryAssignee);
    save({
      id: uid('task'),
      title: formText(form, 'title'),
      description: formText(form, 'description'),
      date: startDate,
      endDate,
      time,
      endTime: time ? endTime : undefined,
      categoryId: formText(form, 'category'),
      assigneeId: primaryAssignee,
      collaborators,
      priority: formText(form, 'priority') as Task['priority'],
      status: 'scheduled',
      type: formText(form, 'type') as Task['type'],
      checklist,
      comments: [],
      createdBy: actor.id,
      createdAt: new Date().toISOString(),
    });
    close();
  }
  return (
    <ModalShell
      title="새 업무"
      description="업무명·날짜·담당자만 입력해도 바로 등록됩니다."
      close={close}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="업무명">
          <input
            name="title"
            required
            className={inputClass}
            placeholder="예: 시설 조치 결과 확인"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="시작일">
            <input
              name="date"
              type="date"
              value={startDate}
              onChange={(event) => updateStartDate(event.target.value)}
              required
              className={inputClass}
            />
          </Field>
          <Field label="종료일">
            <input
              name="endDate"
              type="date"
              value={endDate}
              onChange={(event) => updateEndDate(event.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="시작 시간 (선택, 비워두면 종일 업무)">
            <TimePicker
              key={`create-start-${time}`}
              name="time"
              label="시작 시간"
              value={time}
              onChange={updateStartTime}
            />
          </Field>
          <Field label="종료 시간 (시작 후 1시간 자동 설정)">
            <TimePicker
              key={`create-end-${endTime}`}
              name="endTime"
              label="종료 시간"
              value={endTime}
              onChange={setEndTime}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="담당자">
            <select
              name="assignee"
              className={inputClass}
              defaultValue={assigneeId}
            >
              {data.members
                .filter(
                  (member) => member.active && member.role !== 'commenter',
                )
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="업무 분류">
            <select name="category" className={inputClass}>
              {data.categories
                .filter((item) => item.active)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <CollaboratorsField data={data} defaultSelected={[]} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="유형">
            <select name="type" className={inputClass}>
              <option value="task">일반 업무</option>
              <option value="routine">루틴 업무</option>
              <option value="issue">현장 이슈</option>
              <option value="event">행사·프로젝트</option>
            </select>
          </Field>
          <Field label="우선순위">
            <select name="priority" className={inputClass}>
              <option value="normal">보통</option>
              <option value="urgent">긴급</option>
              <option value="low">낮음</option>
            </select>
          </Field>
        </div>
        <Field label="설명">
          <textarea
            name="description"
            className={textAreaClass}
            placeholder="업무 내용과 완료 기준을 적어주세요."
          />
        </Field>
        <Field label="체크리스트">
          <textarea
            name="checklist"
            className={textAreaClass}
            placeholder={
              '한 줄에 하나씩 입력\n예: 현장 사진 확인\n담당 부서 회신 확인'
            }
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close}>
            취소
          </Button>
          <Button type="submit">업무 등록</Button>
        </div>
      </form>
    </ModalShell>
  );
}

function NoteForm({
  data,
  actor,
  close,
  save,
}: {
  data: WorkspaceState;
  actor: Member;
  close: () => void;
  save: (note: SpecialNote) => void;
}) {
  function submit(event: FormSubmitEvent) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const date = formText(form, 'date');
    const count = data.notes.filter((note) => note.date === date).length + 1;
    save({
      id: uid('note'),
      label: `특이사항-${date.replaceAll('-', '')}-${String(count).padStart(3, '0')}`,
      date,
      categoryId: formText(form, 'category'),
      location: formText(form, 'location'),
      body: formText(form, 'body'),
      urgent: form.get('urgent') === 'on',
      createdBy: actor.id,
      createdAt: new Date().toISOString(),
    });
    close();
  }
  return (
    <ModalShell
      title="특이사항 등록"
      description="현장에서 발견한 내용을 먼저 간단히 남겨주세요."
      close={close}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="발생일">
            <input
              name="date"
              type="date"
              required
              defaultValue={isoDate()}
              className={inputClass}
            />
          </Field>
          <Field label="위치">
            <input
              name="location"
              required
              className={inputClass}
              placeholder="예: 야외가든"
            />
          </Field>
        </div>
        <Field label="분류">
          <select name="category" className={inputClass}>
            {data.categories
              .filter((item) => item.active)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="내용">
          <textarea
            name="body"
            required
            className={textAreaClass}
            placeholder="무슨 일이 있었는지 적어주세요."
          />
        </Field>
        <label className="flex items-center gap-2 rounded-xl bg-[#fff1dd] p-3 text-sm font-bold">
          <input
            name="urgent"
            type="checkbox"
            className="size-4 accent-[#c9574d]"
          />
          긴급 확인이 필요한 특이사항
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close}>
            취소
          </Button>
          <Button type="submit">특이사항 등록</Button>
        </div>
      </form>
    </ModalShell>
  );
}

function EditNoteForm({
  data,
  note,
  close,
  save,
}: {
  data: WorkspaceState;
  note: SpecialNote;
  close: () => void;
  save: (note: SpecialNote) => void;
}) {
  function submit(event: FormSubmitEvent) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    save({
      ...note,
      date: formText(form, 'date'),
      categoryId: formText(form, 'category'),
      location: formText(form, 'location'),
      body: formText(form, 'body'),
      urgent: form.get('urgent') === 'on',
    });
    close();
  }
  return (
    <ModalShell
      title="특이사항 수정"
      description="내용, 위치, 분류를 변경할 수 있습니다."
      close={close}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="발생일">
            <input
              name="date"
              type="date"
              required
              defaultValue={note.date}
              className={inputClass}
            />
          </Field>
          <Field label="위치">
            <input
              name="location"
              required
              defaultValue={note.location}
              className={inputClass}
              placeholder="예: 야외가든"
            />
          </Field>
        </div>
        <Field label="분류">
          <select
            name="category"
            defaultValue={note.categoryId}
            className={inputClass}
          >
            {data.categories
              .filter((item) => item.active)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="내용">
          <textarea
            name="body"
            required
            defaultValue={note.body}
            className={`${textAreaClass} min-h-40`}
            placeholder="무슨 일이 있었는지 적어주세요."
          />
        </Field>
        <label className="flex items-center gap-2 rounded-xl bg-[#fff1dd] p-3 text-sm font-bold">
          <input
            name="urgent"
            type="checkbox"
            defaultChecked={note.urgent}
            className="size-4 accent-[#c9574d]"
          />
          긴급 확인이 필요한 특이사항
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close}>
            취소
          </Button>
          <Button type="submit">저장</Button>
        </div>
      </form>
    </ModalShell>
  );
}

function RoutineForm({
  data,
  close,
  save,
}: {
  data: WorkspaceState;
  close: () => void;
  save: (routine: Routine) => void;
}) {
  return <RoutineEditor data={data} close={close} save={save} />;
}

function EditRoutineForm({
  data,
  routine,
  close,
  save,
}: {
  data: WorkspaceState;
  routine: Routine;
  close: () => void;
  save: (routine: Routine) => void;
}) {
  return (
    <RoutineEditor data={data} routine={routine} close={close} save={save} />
  );
}

function RoutineEditor({
  data,
  routine,
  close,
  save,
}: {
  data: WorkspaceState;
  routine?: Routine;
  close: () => void;
  save: (routine: Routine) => void;
}) {
  const [checklistText, setChecklistText] = useState(
    routine?.checklist.join('\n') ?? '',
  );
  const [links, setLinks] = useState<ReferenceLink[]>(
    routine ? routineLinks(routine) : [],
  );
  const checklist = checklistText
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

  function submit(event: FormSubmitEvent) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextLinks = links
      .filter((link) => link.title.trim() && link.url.trim())
      .map((link) => ({
        ...link,
        title: link.title.trim(),
        url: normalizeUrl(link.url),
        afterChecklistIndex: Math.min(
          link.afterChecklistIndex,
          checklist.length,
        ),
      }));
    save({
      id: routine?.id ?? uid('routine'),
      title: formText(form, 'title'),
      categoryId: formText(form, 'category'),
      assigneeId: formText(form, 'assignee'),
      cadence: formText(form, 'cadence'),
      checklist,
      checklistDone: checklist.map((text, index) =>
        routine?.checklist[index] === text
          ? Boolean(routine.checklistDone?.[index])
          : false,
      ),
      referenceLinks: nextLinks,
      active: routine?.active ?? true,
      nextDate: formText(form, 'nextDate'),
    });
    close();
  }

  return (
    <ModalShell
      title={routine ? '루틴 수정' : '새 루틴'}
      description="반복 주기, 체크리스트와 참고 링크 위치를 설정합니다."
      close={close}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="루틴명">
          <input
            name="title"
            required
            defaultValue={routine?.title}
            className={inputClass}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="담당자">
            <select
              name="assignee"
              className={inputClass}
              defaultValue={routine?.assigneeId}
            >
              {data.members
                .filter(
                  (member) => member.active && member.role !== 'commenter',
                )
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="분류">
            <select
              name="category"
              className={inputClass}
              defaultValue={routine?.categoryId}
            >
              {data.categories
                .filter(
                  (item) => item.active || item.id === routine?.categoryId,
                )
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="반복 주기">
            <input
              name="cadence"
              required
              defaultValue={routine?.cadence}
              className={inputClass}
              placeholder="예: 매주 월요일"
            />
          </Field>
          <Field label="다음 실행일">
            <input
              name="nextDate"
              type="date"
              required
              defaultValue={routine?.nextDate ?? isoDate()}
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="체크리스트">
          <textarea
            name="checklist"
            value={checklistText}
            onChange={(event) => setChecklistText(event.target.value)}
            className={textAreaClass}
            placeholder="한 줄에 하나씩 입력"
          />
        </Field>
        <section className="rounded-2xl border border-[#d8ded4] bg-[#f4f3ee] p-3">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-black">참고 링크</h3>
              <p className="text-xs text-[#748078]">
                제목과 주소를 적고 체크리스트에서 표시할 위치를 고르세요.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setLinks((current) => [
                  ...current,
                  {
                    id: uid('link'),
                    title: '',
                    url: '',
                    afterChecklistIndex: checklist.length,
                  },
                ])
              }
            >
              <Plus />
              링크 추가
            </Button>
          </div>
          <div className="space-y-3">
            {links.map((link) => (
              <div
                key={link.id}
                className="grid gap-2 rounded-xl bg-white p-3 sm:grid-cols-[1fr_1.4fr_150px_auto]"
              >
                <input
                  aria-label="참고 링크 제목"
                  value={link.title}
                  onChange={(event) =>
                    setLinks((current) =>
                      current.map((item) =>
                        item.id === link.id
                          ? { ...item, title: event.target.value }
                          : item,
                      ),
                    )
                  }
                  className={inputClass}
                  placeholder="링크 제목"
                />
                <input
                  aria-label="참고 링크 주소"
                  type="url"
                  value={link.url}
                  onChange={(event) =>
                    setLinks((current) =>
                      current.map((item) =>
                        item.id === link.id
                          ? { ...item, url: event.target.value }
                          : item,
                      ),
                    )
                  }
                  className={inputClass}
                  placeholder="https://"
                />
                <select
                  aria-label="참고 링크 위치"
                  value={Math.min(link.afterChecklistIndex, checklist.length)}
                  onChange={(event) =>
                    setLinks((current) =>
                      current.map((item) =>
                        item.id === link.id
                          ? {
                              ...item,
                              afterChecklistIndex: Number(event.target.value),
                            }
                          : item,
                      ),
                    )
                  }
                  className={inputClass}
                >
                  <option value={0}>첫 항목 앞</option>
                  {checklist.map((item, index) => (
                    <option key={index} value={index + 1}>
                      {index + 1}번 뒤 · {item.slice(0, 12)}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="참고 링크 삭제"
                  onClick={() =>
                    setLinks((current) =>
                      current.filter((item) => item.id !== link.id),
                    )
                  }
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        </section>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close}>
            취소
          </Button>
          <Button type="submit">
            {routine ? <Pencil /> : <Plus />}
            {routine ? '수정 저장' : '루틴 등록'}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

function InteractiveRoutineDetail({
  routine,
  data,
  canEdit,
  isAdmin,
  close,
  edit,
  deleteRoutine,
  toggleChecklist,
}: {
  routine: Routine;
  data: WorkspaceState;
  canEdit: boolean;
  isAdmin: boolean;
  close: () => void;
  edit: () => void;
  deleteRoutine: () => void;
  toggleChecklist: (routineId: string, index: number) => void;
}) {
  const category = data.categories.find(
    (item) => item.id === routine.categoryId,
  );
  const member = data.members.find((item) => item.id === routine.assigneeId);
  const links = routineLinks(routine);
  const completed = routine.checklist.filter(
    (_, index) => routine.checklistDone?.[index],
  ).length;
  const linksAt = (position: number) =>
    links
      .filter((link) => link.afterChecklistIndex === position)
      .map((link) => (
        <a
          key={link.id}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-xl border border-[#b9cec0] bg-[#eef5f0] p-3 text-sm font-bold text-[#2f6b4f]"
        >
          <Link2 className="size-4 shrink-0" />
          <span className="truncate">{link.title}</span>
        </a>
      ));
  return (
    <ModalShell
      title={routine.title}
      description="등록된 루틴 상세 내용"
      close={close}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <span
            className={`rounded-full px-2 py-1 text-xs font-black ${routine.active ? 'bg-[#e3eee7] text-[#2f6b4f]' : 'bg-[#ecebe6] text-[#7b847e]'}`}
          >
            {routine.active ? '사용 중' : '중단됨'}
          </span>
          <span className="rounded-full bg-[#f1f0eb] px-2 py-1 text-xs font-bold">
            {category?.name}
          </span>
        </div>
        <dl className="grid gap-3 rounded-2xl bg-[#f1f2ed] p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-bold text-[#748078]">담당자</dt>
            <dd className="mt-1 font-black">{member?.name ?? '미배정'}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-[#748078]">반복 주기</dt>
            <dd className="mt-1 font-black">{routine.cadence}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-[#748078]">다음 실행일</dt>
            <dd className="mt-1 font-black">{formatDate(routine.nextDate)}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-[#748078]">캘린더 표시</dt>
            <dd className="mt-1 font-black">
              {routine.active ? '자동 표시' : '표시 중단'}
            </dd>
          </div>
        </dl>
        <section>
          <h3 className="mb-2 text-sm font-black">
            체크리스트 {completed}/{routine.checklist.length}
          </h3>
          <div className="space-y-2">
            {linksAt(0)}
            {routine.checklist.map((item, index) => {
              const done = Boolean(routine.checklistDone?.[index]);
              return (
                <div key={`${routine.id}-${index}`} className="space-y-2">
                  <label className="flex items-start gap-3 rounded-xl border border-[#e0e3de] bg-white p-3 text-sm">
                    <input
                      type="checkbox"
                      aria-label={`${item} 완료`}
                      checked={done}
                      disabled={!canEdit}
                      onChange={() => toggleChecklist(routine.id, index)}
                      className="mt-0.5 size-5 shrink-0 accent-[#2f6b4f]"
                    />
                    <span
                      className={`min-w-0 flex-1 ${done ? 'text-[#879089] line-through' : ''}`}
                    >
                      <LinkifiedText text={item} />
                    </span>
                  </label>
                  {linksAt(index + 1)}
                </div>
              );
            })}
            {!routine.checklist.length && !links.length && (
              <p className="text-sm text-[#748078]">
                등록된 체크리스트와 참고 링크가 없습니다.
              </p>
            )}
          </div>
        </section>
        <div className="flex justify-between border-t border-[#e0e3de] pt-4">
          {isAdmin ? (
            <Button variant="destructive" onClick={deleteRoutine}>
              <Trash2 />
              삭제
            </Button>
          ) : (
            <span />
          )}
          {canEdit && (
            <Button variant="outline" onClick={edit}>
              <Pencil />
              루틴 수정
            </Button>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

function EditTaskForm({
  data,
  task,
  close,
  save,
}: {
  data: WorkspaceState;
  task: Task;
  close: () => void;
  save: (task: Task) => void;
}) {
  const hasSuggestedEndTime = Boolean(task.time && !task.endTime);
  const startsOvernight = Boolean(
    hasSuggestedEndTime &&
      task.time &&
      timeToMinutes(task.time) + 60 >= 1440 &&
      !task.endDate,
  );
  const [startDate, setStartDate] = useState(task.date);
  const [endDate, setEndDate] = useState(
    startsOvernight ? shiftIsoDate(task.date, 1) : (task.endDate ?? ''),
  );
  const [time, setTime] = useState(task.time ?? '');
  const [endTime, setEndTime] = useState(
    task.time ? (task.endTime ?? addMinutesToTime(task.time, 60)) : '',
  );
  const [autoEndDate, setAutoEndDate] = useState(startsOvernight);

  function updateStartDate(nextDate: string) {
    setStartDate(nextDate);
    if (autoEndDate) setEndDate(shiftIsoDate(nextDate, 1));
  }

  function updateEndDate(nextDate: string) {
    setEndDate(nextDate);
    setAutoEndDate(false);
  }

  function updateStartTime(nextTime: string) {
    setTime(nextTime);
    if (!nextTime) {
      setEndTime('');
      if (autoEndDate) setEndDate('');
      setAutoEndDate(false);
      return;
    }

    setEndTime(addMinutesToTime(nextTime, 60));
    const endsOvernight = timeToMinutes(nextTime) + 60 >= 1440;
    if (endsOvernight) {
      setEndDate(shiftIsoDate(startDate, 1));
    } else if (autoEndDate) {
      setEndDate('');
    }
    setAutoEndDate(endsOvernight);
  }

  function submit(event: FormSubmitEvent) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const startDate = formText(form, 'date');
    const endDate = formText(form, 'endDate') || undefined;
    if (endDate && endDate < startDate) {
      window.alert('종료일은 시작일보다 빠를 수 없습니다.');
      return;
    }
    const time = formText(form, 'time') || undefined;
    const endTime = formText(form, 'endTime') || undefined;
    if (time && endTime && endTime <= time && (!endDate || endDate <= startDate)) {
      window.alert('종료 시간은 시작 시간보다 늦어야 합니다.');
      return;
    }
    const oldChecklist = task.checklist;
    const checklist = formText(form, 'checklist')
      .split('\n')
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text, index) =>
        oldChecklist[index]?.text === text
          ? oldChecklist[index]
          : { id: uid('check'), text, done: false },
      );
    const primaryAssignee = formText(form, 'assignee');
    const collaborators = [
      ...new Set(form.getAll('collaborators').map(String)),
    ].filter((id) => id !== primaryAssignee);
    save({
      ...task,
      title: formText(form, 'title'),
      description: formText(form, 'description'),
      date: startDate,
      endDate,
      time,
      endTime: time ? endTime : undefined,
      categoryId: formText(form, 'category'),
      assigneeId: primaryAssignee,
      collaborators,
      priority: formText(form, 'priority') as Task['priority'],
      type: formText(form, 'type') as Task['type'],
      checklist,
    });
    close();
  }
  return (
    <ModalShell
      title="업무 수정"
      description="캘린더에 등록된 업무 내용을 변경합니다."
      close={close}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="업무명">
          <input
            name="title"
            required
            defaultValue={task.title}
            className={inputClass}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="시작일">
            <input
              name="date"
              type="date"
              value={startDate}
              onChange={(event) => updateStartDate(event.target.value)}
              required
              className={inputClass}
            />
          </Field>
          <Field label="종료일">
            <input
              name="endDate"
              type="date"
              value={endDate}
              onChange={(event) => updateEndDate(event.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="시작 시간 (선택, 비워두면 종일 업무)">
            <TimePicker
              key={`edit-start-${time}`}
              name="time"
              label="시작 시간"
              value={time}
              onChange={updateStartTime}
            />
          </Field>
          <Field label="종료 시간 (시작 후 1시간 자동 설정)">
            <TimePicker
              key={`edit-end-${endTime}`}
              name="endTime"
              label="종료 시간"
              value={endTime}
              onChange={setEndTime}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="담당자">
            <select
              name="assignee"
              className={inputClass}
              defaultValue={task.assigneeId}
            >
              {data.members
                .filter(
                  (member) => member.active && member.role !== 'commenter',
                )
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="업무 분류">
            <select
              name="category"
              className={inputClass}
              defaultValue={task.categoryId}
            >
              {data.categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <CollaboratorsField data={data} defaultSelected={task.collaborators} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="유형">
            <select name="type" className={inputClass} defaultValue={task.type}>
              <option value="task">일반 업무</option>
              <option value="routine">루틴 업무</option>
              <option value="issue">현장 이슈</option>
              <option value="event">행사·프로젝트</option>
            </select>
          </Field>
          <Field label="우선순위">
            <select
              name="priority"
              className={inputClass}
              defaultValue={task.priority}
            >
              <option value="normal">보통</option>
              <option value="urgent">긴급</option>
              <option value="low">낮음</option>
            </select>
          </Field>
        </div>
        <Field label="설명">
          <textarea
            name="description"
            defaultValue={task.description}
            className={textAreaClass}
          />
        </Field>
        <Field label="체크리스트">
          <textarea
            name="checklist"
            defaultValue={task.checklist.map((item) => item.text).join('\n')}
            className={textAreaClass}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close}>
            취소
          </Button>
          <Button type="submit">
            <Pencil />
            수정 저장
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

function MemberForm({
  close,
  save,
}: {
  close: () => void;
  save: (member: Member) => void;
}) {
  function submit(event: FormSubmitEvent) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    save({
      id: uid('member'),
      name: formText(form, 'name'),
      email: formText(form, 'email'),
      role: formText(form, 'role') as Member['role'],
      team: formText(form, 'team'),
      active: true,
    });
    close();
  }
  return (
    <ModalShell
      title="사용자 추가"
      description="초대할 사용자의 이메일과 권한을 입력합니다."
      close={close}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="이름">
          <input name="name" required className={inputClass} />
        </Field>
        <Field label="이메일">
          <input name="email" type="email" required className={inputClass} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="소속">
            <input
              name="team"
              required
              defaultValue="파크사업팀"
              className={inputClass}
            />
          </Field>
          <Field label="권한">
            <select name="role" className={inputClass}>
              <option value="member">팀원</option>
              <option value="commenter">조회·댓글</option>
            </select>
          </Field>
        </div>
        <div className="rounded-xl bg-[#fff8df] p-3 text-xs leading-5 text-[#6f623d]">
          퇴사자가 생기면 기존 계정을 재사용하지 않고 비활성화한 뒤, 새 사용자를
          추가합니다. 미완료 업무와 루틴만 관리자에게 인계됩니다.
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close}>
            취소
          </Button>
          <Button type="submit">사용자 추가</Button>
        </div>
      </form>
    </ModalShell>
  );
}

function TaskDetail({
  task,
  data,
  canEdit,
  isAdmin,
  close,
  edit,
  toggleChecklist,
  setTaskStatus,
  deleteTask,
  deleteComment,
  addComment,
}: {
  task: Task;
  data: WorkspaceState;
  canEdit: boolean;
  isAdmin: boolean;
  close: () => void;
  edit: () => void;
  toggleChecklist: (taskId: string, checkId: string) => void;
  setTaskStatus: (taskId: string, status: Task['status']) => void;
  deleteTask: (taskId: string) => void;
  deleteComment: (taskId: string, commentId: string) => void;
  addComment: (body: string) => void;
}) {
  const [comment, setComment] = useState('');
  const category = data.categories.find((item) => item.id === task.categoryId);
  const names = assigneeNames(task, data);
  function submitComment(event: FormSubmitEvent) {
    event.preventDefault();
    if (!comment.trim()) return;
    addComment(comment.trim());
    setComment('');
  }
  const overdueFlag = isTaskOverdue(task);
  return (
    <ModalShell
      title={
        task.priority === 'urgent' ? `[긴급] ${task.title}` : task.title
      }
      description={`${formatDate(task.date)}${task.endDate ? ` ~ ${formatDate(task.endDate)}` : ''} · ${formatTaskTime(task.time, task.endTime)} · ${category?.name} · ${names.join(', ') || '미배정'}`}
      close={close}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-[#e3eee7] px-2 py-1 text-xs font-bold text-[#2f6b4f]">
            {statusLabel[task.status]}
          </span>
          <span
            className={`rounded-full px-2 py-1 text-xs font-bold ${task.priority === 'urgent' ? 'bg-[#dbeafe] text-[#1d4ed8]' : 'bg-[#f1f0eb] text-[#4b564f]'}`}
          >
            {task.priority === 'urgent' ? '‼ 긴급' : priorityLabel[task.priority]}
          </span>
          {overdueFlag && (
            <span className="rounded-full bg-[#fde2e1] px-2 py-1 text-xs font-bold text-[#c0392b]">
              지연
            </span>
          )}
          {task.endDate && (
            <span className="rounded-full bg-[#fff1dd] px-2 py-1 text-xs font-bold text-[#806743]">
              {dday(task.endDate)}
            </span>
          )}
        </div>
        <p className="whitespace-pre-line text-sm leading-6 text-[#5f6d64]">
          <LinkifiedText text={task.description || '설명이 없습니다.'} />
        </p>
        {task.checklist.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-black">체크리스트</h3>
            <div className="space-y-2">
              {task.checklist.map((item) => (
                <label
                  key={item.id}
                  className={`flex w-full items-center gap-3 rounded-xl bg-[#f1f2ed] p-3 text-left text-sm ${canEdit ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  <input
                    type="checkbox"
                    aria-label={`${item.text} 완료`}
                    checked={item.done}
                    disabled={!canEdit}
                    onChange={() => toggleChecklist(task.id, item.id)}
                    className="size-5 shrink-0 accent-[#2f6b4f]"
                  />
                  <span
                    className={item.done ? 'text-[#879089] line-through' : ''}
                  >
                    <LinkifiedText text={item.text} />
                  </span>
                </label>
              ))}
            </div>
          </section>
        )}
        <section>
          <h3 className="mb-2 text-sm font-black">
            댓글 {task.comments.length}
          </h3>
          <div className="max-h-44 space-y-2 overflow-y-auto">
            {task.comments.map((comment) => {
              const author = data.members.find(
                (member) => member.id === comment.authorId,
              );
              return (
                <div key={comment.id} className="rounded-xl bg-[#f1f2ed] p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <strong className="text-xs">
                      {author?.name ?? '사용자'}
                    </strong>
                    <span className="text-[10px] text-[#859088]">
                      {new Date(comment.createdAt).toLocaleString('ko-KR')}
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm">{comment.body}</p>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => deleteComment(task.id, comment.id)}
                        className="text-xs font-bold text-[#a83f36]"
                      >
                        삭제
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <form onSubmit={submitComment} className="mt-2 flex gap-2">
            <input
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              className={inputClass}
              placeholder="의견을 남겨주세요."
            />
            <Button type="submit" aria-label="댓글 등록">
              <MessageCircle />
            </Button>
          </form>
        </section>
        <div className="flex flex-wrap justify-between gap-2 border-t border-[#e0e3de] pt-4">
          <div className="flex gap-2">
            {isAdmin && (
              <Button variant="destructive" onClick={() => deleteTask(task.id)}>
                <Trash2 />
                삭제
              </Button>
            )}
            {canEdit && (
              <Button variant="outline" onClick={edit}>
                <Pencil />
                수정
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit && task.status === 'scheduled' && (
              <Button
                variant="outline"
                onClick={() => setTaskStatus(task.id, 'in_progress')}
              >
                진행 시작
              </Button>
            )}
            {canEdit && task.status === 'in_progress' && (
              <Button
                onClick={() => setTaskStatus(task.id, 'completion_requested')}
              >
                완료 요청
              </Button>
            )}
            {isAdmin && task.status === 'completion_requested' && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setTaskStatus(task.id, 'in_progress')}
                >
                  반려
                </Button>
                <Button onClick={() => setTaskStatus(task.id, 'completed')}>
                  <Check />
                  최종 완료
                </Button>
              </>
            )}
            {isAdmin && task.status === 'completed' && (
              <Button
                variant="outline"
                onClick={() => setTaskStatus(task.id, 'in_progress')}
              >
                다시 열기
              </Button>
            )}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-black text-[#617068]">
        {label}
      </span>
      {children}
    </label>
  );
}
function Empty({
  title,
  action,
  onClick,
}: {
  title: string;
  action?: string;
  onClick?: () => void;
}) {
  return (
    <div className="grid min-h-36 place-items-center rounded-2xl border border-dashed border-[#cfd5ce] bg-[#f4f3ee] p-6 text-center">
      <div>
        <ClipboardList className="mx-auto mb-2 size-6 text-[#8a958d]" />
        <p className="text-sm font-bold text-[#6f7b73]">{title}</p>
        {action && onClick && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={onClick}
          >
            {action}
          </Button>
        )}
      </div>
    </div>
  );
}
