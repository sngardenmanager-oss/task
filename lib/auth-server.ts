import { createClient, type User } from '@supabase/supabase-js';
import { resolveTeamAccess, TeamAccessError } from '@/lib/team-access';
import { listMemberships, listTeams } from '@/lib/team-store';
import { readWorkspaceRow } from '@/lib/workspace-store';
import type { Member, Team, WorkspaceState } from '@/lib/types';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

function publicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY;
  return { url, key };
}

export async function authenticateRequest(request: Request): Promise<User> {
  const authorization = request.headers.get('authorization');
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new ApiError('로그인이 필요합니다.', 401);

  const { url, key } = publicSupabaseConfig();
  if (!url || !key)
    throw new ApiError('로그인 서비스가 설정되지 않았습니다.', 503);

  const supabase = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.email)
    throw new ApiError('로그인 세션이 만료되었습니다.', 401);
  return data.user;
}

function masterEmails() {
  const configured = (process.env.MASTER_EMAILS ?? '')
    .split(',')
    .map((candidate) => candidate.trim().replace(/^["']|["']$/g, '').trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...DEFAULT_MASTER_EMAILS, ...configured])];
}

/** 기본 마스터 계정. 서버 환경변수(MASTER_EMAILS)에 적은 이메일은 여기에 더해집니다. */
const DEFAULT_MASTER_EMAILS = ['sn.gardenmanager@gmail.com'];

export function isMasterEmail(email: string) {
  return masterEmails().includes(email.trim().toLowerCase());
}

/** 서버에 마스터 이메일이 몇 개 설정되어 있는지(값은 알리지 않음). 설정 화면의 로그인 확인용입니다. */
export function masterEmailCount() {
  return masterEmails().length;
}

export function requireWorkspaceMember(
  state: WorkspaceState,
  email: string,
): Member {
  const member = state.members.find(
    (candidate) => candidate.email.toLowerCase() === email.toLowerCase(),
  );
  if (isMasterEmail(email)) {
    return member
      ? { ...member, role: 'admin', active: true }
      : {
          id: 'system-master',
          // 다른 팀에서 활동할 때 보이는 이름. 마스터라는 사실을 드러내지 않습니다.
          name: '운영지원',
          email: email.toLowerCase(),
          role: 'admin',
          team: '전체',
          active: true,
        };
  }
  if (!member) {
    throw new ApiError(
      '가입 신청이 접수되어 관리자 승인을 기다리고 있습니다.',
      403,
      'approval_pending',
    );
  }
  if (!member.active) {
    throw new ApiError(
      '비활성화된 계정입니다. 관리자에게 문의해 주세요.',
      403,
      'account_inactive',
    );
  }
  return member;
}

export type TeamContext = {
  team: Team;
  /** 이 사람이 들어갈 수 있는 팀. 마스터는 모든 활성 팀, 그 밖에는 자기 팀 하나입니다. */
  teams: Team[];
  state: WorkspaceState;
  /** 읽은 시점의 행 버전. 저장할 때 동시 저장 확인에 씁니다. */
  version: string | null;
  actor: Member;
  isMaster: boolean;
};

/** 요청한 팀(없으면 기본 팀)에 들어갈 수 있는지 확인하고, 그 팀 작업공간과 팀 안에서의 역할을 돌려줍니다.
 * 팀 검사는 모든 API가 이 함수 한 곳에서 합니다. */
export async function requireTeamAccess(
  email: string,
  requestedTeamId?: string | null,
): Promise<TeamContext> {
  const isMaster = isMasterEmail(email);
  const [teams, memberships] = await Promise.all([
    listTeams(),
    isMaster ? Promise.resolve([]) : listMemberships({ email }),
  ]);
  let resolved: ReturnType<typeof resolveTeamAccess>;
  try {
    resolved = resolveTeamAccess({
      email,
      isMaster,
      requestedTeamId,
      teams,
      memberships,
    });
  } catch (error) {
    if (error instanceof TeamAccessError)
      throw new ApiError(error.message, error.status, error.code);
    throw error;
  }
  const { state, version } = await readWorkspaceRow(resolved.team.id);
  const actor = requireWorkspaceMember(state, email);
  return {
    team: resolved.team,
    teams: resolved.accessibleTeams,
    state,
    version,
    actor,
    isMaster,
  };
}

/** 요청 URL의 ?team= 값을 읽습니다. */
export function requestedTeam(request: Request) {
  return new URL(request.url).searchParams.get('team');
}

export function requireMaster(email: string) {
  if (!isMasterEmail(email))
    throw new ApiError('권한이 없습니다.', 403);
}

export function apiErrorResponse(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  const message = error instanceof Error ? error.message : fallback;
  console.error(message);
  return Response.json({ error: fallback }, { status: 500 });
}
