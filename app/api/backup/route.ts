import {
  ApiError,
  apiErrorResponse,
  authenticateRequest,
  requireMaster,
} from '@/lib/auth-server';
import {
  readSetting,
  readStorageSizes,
  SettingsUnavailable,
  writeSetting,
} from '@/lib/app-settings-store';
import { listCompanyEvents } from '@/lib/company-events-store';
import { dismissMasterAlert, listMasterAlerts } from '@/lib/master-alerts';
import type { ReportStore } from '@/lib/report-types';
import { isBackupDue, prunableReportIds, removeReports } from '@/lib/retention';
import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase-server';
import { reportOwnerFor } from '@/lib/team-access';
import { listTeams } from '@/lib/team-store';
import { readWorkspaceState } from '@/lib/workspace-store';

export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'private, no-store, max-age=0' };
const LAST_BACKUP_KEY = 'last_backup';
type LastBackup = { at: string; by: string; completedAt: string };
type ReportRow = { version: number; payload: ReportStore };

async function readReportRow(teamId: string): Promise<ReportRow | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseAdmin()
    .from('weekly_report_state')
    .select('version,payload')
    .eq('owner_id', reportOwnerFor(teamId))
    .maybeSingle<ReportRow>();
  if (error) throw new Error(`Supabase report read failed: ${error.message}`);
  return data;
}

/** 마스터 전용.
 * - ?team=<id> : 그 팀의 백업 자료(업무 전체 + 주간보고서 저장소). 한 번에 4.5MB를 넘지 않게 팀별로 나눠 받습니다.
 * - 없으면 : 마지막 백업 시각, 이번 달 알림 여부, 저장소 크기(용량 경고용) */
export async function GET(request: Request) {
  try {
    const user = await authenticateRequest(request);
    requireMaster(user.email!);
    const teamId = new URL(request.url).searchParams.get('team');
    if (teamId) {
      const team = (await listTeams()).find((item) => item.id === teamId);
      if (!team) throw new ApiError('팀을 찾을 수 없습니다.', 404);
      const [workspace, report] = await Promise.all([
        readWorkspaceState(team.id),
        readReportRow(team.id),
      ]);
      return Response.json(
        { team, workspace, reportStore: report?.payload ?? null },
        { headers },
      );
    }
    const [lastBackup, sizes, teams, companyEvents, alerts] = await Promise.all([
      readSetting<LastBackup>(LAST_BACKUP_KEY),
      readStorageSizes().catch(() => []),
      listTeams(),
      listCompanyEvents().catch(() => []),
      listMasterAlerts().catch(() => []),
    ]);
    return Response.json(
      {
        lastBackupAt: lastBackup?.at ?? null,
        due: isBackupDue(new Date(), lastBackup?.at),
        teams: teams.filter((team) => team.active),
        companyEvents,
        alerts,
        sizes: sizes.map((size) => ({
          ...size,
          teamId:
            size.kind === 'workspace'
              ? size.key
              : (teams.find((team) => reportOwnerFor(team.id) === size.key)?.id ?? null),
        })),
      },
      { headers },
    );
  } catch (error) {
    return apiErrorResponse(error, '백업 정보를 불러오지 못했습니다.');
  }
}

/** 백업 완료 기록. prune=true이면 이번 백업에 포함된 확정 1개월 지난 주간보고서를 정리합니다.
 * 백업을 하지 않으면 이 요청이 오지 않으므로 아무것도 지워지지 않습니다. */
export async function POST(request: Request) {
  try {
    const user = await authenticateRequest(request);
    requireMaster(user.email!);
    const body = (await request.json()) as {
      action?: 'dismissAlert';
      id?: string;
      startedAt?: string;
      prune?: boolean;
    };
    if (body.action === 'dismissAlert') {
      if (!body.id) throw new ApiError('알림을 확인해 주세요.', 400);
      await dismissMasterAlert(body.id);
      return Response.json({ alerts: await listMasterAlerts() }, { headers });
    }
    const startedAt = body.startedAt ?? '';
    const started = Date.parse(startedAt);
    const now = new Date();
    if (
      !Number.isFinite(started) ||
      started > now.getTime() + 60_000 ||
      now.getTime() - started > 6 * 60 * 60 * 1000
    )
      throw new ApiError('백업 시작 시각을 확인해 주세요. 백업을 다시 해 주세요.', 400);

    try {
      await writeSetting(LAST_BACKUP_KEY, {
        at: new Date(started).toISOString(),
        by: user.email!.toLowerCase(),
        completedAt: now.toISOString(),
      } satisfies LastBackup);
    } catch (error) {
      if (error instanceof SettingsUnavailable) throw new ApiError(error.message, 503);
      throw error;
    }

    const removed: Record<string, number> = {};
    if (body.prune && isSupabaseConfigured()) {
      const db = getSupabaseAdmin();
      for (const team of (await listTeams()).filter((item) => item.active)) {
        // 다른 사람이 동시에 보고서를 저장해도 덮어쓰지 않도록 버전을 확인하며 최대 4번 시도합니다.
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const row = await readReportRow(team.id);
          if (!row) break;
          const ids = prunableReportIds(row.payload, now, new Date(started).toISOString());
          if (!ids.length) break;
          const { data, error } = await db
            .from('weekly_report_state')
            .update({
              version: row.version + 1,
              payload: removeReports(row.payload, ids),
              updated_at: now.toISOString(),
            })
            .eq('owner_id', reportOwnerFor(team.id))
            .eq('version', row.version)
            .select('version')
            .maybeSingle();
          if (error) throw new Error(`Supabase report prune failed: ${error.message}`);
          if (data) {
            removed[team.id] = ids.length;
            break;
          }
        }
      }
    }
    return Response.json({ ok: true, removed }, { headers });
  } catch (error) {
    return apiErrorResponse(error, '백업 기록을 저장하지 못했습니다.');
  }
}
