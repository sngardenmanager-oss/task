'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileSpreadsheet, LoaderCircle, Printer, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type {
  CombinedRow,
  CombinedTeamReport,
  CombinedWeek,
} from '@/lib/combined-report';
import type { CompanyEvent, Team } from '@/lib/types';

type Payload = {
  fingerprint?: string;
  week: CombinedWeek;
  teams: Team[];
  reports: CombinedTeamReport[];
  companyEvents: CompanyEvent[];
};

const sourceLabel: Record<CombinedTeamReport['source'], string> = {
  final: '팀 보고서 확정본',
  draft: '팀 보고서 초안',
  auto: '업무 기록 자동 정리',
};
const md = (value: string) => (value ? `${Number(value.slice(5, 7))}/${Number(value.slice(8))}` : '');
const range = (start: string, end: string) => `${md(start)} ~ ${md(end)}`;

/** 마스터 전용 전체 팀 통합 보고서. 팀마다 그 주 보고서(확정본 우선)를 모으고, 없으면 업무 기록으로 채웁니다. */
export default function CombinedReportView({ accessToken }: { accessToken: string }) {
  const [meetingDate, setMeetingDate] = useState(() =>
    new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }),
  );
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [savedId, setSavedId] = useState('');
  const [meetingArchive, setMeetingArchive] = useState<{id:string;meeting_date:string;recorded_at:string;note:string}[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(
        `/api/overview/report?meetingDate=${encodeURIComponent(meetingDate)}`,
        { headers: { authorization: `Bearer ${accessToken}` }, cache: 'no-store' },
      );
      const result = (await response.json()) as Payload & { error?: string };
      if (!response.ok) throw new Error(result.error ?? '통합 보고서를 만들지 못했습니다.');
      setPayload(result);
      setSavedId('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, meetingDate]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const teamOf = (id: string) => payload?.teams.find((team) => team.id === id);
  async function meetingAction(id?: string) {
    if (!payload || loading) return;
    setLoading(true); setError('');
    try {
      if (id) {
        const response = await fetch('/api/overview/report?archive=1&id=' + encodeURIComponent(id), { headers: { authorization: `Bearer ${accessToken}` } });
        const body = await response.json() as {error?:string;items:{id:string;payload:Payload}[]};
        if (!response.ok || !body.items[0]) throw new Error(body.error ?? '회의본을 찾지 못했습니다.');
        setPayload(body.items[0].payload); setSavedId(body.items[0].id);
      } else {
        const note = window.prompt('회의 확정 의견을 남겨 주세요. 미확정 팀이 있으면 예외 사유가 필요합니다.');
        if (note === null) return;
        const response = await fetch('/api/overview/report', { method:'POST', headers:{authorization:`Bearer ${accessToken}`,'content-type':'application/json'}, body: JSON.stringify({id:crypto.randomUUID(),meetingDate:payload.week.meetingDate,fingerprint:payload.fingerprint,note}) });
        const body = await response.json() as {error?:string;item:{id:string;payload:Payload}};
        if (!response.ok) throw new Error(body.error ?? '회의본 저장 실패');
        setPayload(body.item.payload); setSavedId(body.item.id);
      }
    } catch(e) {setError(e instanceof Error ? e.message : '회의 기록 처리 실패');} finally {setLoading(false);}
  }
  async function listMeetings() {
    try { const response=await fetch('/api/overview/report?archive=1',{headers:{authorization:`Bearer ${accessToken}`}});const body=await response.json() as {error?:string;items:typeof meetingArchive};if(!response.ok)throw new Error(body.error);setMeetingArchive(body.items); } catch(e){setError(e instanceof Error?e.message:'보관함 조회 실패');}
  }

  async function exportExcel() {
    if (!payload) return;
    const excelModule = await import('exceljs');
    const ExcelJS = excelModule.default ?? excelModule;
    const workbook = new ExcelJS.Workbook();
    const bold = { name: '맑은 고딕', size: 10, bold: true };
    const summary = workbook.addWorksheet('요약');
    summary.addRow([`주간회의 전체 팀 통합 보고 (회의일 ${payload.week.meetingDate})`]).font = { ...bold, size: 12 };
    summary.addRow([
      `전주 실적 ${payload.week.actualStart} ~ ${payload.week.actualEnd} / 금주 계획 ${payload.week.planStart} ~ ${payload.week.planEnd}`,
    ]);
    summary.addRow([]);
    summary.addRow(['회의본 번호', savedId || '미확정 취합 자료']);
    summary.addRow(['팀', '자료', '작성자', '전주 실적', '금주 계획', '지연 업무']).font = bold;
    for (const report of payload.reports)
      summary.addRow([
        teamOf(report.teamId)?.name ?? report.teamId,
        sourceLabel[report.source],
        report.author ?? '',
        report.before.length,
        report.after.length,
        report.overdue,
      ]);
    if (payload.companyEvents.length) {
      summary.addRow([]);
      summary.addRow(['전사 일정', '날짜']).font = bold;
      for (const event of payload.companyEvents)
        summary.addRow([event.title, `${event.date}${event.endDate ? ` ~ ${event.endDate}` : ''}`]);
    }
    summary.columns.forEach((column, index) => {
      column.width = [18, 20, 12, 12, 12, 12][index] ?? 14;
    });
    const used = new Set(['요약']);
    for (const report of payload.reports) {
      let name = (teamOf(report.teamId)?.name ?? report.teamId).replace(/[[\]:*?/\\]/g, ' ').slice(0, 28);
      while (used.has(name)) name = `${name.slice(0, 26)}_${used.size}`;
      used.add(name);
      const sheet = workbook.addWorksheet(name);
      sheet.addRow(['구분', '분류', '업무', '담당', '날짜', '상태', '내용']).font = bold;
      const add = (label: string, rows: CombinedRow[]) =>
        rows.forEach((row) =>
          sheet.addRow([label, row.category, row.title, row.assignee, row.date, row.status, row.summary]),
        );
      add('전주 실적', report.before);
      add('금주 계획', report.after);
      sheet.columns.forEach((column, index) => {
        column.width = [10, 12, 36, 14, 12, 14, 48][index] ?? 14;
      });
    }
    const buffer = await workbook.xlsx.writeBuffer();
    const url = URL.createObjectURL(
      new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `스누피가든_전체팀_주간보고_${payload.week.meetingDate}.xlsx`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-end gap-2 rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-4 print:hidden">
        <label className="text-xs font-bold text-[#5f6d64]">
          회의 날짜
          <input
            type="date"
            value={meetingDate}
            onChange={(event) => setMeetingDate(event.target.value)}
            className="mt-1 block h-10 rounded-xl border border-[#d8ded4] bg-white px-3 text-sm"
          />
        </label>
        <Button variant="outline" disabled={loading} onClick={() => void load()}>
          <RefreshCw className={loading ? 'animate-spin' : ''} />
          다시 불러오기
        </Button>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" disabled={!payload} onClick={() => window.print()}>
            <Printer />
            인쇄·PDF
          </Button>
          <Button disabled={!payload} onClick={() => void exportExcel()}>
            <FileSpreadsheet />
            엑셀 받기
          </Button>
        </div>
      </section>

      {error && (
        <p role="alert" className="rounded-xl bg-[#f7e8e4] px-3 py-2 text-sm font-semibold text-[#8d342e]">
          {error}
        </p>
      )}
      <section className="space-y-3 rounded-2xl border border-[#d8ded4] bg-white p-4 print:hidden">
        <p className="text-sm font-bold">{savedId ? `확정 회의본 · ${savedId}` : '현재 취합 자료 · 회의본을 확정하면 팀 보고 버전과 내용을 보존합니다.'}</p>
        <div className="flex flex-wrap gap-2"><Button disabled={loading || !payload || !!savedId} onClick={() => void meetingAction()}>통합 회의본 확정</Button><Button variant="outline" onClick={() => void listMeetings()}>지난 회의본 보기</Button></div>
        {meetingArchive.map(item => <button className="block text-left text-sm underline" key={item.id} onClick={() => void meetingAction(item.id)}>{item.meeting_date} · {new Date(item.recorded_at).toLocaleString('ko-KR')} {item.note ? '· ' + item.note : ''}</button>)}
      </section>
      {!payload ? (
        <p className="flex items-center gap-2 text-sm text-[#748078]">
          <LoaderCircle className="size-4 animate-spin" /> 통합 보고서를 만드는 중입니다.
        </p>
      ) : (
        <article className="space-y-5 rounded-3xl border border-[#d8ded4] bg-white p-6 print:border-0 print:p-0">
          <header>
            <h2 className="text-2xl font-black">주간회의 전체 팀 통합 보고</h2>
            <p className="break-all text-xs">회의본 번호: {savedId || '미확정 취합 자료'}</p>
            <p className="mt-1 text-sm text-[#5f6d64]">
              회의일 {payload.week.meetingDate} · 전주 실적{' '}
              {range(payload.week.actualStart, payload.week.actualEnd)} · 금주 계획{' '}
              {range(payload.week.planStart, payload.week.planEnd)}
            </p>
          </header>

          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-[#26352d] text-left">
                <th className="py-2">팀</th>
                <th className="py-2">자료</th>
                <th className="py-2 text-right">전주 실적</th>
                <th className="py-2 text-right">금주 계획</th>
                <th className="py-2 text-right">지연 업무</th>
              </tr>
            </thead>
            <tbody>
              {payload.reports.map((report) => {
                const team = teamOf(report.teamId);
                return (
                  <tr key={report.teamId} className="border-b border-[#e8eae5]">
                    <td className="py-2 font-bold">
                      <span className="mr-2 inline-block size-2.5 rounded-full" style={{ background: team?.color }} />
                      {team?.name}
                    </td>
                    <td className="py-2 text-[#5f6d64]">
                      {sourceLabel[report.source]}
                      {report.author ? ` · ${report.author}` : ''}
                    </td>
                    <td className="py-2 text-right">{report.before.length}</td>
                    <td className="py-2 text-right">{report.after.length}</td>
                    <td className={`py-2 text-right ${report.overdue ? 'font-black text-[#a83f36]' : ''}`}>
                      {report.overdue}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {payload.companyEvents.length > 0 && (
            <section>
              <h3 className="mb-2 font-black text-[#b7791f]">전사 공통 일정</h3>
              <ul className="space-y-1 text-sm">
                {payload.companyEvents.map((event) => (
                  <li key={event.id}>
                    <strong>{md(event.date)}{event.endDate ? `~${md(event.endDate)}` : ''}</strong>{' '}
                    {event.title}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {payload.reports.map((report) => {
            const team = teamOf(report.teamId);
            return (
              <section key={report.teamId} className="break-inside-avoid-page">
                <h3 className="mb-2 flex items-center gap-2 border-b-2 pb-1 text-lg font-black" style={{ borderColor: team?.color }}>
                  {team?.name}
                  <span className="text-xs font-bold text-[#748078]">{sourceLabel[report.source]}</span>
                </h3>
                <RowTable label="전주 실적" rows={report.before} />
                <RowTable label="금주 계획" rows={report.after} />
              </section>
            );
          })}
        </article>
      )}
    </div>
  );
}

function RowTable({ label, rows }: { label: string; rows: CombinedRow[] }) {
  return (
    <div className="mb-3">
      <p className="mb-1 text-sm font-black text-[#3e4d44]">
        {label} <span className="font-bold text-[#748078]">{rows.length}건</span>
      </p>
      {rows.length ? (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-[#f1f2ed] text-left">
              <th className="px-2 py-1.5">업무</th>
              <th className="px-2 py-1.5">분류</th>
              <th className="px-2 py-1.5">담당</th>
              <th className="px-2 py-1.5">날짜</th>
              <th className="px-2 py-1.5">상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-b border-[#eef0ea] align-top">
                <td className="px-2 py-1.5">
                  <strong>{row.title}</strong>
                  {row.summary && <p className="mt-0.5 whitespace-pre-wrap text-[#5f6d64]">{row.summary}</p>}
                </td>
                <td className="px-2 py-1.5">{row.category}</td>
                <td className="px-2 py-1.5">{row.assignee}</td>
                <td className="px-2 py-1.5">{md(row.date)}</td>
                <td className="px-2 py-1.5">{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-xs text-[#9aa39c]">해당 없음</p>
      )}
    </div>
  );
}
