import {
  ApiError,
  apiErrorResponse,
  authenticateRequest,
  masterEmailCount,
  requestedTeam,
  requireTeamAccess,
} from '@/lib/auth-server';
import { eventsForTeam } from '@/lib/company-events';
import { listCompanyEvents } from '@/lib/company-events-store';
import { keepRetiredMembers, planMembershipSync } from '@/lib/team-access';
import {
  deactivateMembership,
  listMemberships,
  upsertMembership,
} from '@/lib/team-store';
import { mergeIncomingState, updateProblem } from '@/lib/workspace-merge';
import { updateWorkspaceState, WorkspaceConflict } from '@/lib/workspace-store';
import type { Member, WorkspaceState } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** 팀 작업공간의 members 변경(퇴사 처리·역할 변경)을 소속 기준표에 반영합니다. */
async function syncMemberships(teamId: string, members: Member[]) {
  const memberships = await listMemberships({ teamId });
  for (const change of planMembershipSync(teamId, members, memberships)) {
    if (change.kind === 'deactivate')
      await deactivateMembership(teamId, change.email);
    else await upsertMembership(change.membership);
  }
}

export async function GET(request: Request) {
  try {
    const user = await authenticateRequest(request);
    const { state, actor, team, teams, isMaster } = await requireTeamAccess(
      user.email!,
      requestedTeam(request),
    );
    // 전사 일정은 부가 정보라, 읽기에 실패해도 업무 화면은 열리게 합니다.
    const companyEvents = await listCompanyEvents()
      .then((events) => eventsForTeam(events, team.id))
      .catch((error: unknown) => {
        console.error(error);
        return [];
      });
    return Response.json(
      {
        state,
        actor,
        team,
        teams,
        isMaster,
        companyEvents,
        // 로그인 확인 칸은 마스터에게만 보이므로 마스터 설정 개수도 마스터에게만 보냅니다.
        signedInEmail: user.email!.toLowerCase(),
        masterConfigured: isMaster ? masterEmailCount() : 0,
        pendingRegistrations: [],
      },
      { headers: { 'cache-control': 'private, no-store, max-age=0' } },
    );
  } catch (error) {
    return apiErrorResponse(error, '데이터를 불러오지 못했습니다.');
  }
}

export async function PUT(request: Request) {
  try {
    const [user, incoming] = await Promise.all([
      authenticateRequest(request),
      request.json() as Promise<{
        state?: WorkspaceState;
        deletedIds?: string[];
      }>,
    ]);
    if (!incoming.state) {
      return Response.json(
        { error: '저장할 데이터가 없습니다.' },
        { status: 400 },
      );
    }

    const { actor, team, state, version } = await requireTeamAccess(
      user.email!,
      requestedTeam(request),
    );
    const deletedIds = new Set(
      (incoming.deletedIds ?? []).filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      ),
    );
    if (deletedIds.size > 0 && actor.role !== 'admin') {
      throw new ApiError('삭제는 관리자만 할 수 있습니다.', 403);
    }
    const incomingState = incoming.state;
    let result;
    try {
      // 저장 직전에 다른 저장이 끼어들었으면 최신 값으로 다시 합칩니다(동시 저장 보호).
      result = await updateWorkspaceState(team.id, (before) => {
        const merged = mergeIncomingState(before, incomingState, deletedIds, actor.role);
        merged.members = keepRetiredMembers(before.members, merged.members);
        const problem = updateProblem(before, merged, actor);
        if (problem) throw new ApiError(problem, 403);
        const changedAt = new Date().toISOString();
        merged.tasks = merged.tasks.map((task) => {
          const previous = before.tasks.find((item) => item.id === task.id);
          if (!previous || previous.status === task.status) return task;
          return {
            ...task,
            completedAt: task.status === 'completed' ? changedAt : undefined,
            statusHistory: [
              ...(previous.statusHistory ?? []),
              { at: changedAt, actorId: actor.id, from: previous.status, to: task.status },
            ],
          };
        });
        return merged;
      }, { state, version, audit: { id: actor.id, name: actor.name, role: actor.role } });
    } catch (error) {
      if (error instanceof WorkspaceConflict) throw new ApiError(error.message, 503);
      throw error;
    }
    const { before, after: mergedState, persisted } = result;
    if (
      persisted &&
      JSON.stringify(before.members) !== JSON.stringify(mergedState.members)
    )
      await syncMemberships(team.id, mergedState.members);
    return Response.json(
      { ok: true, localOnly: !persisted, actor, state: mergedState },
      { headers: { 'cache-control': 'private, no-store, max-age=0' } },
    );
  } catch (error) {
    return apiErrorResponse(error, '저장하지 못했습니다.');
  }
}
