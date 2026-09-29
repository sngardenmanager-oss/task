'use client';

import { useCallback, useEffect, useState } from 'react';
import { DatabaseBackup, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ReportStore } from '@/lib/report-types';
import {
  HARD_LIMIT_BYTES,
  prunableReportIds,
  WARNING_BYTES,
} from '@/lib/retention';
import type { CompanyEvent, Team, WorkspaceState } from '@/lib/types';

type Status = {
  lastBackupAt: string | null;
  due: boolean;
  teams: Team[];
  companyEvents: CompanyEvent[];
  sizes: { kind: 'workspace' | 'report'; teamId: string | null; bytes: number }[];
};
type TeamBackup = { team: Team; workspace: WorkspaceState; reportStore: ReportStore | null };
type Step =
  | { kind: 'idle' }
  | { kind: 'working'; label: string }
  | { kind: 'confirm'; startedAt: string; prunable: number }
  | { kind: 'done'; message: string };

const dismissKey = 'snoopy-backup-dismissed';
/** 요청 한도(4.5MB)와 같은 단위로 보이도록 1MB = 1,000,000바이트로 표시합니다. */
const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)}MB`;

/** 마스터 전용: 매월 1~3일 백업 알림, 전체 백업(업무·주간보고서 엑셀 + 복원용 파일), 용량 80% 경고.
 * 백업을 마쳐야만 확정 1개월 지난 주간보고서가 정리됩니다. 백업하지 않으면 아무것도 지워지지 않습니다. */
export default function BackupReminder({
  accessToken,
  teams: knownTeams,
  className = '',
  showManual = false,
}: {
  accessToken: string;
  teams: Team[];
  className?: string;
  /** 알림 기간이 아니어도 '전체 백업' 버튼을 보여 줍니다(전체 팀 화면). */
  showManual?: boolean;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [error, setError] = useState('');

  const call = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(path, {
        ...init,
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(init?.body ? { 'content-type': 'application/json' } : {}),
        },
        cache: 'no-store',
      });
      const result = (await response.json()) as T & { error?: string };
      if (!response.ok) throw new Error(result.error ?? '백업 요청을 처리하지 못했습니다.');
      return result;
    },
    [accessToken],
  );

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await call<Status>('/api/backup'));
    } catch {
      // 알림은 부가 기능이라 실패해도 조용히 넘어갑니다.
    }
  }, [call]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        // '나중에'는 이 기기에서 오늘 하루만 숨깁니다. 1~3일 동안은 날마다 다시 알립니다.
        const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
        setDismissed(window.localStorage.getItem(dismissKey) === today);
      } catch {
        // 무시
      }
      void loadStatus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadStatus]);

  async function runBackup() {
    setError('');
    const startedAt = new Date().toISOString();
    try {
      const teams = status?.teams.length ? status.teams : knownTeams;
      const backups: TeamBackup[] = [];
      for (const [index, team] of teams.entries()) {
        setStep({ kind: 'working', label: `${team.name} 자료 받는 중 (${index + 1}/${teams.length})` });
        backups.push(await call<TeamBackup>(`/api/backup?team=${encodeURIComponent(team.id)}`));
      }
      setStep({ kind: 'working', label: '백업 파일 만드는 중' });
      const stamp = startedAt.slice(0, 10);
      await downloadWorkbook(`스누피가든_전체업무_백업_${stamp}.xlsx`, (book) =>
        fillTaskWorkbook(book, backups, status?.companyEvents ?? []),
      );
      await downloadWorkbook(`스누피가든_주간보고서_백업_${stamp}.xlsx`, (book) =>
        fillReportWorkbook(book, backups),
      );
      download(
        `스누피가든_복원용_${stamp}.json`,
        new Blob(
          [JSON.stringify({ exportedAt: startedAt, teams: backups, companyEvents: status?.companyEvents ?? [] })],
          { type: 'application/json' },
        ),
      );
      const prunable = backups.reduce(
        (sum, item) =>
          sum + (item.reportStore ? prunableReportIds(item.reportStore, new Date(), startedAt).length : 0),
        0,
      );
      setStep({ kind: 'confirm', startedAt, prunable });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '백업하지 못했습니다.');
      setStep({ kind: 'idle' });
    }
  }

  async function complete(startedAt: string, prune: boolean) {
    setStep({ kind: 'working', label: '백업 기록 저장 중' });
    try {
      const result = await call<{ removed: Record<string, number> }>('/api/backup', {
        method: 'POST',
        body: JSON.stringify({ startedAt, prune }),
      });
      const removed = Object.values(result.removed).reduce((a, b) => a + b, 0);
      setStep({
        kind: 'done',
        message: prune
          ? `백업을 기록했습니다. 확정 1개월 지난 주간보고서 ${removed}건을 정리했습니다.`
          : '백업을 기록했습니다. 주간보고서는 정리하지 않았습니다.',
      });
      await loadStatus();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '백업 기록을 저장하지 못했습니다.');
      setStep({ kind: 'idle' });
    }
  }

  const teamName = (id: string | null) =>
    status?.teams.find((team) => team.id === id)?.name ?? knownTeams.find((team) => team.id === id)?.name ?? '팀';
  const warnings = (status?.sizes ?? []).filter((size) => size.bytes >= WARNING_BYTES);
  const showReminder = status?.due && !dismissed;
  if (!status || (!showReminder && !warnings.length && !showManual && step.kind === 'idle' && !error))
    return null;

  return (
    <div className={`space-y-3 ${className}`}>
      {warnings.map((size) => (
        <div
          key={`${size.kind}:${size.teamId}`}
          role="alert"
          className="flex items-start gap-2 rounded-2xl border border-[#e7b9b2] bg-[#fbeeeb] p-4 text-sm text-[#8d342e]"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong>용량 경고 · {teamName(size.teamId)} {size.kind === 'report' ? '주간보고서' : '업무'}</strong>
            {' '}한 번에 저장하는 양이 {mb(size.bytes)}로 한도 {mb(HARD_LIMIT_BYTES)}의{' '}
            {Math.round((size.bytes / HARD_LIMIT_BYTES) * 100)}%입니다.{' '}
            {size.kind === 'report'
              ? '전체 백업을 하면 확정 1개월 지난 보고서가 정리되어 줄어듭니다.'
              : '오래된 업무 정리가 필요합니다. 개발 담당에게 알려 주세요.'}
          </span>
        </div>
      ))}

      {(showReminder || showManual || step.kind !== 'idle' || error) && (
        <section className="rounded-2xl border border-[#c9d9cf] bg-[#eef5f0] p-4 text-sm text-[#26352d]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <DatabaseBackup className="size-5 shrink-0 text-[#2f6b4f]" />
            <span className="flex-1">
              <strong className="block">
                {showReminder ? '매월 백업 · 전체 업무와 전체 팀 주간보고서를 백업할까요?' : '전체 백업'}
              </strong>
              {step.kind === 'working' ? (
                <span className="flex items-center gap-1.5 text-[#5f6d64]">
                  <LoaderCircle className="size-3.5 animate-spin" /> {step.label}
                </span>
              ) : step.kind === 'done' ? (
                <span className="text-[#2f6b4f]">{step.message}</span>
              ) : (
                <span className="text-[#5f6d64]">
                  업무 엑셀·주간보고서 엑셀·복원용 파일을 내려받습니다. 백업해야만 확정 1개월 지난 주간보고서가 정리됩니다.
                  {status.lastBackupAt
                    ? ` 마지막 백업: ${new Date(status.lastBackupAt).toLocaleString('ko-KR')}`
                    : ' 아직 백업 기록이 없습니다.'}
                </span>
              )}
            </span>
            {step.kind === 'idle' && (
              <div className="flex gap-2">
                <Button onClick={() => void runBackup()}>
                  <DatabaseBackup />
                  지금 백업
                </Button>
                {showReminder && (
                  <Button
                    variant="outline"
                    className="bg-white"
                    onClick={() => {
                      try {
                        window.localStorage.setItem(
                          dismissKey,
                          new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }),
                        );
                      } catch {
                        // 무시
                      }
                      setDismissed(true);
                    }}
                  >
                    <X />
                    오늘은 나중에
                  </Button>
                )}
              </div>
            )}
          </div>
          {step.kind === 'confirm' && (
            <div className="mt-3 rounded-xl bg-white p-3">
              <p>
                백업 파일 3개를 내려받았습니다. <strong>회사 공유 드라이브 등 안전한 곳으로 옮겨 주세요.</strong>
              </p>
              <p className="mt-1">
                확정한 지 1개월이 지난 주간보고서 <strong>{step.prunable}건</strong>이 이번 백업에 들어 있습니다.
                정리하면 앱 화면에서는 사라지고 백업 파일로 보게 됩니다.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => void complete(step.startedAt, true)}>
                  {step.prunable ? `${step.prunable}건 정리하고 백업 완료` : '백업 완료'}
                </Button>
                {step.prunable > 0 && (
                  <Button variant="outline" onClick={() => void complete(step.startedAt, false)}>
                    정리하지 않고 백업만 완료
                  </Button>
                )}
              </div>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-2 rounded-lg bg-[#f7e8e4] px-3 py-2 text-xs font-semibold text-[#8d342e]">
              {error}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Book = import('exceljs').Workbook;

async function downloadWorkbook(name: string, fill: (book: Book) => void) {
  const excelModule = await import('exceljs');
  const ExcelJS = excelModule.default ?? excelModule;
  const book = new ExcelJS.Workbook();
  fill(book);
  const buffer = await book.xlsx.writeBuffer();
  download(
    name,
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  );
}

/** 엑셀 시트 이름 규칙(31자, 금지 문자, 중복 불가)에 맞춥니다. */
function sheetNamer() {
  const used = new Set<string>();
  return (raw: string) => {
    const base = raw.replace(/[[\]:*?/\\]/g, ' ').slice(0, 28);
    let name = base;
    for (let n = 2; used.has(name); n += 1) name = `${base.slice(0, 25)}_${n}`;
    used.add(name);
    return name;
  };
}

function addSheet(book: Book, name: string, header: string[], rows: unknown[][], widths: number[]) {
  const sheet = book.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.addRow(header).font = { name: '맑은 고딕', size: 10, bold: true };
  for (const row of rows) sheet.addRow(row);
  sheet.columns.forEach((column, index) => {
    column.width = widths[index] ?? 14;
  });
}

const statusName = { scheduled: '예정', in_progress: '진행 중', completion_requested: '완료 요청', completed: '최종 완료' };

function fillTaskWorkbook(book: Book, backups: TeamBackup[], events: CompanyEvent[]) {
  const name = sheetNamer();
  for (const { team, workspace } of backups) {
    const person = (id: string) => workspace.members.find((m) => m.id === id)?.name ?? '';
    const category = (id: string) => workspace.categories.find((c) => c.id === id)?.name ?? '';
    addSheet(
      book,
      name(`${team.name}_업무`),
      ['시작일', '종료일', '시간', '업무', '분류', '담당', '협업', '상태', '우선순위', '설명', '체크리스트', '댓글', '완료일'],
      workspace.tasks
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((task) => [
          task.date,
          task.endDate ?? '',
          task.time ? `${task.time}${task.endTime ? `~${task.endTime}` : ''}` : '',
          task.title,
          category(task.categoryId),
          person(task.assigneeId),
          task.collaborators.map(person).join(', '),
          statusName[task.status],
          { urgent: '긴급', normal: '보통', low: '낮음' }[task.priority],
          task.description,
          task.checklist.map((item) => `${item.done ? '✓' : '□'} ${item.text}`).join('\n'),
          task.comments.map((c) => `${person(c.authorId)}: ${c.body}`).join('\n'),
          task.completedAt?.slice(0, 10) ?? '',
        ]),
      [11, 11, 11, 32, 12, 10, 16, 10, 8, 40, 30, 30, 11],
    );
    addSheet(
      book,
      name(`${team.name}_특이사항`),
      ['번호', '날짜', '위치', '분류', '내용', '긴급', '완료', '업무 전환'],
      workspace.notes.map((note) => [
        note.label,
        note.date,
        note.location,
        category(note.categoryId),
        note.body,
        note.urgent ? '긴급' : '',
        note.completed ? '완료' : '',
        note.convertedTaskId ? '전환됨' : '',
      ]),
      [22, 11, 14, 12, 50, 6, 6, 9],
    );
    addSheet(
      book,
      name(`${team.name}_루틴`),
      ['루틴', '반복', '다음 실행일', '담당', '사용', '체크리스트'],
      workspace.routines.map((routine) => [
        routine.title,
        routine.cadence,
        routine.nextDate,
        person(routine.assigneeId),
        routine.active ? '사용' : '중단',
        routine.checklist.join('\n'),
      ]),
      [30, 14, 12, 10, 6, 40],
    );
  }
  addSheet(
    book,
    name('전사일정'),
    ['시작일', '종료일', '시간', '일정', '대상 팀', '내용'],
    events.map((event) => [
      event.date,
      event.endDate ?? '',
      event.time ?? '',
      event.title,
      event.teamIds.length
        ? event.teamIds.map((id) => backups.find((b) => b.team.id === id)?.team.name ?? id).join(', ')
        : '모든 팀',
      event.description,
    ]),
    [11, 11, 8, 30, 20, 40],
  );
}

function fillReportWorkbook(book: Book, backups: TeamBackup[]) {
  const name = sheetNamer();
  let count = 0;
  for (const { team, reportStore } of backups) {
    for (const report of [...(reportStore?.reports ?? [])].sort((a, b) =>
      a.config.meetingDate.localeCompare(b.config.meetingDate),
    )) {
      count += 1;
      const sheet = book.addWorksheet(
        name(`${team.name}_${report.config.meetingDate}_${report.status === 'final' ? '확정' : '초안'}`),
      );
      const bold = { name: '맑은 고딕', size: 10, bold: true };
      sheet.addRow([report.config.title]).font = { ...bold, size: 12 };
      sheet.addRow([
        `${team.name} · 회의일 ${report.config.meetingDate} · 작성 ${report.config.author} · ${report.status === 'final' ? `확정 ${report.finalizedAt?.slice(0, 10) ?? ''}` : '초안'}`,
      ]);
      sheet.addRow([
        `실적 ${report.config.actualStart}~${report.config.actualEnd} / 계획 ${report.config.planStart}~${report.config.planEnd}`,
      ]);
      sheet.addRow([]);
      sheet.addRow(['구분', '분류', '업무', '담당', '날짜', '상태', '요약', '다음 조치', '후속·지연 사유']).font = bold;
      for (const row of report.rows.filter((item) => item.visible))
        sheet.addRow([
          row.section === 'before' ? '실적' : '계획',
          row.category,
          row.title,
          row.assignee,
          row.date,
          row.status,
          row.summary,
          row.nextAction,
          [row.followup, row.delayReason].filter(Boolean).join(' / '),
        ]);
      if (report.agendas.some((agenda) => agenda.visible)) {
        sheet.addRow([]);
        sheet.addRow(['안건', '종류', '상황', '의견', '결정', '기한']).font = bold;
        for (const agenda of report.agendas.filter((item) => item.visible))
          sheet.addRow([agenda.title, agenda.kind, agenda.situation, agenda.opinion, agenda.decision, agenda.dueDate]);
      }
      [10, 12, 32, 12, 11, 12, 40, 30, 30].forEach((width, index) => {
        sheet.getColumn(index + 1).width = width;
      });
    }
  }
  if (!count) addSheet(book, '안내', ['백업할 주간보고서가 없습니다.'], [], [40]);
}
