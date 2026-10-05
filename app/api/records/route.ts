import {
  ApiError,
  apiErrorResponse,
  authenticateRequest,
  requestedTeam,
  requireTeamAccess,
} from '@/lib/auth-server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { reportOwnerFor } from '@/lib/team-access';
import type { WorkDecision } from '@/lib/record-types';
import type { Task } from '@/lib/types';
import { validDay } from '@/lib/reports';

export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'private, no-store' };
async function context(request: Request) {
  const user = await authenticateRequest(request);
  const ctx = await requireTeamAccess(user.email!, requestedTeam(request));
  if (ctx.actor.role === 'commenter')
    throw new ApiError(
      '공식 기록은 업무 작성자와 관리자만 조회할 수 있습니다.',
      403,
    );
  return ctx;
}
export async function GET(request: Request) {
  try {
    const { team } = await context(request);
    const params = new URL(request.url).searchParams;
    const db = getSupabaseAdmin();
    if (params.get('kind') === 'archive') {
      const id = params.get('reportId');
      let query = db
        .from('report_archive')
        .select(
          id
            ? 'report_id,payload,archived_at'
            : 'report_id,archived_at,config:payload->config,revision:payload->revision,workflow:payload->workflow,status:payload->status',
        )
        .eq('owner_id', reportOwnerFor(team.id));
      if (id) query = query.eq('report_id', id);
      if (params.get('q'))
        query = query.ilike(
          'payload->config->>title',
          `%${params.get('q')!.replace(/[%_]/g, '')}%`,
        );
      const page = Math.max(
        0,
        Math.min(10000, Math.floor(Number(params.get('page')) || 0)),
      );
      const { data, error } = await query
        .order('archived_at', { ascending: false })
        .order('report_id')
        .range(page * 20, page * 20 + 19);
      if (error) throw error;
      return Response.json({ items: data }, { headers });
    }
    if (params.get('kind') === 'decisions') {
      let query = db
        .from('work_decisions')
        .select('id,version,payload,updated_at')
        .eq('team_id', team.id);
      if (params.get('reportId'))
        query = query.eq('payload->>reportId', params.get('reportId')!);
      const { data, error } = await query
        .order('updated_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return Response.json({ items: data }, { headers });
    }
    const id = params.get('id');
    let query = db
      .from('work_records')
      .select(
        id
          ? '*'
          : 'id,team_id,entity_type,entity_id,title,action,actor,recorded_at,task_ids',
      )
      .eq('team_id', team.id);
    if (id) query = query.eq('id', id);
    if (params.get('taskId'))
      query = query.contains('task_ids', [params.get('taskId')!]);
    if (params.get('reportId'))
      query = query
        .eq('entity_type', 'report')
        .eq('entity_id', params.get('reportId')!);
    if (params.get('type'))
      query = query.eq('entity_type', params.get('type')!);
    if (params.get('q'))
      query = query.ilike(
        'search_text',
        `%${params.get('q')!.replace(/[%_]/g, '')}%`,
      );
    if (params.get('from') && /^\d{4}-\d{2}-\d{2}$/.test(params.get('from')!))
      query = query.gte('recorded_at', params.get('from')! + 'T00:00:00+09:00');
    if (params.get('to') && /^\d{4}-\d{2}-\d{2}$/.test(params.get('to')!))
      query = query.lte(
        'recorded_at',
        params.get('to')! + 'T23:59:59.999+09:00',
      );
    const page = Math.max(0, Math.min(10000, Math.floor(Number(params.get('page')) || 0)));
    const { data, error } = await query
      .order('recorded_at', { ascending: false })
      .order('id')
      .range(page * 20, page * 20 + 19);
    if (error) throw error;
    return Response.json({ items: data }, { headers });
  } catch (error) {
    return apiErrorResponse(error, '기록을 불러오지 못했습니다.');
  }
}

export async function POST(request: Request) {
  try {
    const { team, actor, state } = await context(request);
    const input = (await request.json()) as {
      id: string;
      version: number;
      requestId: string;
      payload: WorkDecision['payload'];
      createTask?: boolean;
    };
    if (
      !input ||
      !/^[a-zA-Z0-9_-]{8,100}$/.test(input.id ?? '') ||
      !/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestId ?? '') ||
      !Number.isInteger(input.version)
    )
      throw new ApiError('요청 정보를 확인해 주세요.', 400);
    const db = getSupabaseAdmin();
    const { data: existing, error: readError } = await db
      .from('work_decisions')
      .select('id,payload,version,audit_context,updated_at')
      .eq('team_id', team.id)
      .eq('id', input.id)
      .maybeSingle();
    if (readError) throw readError;
    if (
      existing?.audit_context?.requestId === input.requestId &&
      existing.audit_context.id === actor.id
    )
      return Response.json({ decision: existing, task: input.createTask ? state.tasks.find(task => task.id === `decision-${input.id}`) ?? null : null }, { headers });
    if ((existing?.version ?? 0) !== input.version)
      throw new ApiError('동시 변경이 있습니다. 새로고침 후 다시 확인해 주세요.', 409);
    const p = input.payload;
    if (
      !p ||
      typeof p.title !== 'string' ||
      !p.title.trim() ||
      p.title.length > 300 ||
      typeof p.body !== 'string' ||
      p.body.length > 10000 ||
      typeof p.reason !== 'string' ||
      p.reason.length > 4000 ||
      !p.reason.trim()
    )
      throw new ApiError(
        '결정 제목·내용과 등록 또는 변경 사유를 입력해 주세요.',
        400,
      );
    if (
      !['open', 'done', 'on_hold'].includes(p.status) ||
      !Array.isArray(p.taskIds) ||
      p.taskIds.length > 50 ||
      !p.taskIds.every(
        (id) =>
          typeof id === 'string' && state.tasks.some((task) => task.id === id),
      )
    )
      throw new ApiError('조치 상태와 연결 업무를 확인해 주세요.', 400);
    if (
      !state.members.some(
        (member) => member.id === p.assigneeId && member.active,
      )
    )
      throw new ApiError('활성 조치 담당자를 선택해 주세요.', 400);
    if (
      typeof p.dueDate !== 'string' || !validDay(p.dueDate)
    )
      throw new ApiError('조치 기한을 입력해 주세요.', 400);
    if (
      typeof p.result !== 'string' ||
      p.result.length > 10000 ||
      typeof p.evidence !== 'string' ||
      p.evidence.length > 2000 ||
      (p.evidence && !/^https?:\/\//i.test(p.evidence))
    )
      throw new ApiError('결과와 증빙 링크를 확인해 주세요.', 400);
    if (actor.role !== 'admin') {
      if (!existing || existing.payload.assigneeId !== actor.id)
        throw new ApiError(
          '결정 등록은 관리자, 결과 등록은 조치 담당자가 처리합니다.',
          403,
        );
      for (const key of [
        'title',
        'body',
        'reportId',
        'taskIds',
        'assigneeId',
        'dueDate',
        'status',
        'supersedesId',
      ] as const)
        if (JSON.stringify(p[key]) !== JSON.stringify(existing.payload[key]))
          throw new ApiError('담당자는 결과와 근거만 등록할 수 있습니다.', 403);
    }
    if (p.status === 'done' && (!p.result.trim() || actor.role !== 'admin'))
      throw new ApiError('관리자가 조치 결과를 확인한 뒤 종료해 주세요.', 400);
    const reportId = existing?.payload.reportId ?? p.reportId;
    if (typeof reportId !== 'string' || !reportId)
      throw new ApiError('확정된 보고서를 선택해 주세요.', 400);
    const { data: report, error: archiveError } = await db
      .from('report_archive')
      .select('report_id')
      .eq('owner_id', reportOwnerFor(team.id))
      .eq('report_id', reportId)
      .maybeSingle();
    if (archiveError) throw archiveError;
    if (!report)
      throw new ApiError(
        '이 팀의 확정 보고서에만 결정을 기록할 수 있습니다.',
        400,
      );
    if (p.supersedesId) {
      const { data: prior } = await db
        .from('work_decisions')
        .select('id')
        .eq('team_id', team.id)
        .eq('id', p.supersedesId)
        .maybeSingle();
      if (!prior || p.supersedesId === input.id)
        throw new ApiError('이전 결정 연결을 확인해 주세요.', 400);
    }
    const now = new Date().toISOString();
    let task: Task | null = null;
    if (input.createTask && !existing && actor.role === 'admin') {
      task = {
        id: `decision-${input.id}`,
        title: p.title.trim(),
        description: `${p.body}\n완료 기준 및 사유: ${p.reason}\n보고 번호: ${reportId}`,
        date: p.dueDate,
        categoryId: state.categories.find((c) => c.active)?.id ?? '',
        assigneeId: p.assigneeId,
        collaborators: [],
        priority: 'normal',
        status: 'scheduled',
        type: 'task',
        checklist: [],
        comments: [],
        createdBy: actor.id,
        createdAt: now,
      };
    }
    const payload = {
      title: p.title.trim(),
      body: p.body,
      reason: p.reason,
      reportId,
      taskIds: [...new Set([...p.taskIds, ...(task ? [task.id] : [])])],
      assigneeId: p.assigneeId,
      dueDate: p.dueDate,
      status: p.status,
      evidence: p.evidence,
      result: p.result,
      decidedBy: existing?.payload.decidedBy ?? actor.name,
      decidedAt: existing?.payload.decidedAt ?? now,
      updatedBy: actor.name,
      ...(p.supersedesId ? { supersedesId: p.supersedesId } : {}),
    };
    const { data: decision, error } = await db.rpc('save_work_decision', {
      p_team: team.id,
      p_id: input.id,
      p_version: input.version,
      p_data: payload,
      p_actor: {
        id: actor.id,
        name: actor.name,
        role: actor.role,
        requestId: input.requestId,
        action: existing ? '결정·조치 변경' : '결정 등록',
        note: p.reason,
      },
      p_task: task,
    });
    if (error) {
      if (error.code === 'PT409' || error.code === '40001' || error.code === '23505')
        throw new ApiError(
          '동시 변경이 있습니다. 새로고침 후 다시 확인해 주세요.',
          409,
        );
      throw error;
    }
    return Response.json({ decision, task }, { headers });
  } catch (error) {
    return apiErrorResponse(error, '결정과 후속 조치를 저장하지 못했습니다.');
  }
}
