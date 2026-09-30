import {
  ApiError,
  apiErrorResponse,
  authenticateRequest,
  requireMaster,
  requireWorkspaceMember,
} from '@/lib/auth-server';
import { listCompanyEvents } from '@/lib/company-events-store';
import { listTeams } from '@/lib/team-store';
import {
  readAllWorkspaces,
  updateWorkspaceState,
} from '@/lib/workspace-store';
import type { OverviewTeam } from '@/lib/types';

export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'private, no-store, max-age=0' };

/** 마스터 전용 '전체 팀' 통합 관제 데이터. 모든 활성 팀의 업무를 팀별로 묶어 돌려줍니다(읽기 전용).
 * 전송량을 줄이려고 댓글 본문과 상태 이력은 빼고 댓글 수만 남깁니다. */
export async function GET(request: Request) {
  try {
    const user = await authenticateRequest(request);
    requireMaster(user.email!);
    const [teams, workspaces, companyEvents] = await Promise.all([
      listTeams(),
      readAllWorkspaces(),
      listCompanyEvents().catch(() => []),
    ]);
    const overview: OverviewTeam[] = teams
      .filter((team) => team.active)
      .map((team) => {
        const state = workspaces.get(team.id);
        return {
          team,
          members: state?.members ?? [],
          categories: state?.categories ?? [],
          tasks: (state?.tasks ?? []).map(
            ({ comments, statusHistory: _history, ...task }) => ({
              ...task,
              comments: [],
              commentCount: comments.length,
            }),
          ),
          openNotes: (state?.notes ?? []).filter(
            (note) => !note.completed && !note.convertedTaskId,
          ).length,
        };
      });
    return Response.json({ teams: overview, companyEvents }, { headers });
  } catch (error) {
    return apiErrorResponse(error, '전체 팀 현황을 불러오지 못했습니다.');
  }
}

/** 통합 관제의 완료 요청함에서 최종 완료·반려합니다. 완료 요청 상태인 업무만 바꿉니다. */
export async function POST(request: Request) {
  try {
    const user = await authenticateRequest(request);
    requireMaster(user.email!);
    const body = (await request.json()) as {
      teamId?: string;
      taskId?: string;
      status?: 'completed' | 'in_progress';
    };
    if (
      !body.teamId ||
      !body.taskId ||
      (body.status !== 'completed' && body.status !== 'in_progress')
    )
      throw new ApiError('처리할 업무를 확인해 주세요.', 400);
    const team = (await listTeams()).find(
      (item) => item.id === body.teamId && item.active,
    );
    if (!team) throw new ApiError('팀을 찾을 수 없습니다.', 404);
    const status = body.status;
    await updateWorkspaceState(team.id, (state) => {
      const actor = requireWorkspaceMember(state, user.email!);
      const task = state.tasks.find((item) => item.id === body.taskId);
      if (!task) throw new ApiError('업무를 찾을 수 없습니다.', 404);
      if (task.status !== 'completion_requested')
        throw new ApiError('이미 처리된 완료 요청입니다.', 409);
      const at = new Date().toISOString();
      return {
        ...state,
        tasks: state.tasks.map((item) =>
          item.id === task.id
            ? {
                ...item,
                status,
                completedAt: status === 'completed' ? at : undefined,
                statusHistory: [
                  ...(item.statusHistory ?? []),
                  { at, actorId: actor.id, from: item.status, to: status },
                ],
              }
            : item,
        ),
      };
    });
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    return apiErrorResponse(error, '완료 요청을 처리하지 못했습니다.');
  }
}
