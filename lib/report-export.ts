import type { ReportDocument, ReportRow, Statistic } from './report-types';
import { completedDay, daysBetween, statisticColumns } from './reports';

export function downloadReportBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function filename(report: ReportDocument) {
  return (
    report.config.meetingDate +
    '_' +
    report.config.title +
    '_수정' +
    report.revision
  ).replace(/[\\/:*?"<>|]/g, '_');
}
export function statisticsCsv(rows: Statistic[]) {
  const keys = Object.values(statisticColumns);
  const quote = (v: string | number | null) =>
    '"' + String(v ?? '').replaceAll('"', '""') + '"';
  return (
    '\uFEFF' +
    [
      Object.keys(statisticColumns).map(quote).join(','),
      ...rows.map((row) => keys.map((k) => quote(row[k])).join(',')),
    ].join('\r\n')
  );
}
export function reportTables(
  report: ReportDocument,
): { name: string; headers: string[]; rows: (string | number | null)[][] }[] {
  const visible = report.rows.filter((r) => r.visible);
  const rowValues = (r: ReportRow) => [
    r.category,
    r.title,
    r.summary,
    r.nextAction,
    r.assignee,
    r.date || '일정 미정',
    r.status,
    completedDay(r.completedAt) ||
      (r.status === '최종 완료' ? '완료일 미확인' : ''),
    r.closed ? '보고 완결' : '후속 보고',
    r.closeNote,
    r.checklist.map((c) => (c.done ? '✓ ' : '□ ') + c.text).join('\n'),
  ];
  return [
    {
      name: '보고요약',
      headers: ['항목', '내용'],
      rows: [
        ['제목', report.config.title],
        ['회의일', report.config.meetingDate],
        ['작성자', report.config.author],
        ['참석자', report.config.attendees],
        [
          '보고 범위',
          report.config.scope === 'mine'
            ? '내 담당·협업 업무'
            : report.config.team + ' 팀',
        ],
        ['업무 구분 기준일', report.config.cutoff],
        [
          '실적 기간',
          report.config.actualStart + ' ~ ' + report.config.actualEnd,
        ],
        ['계획 기간', report.config.planStart + ' ~ ' + report.config.planEnd],
        [
          '통계 기간',
          report.config.statsStart + ' ~ ' + report.config.statsEnd,
        ],
        [
          '전년 비교 기간',
          report.comparisonStart + ' ~ ' + report.comparisonEnd,
        ],
        [
          '비교 기준',
          '전년 같은 날짜 구간 / 윤일은 전년 2월 28일까지 / ' +
            daysBetween(report.config.statsStart, report.config.statsEnd)
              .length +
            '일 대 ' +
            daysBetween(report.comparisonStart, report.comparisonEnd).length +
            '일',
        ],
        ...report.metrics.map((m) => [
          m.label,
          (m.current === null
            ? '자료 없음'
            : m.current.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) +
              m.unit) +
            ' / 전년 ' +
            (m.previous === null
              ? '자료 없음'
              : m.previous.toLocaleString('ko-KR', {
                  maximumFractionDigits: 1,
                }) + m.unit) +
            ' / ' +
            (m.change === null
              ? m.comparison
              : m.change.toFixed(1) + m.comparison),
        ]),
        ['지표 설명', report.config.metricNote],
        ...report.agendas
          .filter((a) => a.visible)
          .map((a) => [
            a.kind + ' · ' + a.title,
            [
              a.situation,
              a.options && '선택안: ' + a.options,
              a.opinion && '작성자 의견: ' + a.opinion,
              a.dueDate && '결정 필요일: ' + a.dueDate,
              a.decision && '결정: ' + a.decision,
            ]
              .filter(Boolean)
              .join('\n'),
          ]),
        ...report.news.map((n) => [
          '관광 동향',
          n.title +
            '\n' +
            n.source +
            ' · ' +
            n.collectedAt +
            '\n' +
            (n.url ?? ''),
        ]),
      ],
    },
    ...(['before', 'after'] as const).map((section) => ({
      name: section === 'before' ? '이전진행' : '이후진행',
      headers: [
        '분류',
        '보고 제목',
        '진행 내용·결과',
        '다음 행동',
        '담당자',
        '예정일',
        '업무 상태',
        '완료일',
        '보고 상태',
        '결과 메모',
        '단계별 진행',
      ],
      rows: visible.filter((r) => r.section === section).map(rowValues),
    })),
    {
      name: '전주후속',
      headers: [
        '업무',
        '지난 회의 약속',
        '현재 결과',
        '지연 사유',
        '다음 조치',
        '예정일',
      ],
      rows: visible
        .filter((r) => r.previousPromise)
        .map((r) => [
          r.title,
          r.previousPromise!,
          r.followup || r.status,
          r.delayReason,
          r.nextAction,
          r.date,
        ]),
    },
    {
      name: '경영지표',
      headers: [
        '지표',
        '당년',
        '전년',
        '차이·증감률',
        '단위',
        '비교 상태',
        '당년 누락 일수',
        '전년 누락 일수',
      ],
      rows: report.metrics.map((m) => [
        m.label,
        m.current,
        m.previous,
        m.change,
        m.unit,
        m.comparison,
        m.missing,
        m.previousMissing,
      ]),
    },
    {
      name: '통계원본',
      headers: Object.keys(statisticColumns),
      rows: report.statistics.map((s) =>
        Object.values(statisticColumns).map((k) => s[k]),
      ),
    },
  ];
}
export async function exportReportExcel(report: ReportDocument) {
  const excelModule = await import('exceljs');
  const ExcelJS = excelModule.default ?? excelModule;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = report.config.author;
  workbook.created = new Date(report.finalizedAt ?? report.createdAt);
  for (const table of reportTables(report)) {
    const sheet = workbook.addWorksheet(table.name, {
      views: [{ state: 'frozen', ySplit: 1 }],
      pageSetup: {
        paperSize: 9,
        orientation: table.headers.length > 3 ? 'landscape' : 'portrait',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        printTitlesRow: '1:1',
      },
    });
    sheet.addRow(table.headers);
    sheet.addRows(table.rows);
    sheet.columns.forEach((column, index) => {
      column.width =
        table.headers.length === 2
          ? index === 0
            ? 23
            : 90
          : index === 1 || index === 2 || index === 3
            ? 36
            : 20;
    });
    sheet.eachRow((row, index) => {
      row.alignment = { vertical: 'top', wrapText: true };
      row.font = { name: '맑은 고딕', size: 11 };
      if (index === 1) {
        row.font = {
          name: '맑은 고딕',
          bold: true,
          color: { argb: 'FFFFFFFF' },
          size: 11,
        };
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF2F6B4F' },
        };
        row.height = 26;
      } else {
        const lines = Math.max(
          1,
          ...table.rows[index - 2].map((v) =>
            String(v ?? '')
              .split('\n')
              .reduce(
                (n, line) => n + Math.ceil(Math.max(1, line.length) / 25),
                0,
              ),
          ),
        );
        row.height = Math.min(409, Math.max(32, lines * 16));
      }
    });
    sheet.pageSetup.printArea =
      'A1:' + sheet.getColumn(table.headers.length).letter + sheet.rowCount;
    sheet.headerFooter.oddFooter =
      '&L' + report.config.meetingDate + '&R&P / &N';
  }
  const buffer = await workbook.xlsx.writeBuffer();
  downloadReportBlob(
    new Blob([buffer as ArrayBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename(report) + '.xlsx',
  );
}
const escapeHtml = (v: string | number | null) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
export function reportHtml(report: ReportDocument) {
  return (
    '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>' +
    escapeHtml(filename(report)) +
    '</title><style>@page{size:A4 landscape;margin:14mm;@bottom-center{content:counter(page) " / " counter(pages)}}*{box-sizing:border-box}body{font:12px/1.6 "Malgun Gothic",sans-serif;color:#183b2b}h1{font-size:23px}h2{font-size:16px;margin-top:24px}table{border-collapse:collapse;width:100%;table-layout:fixed;margin-bottom:22px}th,td{border:1px solid #bccbc0;padding:7px;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#e3eee7;text-align:left}thead{display:table-header-group}tr{break-inside:auto}section{break-before:page}section:first-of-type{break-before:auto}button{padding:12px 24px;cursor:pointer}@media print{button{display:none}}p{margin:8px 0}</style></head><body><button onclick="window.print()">PDF로 저장 / 인쇄</button><h1>' +
    escapeHtml(report.config.title) +
    '</h1><p>' +
    escapeHtml(
      report.config.meetingDate +
        ' · ' +
        report.config.author +
        ' · 수정 ' +
        report.revision,
    ) +
    '</p>' +
    reportTables(report)
      .map(
        (t) =>
          '<section><h2>' +
          escapeHtml(t.name) +
          '</h2><table><thead><tr>' +
          t.headers.map((h) => '<th>' + escapeHtml(h) + '</th>').join('') +
          '</tr></thead><tbody>' +
          t.rows
            .map(
              (row) =>
                '<tr>' +
                row.map((v) => '<td>' + escapeHtml(v) + '</td>').join('') +
                '</tr>',
            )
            .join('') +
          '</tbody></table></section>',
      )
      .join('') +
    '</body></html>'
  );
}
export function printReport(report: ReportDocument) {
  const url = URL.createObjectURL(
    new Blob([reportHtml(report)], { type: 'text/html;charset=utf-8' }),
  );
  const popup = window.open(url, '_blank');
  if (!popup) {
    URL.revokeObjectURL(url);
    throw new Error('미리보기를 열 수 없습니다. 팝업을 허용해 주세요.');
  }
  popup.opener = null;
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
