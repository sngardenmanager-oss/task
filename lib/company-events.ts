import type { CompanyEvent, Task } from './types';

/** 캘린더에서 전사 일정을 표시할 때 쓰는 분류 id·색입니다. */
export const COMPANY_CATEGORY_ID = '__company__';
export const COMPANY_COLOR = '#b7791f';
export const COMPANY_TASK_PREFIX = 'company:';

export function eventsForTeam(events: CompanyEvent[], teamId: string) {
  return events.filter(
    (event) => !event.teamIds.length || event.teamIds.includes(teamId),
  );
}

/** 입력값을 검사해 저장할 전사 일정으로 만듭니다. 문제가 있으면 문장으로 돌려줍니다. */
export function normalizeCompanyEvent(
  input: Partial<CompanyEvent>,
  previous?: CompanyEvent,
): CompanyEvent | string {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
  const title = input.title?.trim() ?? '';
  const date = input.date ?? '';
  const endDate = input.endDate || undefined;
  const time = input.time || undefined;
  const endTime = time ? input.endTime || undefined : undefined;
  if (!title) return '일정 이름을 입력해 주세요.';
  if (title.length > 120) return '일정 이름은 120자 이내로 입력해 주세요.';
  if (!day.test(date)) return '날짜를 확인해 주세요.';
  if (endDate && (!day.test(endDate) || endDate < date))
    return '종료일은 시작일과 같거나 뒤여야 합니다.';
  if (time && !clock.test(time)) return '시작 시각을 확인해 주세요.';
  if (endTime && !clock.test(endTime)) return '종료 시각을 확인해 주세요.';
  const now = new Date().toISOString();
  return {
    id: previous?.id ?? input.id ?? '',
    title,
    description: (input.description ?? '').slice(0, 4000),
    date,
    endDate: endDate && endDate !== date ? endDate : undefined,
    time,
    endTime,
    teamIds: [...new Set((input.teamIds ?? []).filter((id) => typeof id === 'string'))],
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
}

/** 전사 일정을 캘린더·구독 피드에 끼워 넣기 위한 읽기 전용 업무 모양으로 바꿉니다. */
export function companyEventAsTask(event: CompanyEvent): Task {
  return {
    id: `${COMPANY_TASK_PREFIX}${event.id}`,
    title: `[전사] ${event.title}`,
    description: event.description,
    date: event.date,
    endDate: event.endDate,
    time: event.time,
    endTime: event.endTime,
    categoryId: COMPANY_CATEGORY_ID,
    assigneeId: '',
    collaborators: [],
    priority: 'normal',
    status: 'scheduled',
    type: 'event',
    checklist: [],
    comments: [],
    createdBy: '',
    createdAt: event.createdAt,
  };
}
