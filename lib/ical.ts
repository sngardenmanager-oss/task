import type { Routine, Task, WorkspaceState } from '@/lib/types';

/** 캘린더 탭의 iCal 내려받기와 구글 캘린더 구독 피드(/api/calendar/feed)가 함께 쓰는 iCalendar 생성기입니다. */

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

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 서울 시각(UTC+9, 서머타임 없음)을 UTC 형식(YYYYMMDDTHHMMSSZ)으로 바꿉니다. */
function icalUtc(date: string, time: string) {
  return new Date(`${date}T${time}:00+09:00`)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function addHour(time: string) {
  const [hour, minute] = time.split(':').map(Number);
  const total = Math.min(hour * 60 + minute + 60, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** iCalendar 한 줄은 75옥텟을 넘지 않게 접어야 합니다(RFC 5545). */
function foldLine(line: string) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const charSize = encoder.encode(char).length;
    if (size + charSize > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += charSize;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function routineRule(routine: Routine) {
  if (/매일/.test(routine.cadence)) return 'FREQ=DAILY';
  if (/격주|2주/.test(routine.cadence)) return 'FREQ=WEEKLY;INTERVAL=2';
  if (/매주|주간|주 1회/.test(routine.cadence)) return 'FREQ=WEEKLY';
  if (/매월|월간|월 1회/.test(routine.cadence)) return 'FREQ=MONTHLY';
  return '';
}

function routineLines(routine: Routine) {
  const links = routine.referenceLinks?.length
    ? routine.referenceLinks
    : routine.referenceUrl
      ? [
          {
            title: '참고 링크',
            url: routine.referenceUrl,
            afterChecklistIndex: routine.checklist.length,
          },
        ]
      : [];
  const linkText = (index: number) =>
    links
      .filter((link) => link.afterChecklistIndex === index)
      .map((link) => `${link.title}: ${link.url}`);
  return [
    ...linkText(0),
    ...routine.checklist.flatMap((item, index) => [item, ...linkText(index + 1)]),
  ];
}

function taskSummary(task: Task, tasks: Task[]) {
  const parent = task.parentId
    ? tasks.find((item) => item.id === task.parentId)
    : undefined;
  return `${parent ? `[${parent.title}] ` : ''}${task.title}`;
}

export function buildCalendarIcs(data: WorkspaceState, calendarName: string) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const events = data.tasks.map((task) => {
    const category =
      data.categories.find((item) => item.id === task.categoryId)?.name ?? '';
    const names = [task.assigneeId, ...task.collaborators]
      .map((id) => data.members.find((member) => member.id === id)?.name)
      .filter((name): name is string => Boolean(name));
    const description = [
      task.description,
      names.length ? `담당자: ${names.join(', ')}` : '',
      ...task.checklist.map((item) => `${item.done ? '✓' : '□'} ${item.text}`),
    ]
      .filter(Boolean)
      .join('\n');
    const endDate = task.endDate ?? task.date;
    const timing = task.time
      ? [
          `DTSTART:${icalUtc(task.date, task.time)}`,
          `DTEND:${icalUtc(endDate, task.endTime ?? addHour(task.time))}`,
        ]
      : [
          `DTSTART;VALUE=DATE:${icalDate(task.date)}`,
          `DTEND;VALUE=DATE:${icalDate(shiftDate(endDate, 1))}`,
        ];
    return [
      'BEGIN:VEVENT',
      `UID:${icalEscape(task.id)}@snoopygarden.work`,
      `DTSTAMP:${stamp}`,
      ...timing,
      `SUMMARY:${icalEscape(taskSummary(task, data.tasks))}`,
      `DESCRIPTION:${icalEscape(description)}`,
      category ? `CATEGORIES:${icalEscape(category)}` : '',
      `STATUS:${task.status === 'completed' ? 'COMPLETED' : 'CONFIRMED'}`,
      'END:VEVENT',
    ];
  });
  const routines = data.routines
    .filter((routine) => routine.active)
    .map((routine) => {
      const rule = routineRule(routine);
      return [
        'BEGIN:VEVENT',
        `UID:${icalEscape(routine.id)}@snoopygarden.routine`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${icalDate(routine.nextDate)}`,
        `DTEND;VALUE=DATE:${icalDate(shiftDate(routine.nextDate, 1))}`,
        `SUMMARY:${icalEscape(`[루틴] ${routine.title}`)}`,
        `DESCRIPTION:${icalEscape([routine.cadence, ...routineLines(routine)].join('\n'))}`,
        rule ? `RRULE:${rule}` : '',
        'END:VEVENT',
      ];
    });
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Snoopy Garden//Work Calendar//KO',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icalEscape(calendarName)}`,
    'X-WR-TIMEZONE:Asia/Seoul',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...events.flat(),
    ...routines.flat(),
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .map(foldLine)
    .join('\r\n')
    .concat('\r\n');
}
