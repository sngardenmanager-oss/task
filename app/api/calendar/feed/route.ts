import {
  isValidCalendarFeedToken,
  isValidTeamCalendarFeedToken,
} from '@/lib/calendar-feed';
import { companyEventAsTask, eventsForTeam } from '@/lib/company-events';
import { listCompanyEvents } from '@/lib/company-events-store';
import { buildCalendarIcs } from '@/lib/ical';
import { ALL_TEAMS_ID, LEGACY_TEAM_ID, normalizeEmail } from '@/lib/team-access';
import { listMemberships, listTeams } from '@/lib/team-store';
import { readAllWorkspaces, readWorkspaceState } from '@/lib/workspace-store';
import type { WorkspaceState } from '@/lib/types';

export const dynamic = 'force-dynamic';

const notFound = () => new Response('Not found', { status: 404 });

/** 전체 팀 피드: 팀마다 업무 제목 앞에 [팀 이름]을 붙여 한 캘린더로 합칩니다. */
async function allTeamsState(): Promise<WorkspaceState> {
  const [teams, workspaces] = await Promise.all([listTeams(), readAllWorkspaces()]);
  const merged: WorkspaceState = {
    members: [],
    categories: [],
    tasks: [],
    routines: [],
    notes: [],
  };
  for (const team of teams.filter((item) => item.active)) {
    const state = workspaces.get(team.id);
    if (!state) continue;
    const prefix = (id: string) => `${team.id}:${id}`;
    merged.members.push(...state.members.map((item) => ({ ...item, id: prefix(item.id) })));
    merged.categories.push(...state.categories.map((item) => ({ ...item, id: prefix(item.id) })));
    merged.tasks.push(
      ...state.tasks.map((task) => ({
        ...task,
        id: prefix(task.id),
        parentId: task.parentId ? prefix(task.parentId) : undefined,
        title: `[${team.name}] ${task.title}`,
        categoryId: prefix(task.categoryId),
        assigneeId: prefix(task.assigneeId),
        collaborators: task.collaborators.map(prefix),
      })),
    );
    merged.routines.push(
      ...state.routines.map((routine) => ({
        ...routine,
        id: prefix(routine.id),
        title: `[${team.name}] ${routine.title}`,
      })),
    );
  }
  return merged;
}

/** 구글 캘린더 등 외부 캘린더가 주기적으로 읽어 가는 iCalendar 구독 피드입니다.
 * 로그인 대신 /api/calendar/link가 발급한 서명 토큰으로 확인합니다. 팀 소속이 끝난 사람의 링크는 더 이상 나오지 않습니다.
 * 팀 값(g)이 없는 링크는 팀 분리 전에 발급된 파크사업팀 링크입니다. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const memberId = searchParams.get('m') ?? '';
  const token = searchParams.get('t') ?? '';
  const teamParam = searchParams.get('g');
  const teamId = teamParam ?? LEGACY_TEAM_ID;
  try {
    const valid = teamParam
      ? isValidTeamCalendarFeedToken(teamId, memberId, token)
      : isValidCalendarFeedToken(memberId, token);
    if (!memberId || !token || !valid) return notFound();

    const events = await listCompanyEvents().catch(() => []);
    const withCompany = (state: WorkspaceState, forTeam: string | null) => ({
      ...state,
      tasks: [
        ...state.tasks,
        ...(forTeam ? eventsForTeam(events, forTeam) : events).map(companyEventAsTask),
      ],
    });

    if (memberId === 'master' && teamParam) {
      if (teamId === ALL_TEAMS_ID)
        return ics(withCompany(await allTeamsState(), null), '스누피가든 전체 팀');
      return ics(withCompany(await readWorkspaceState(teamId), teamId));
    }
    if (teamId === ALL_TEAMS_ID) return notFound();

    const team = (await listTeams()).find((item) => item.id === teamId && item.active);
    if (!team) return notFound();
    const state = await readWorkspaceState(teamId);
    const member = state.members.find((item) => item.id === memberId);
    if (!member?.active) return notFound();
    const membership = (
      await listMemberships({ teamId, email: normalizeEmail(member.email) })
    )[0];
    if (!membership?.active) return notFound();
    return ics(withCompany(state, teamId), `스누피가든 ${team.name}`);
  } catch (error) {
    console.error('Calendar feed:', error);
    return new Response('Calendar unavailable', { status: 503 });
  }
}

function ics(state: WorkspaceState, name = '스누피가든 업무캘린더') {
  return new Response(buildCalendarIcs(state, name), {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="snoopygarden-work.ics"',
      'cache-control': 'private, max-age=300',
    },
  });
}
