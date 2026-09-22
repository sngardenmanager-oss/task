import type { ReportDocument, ReportRow, Statistic } from './report-types';
import {
  calculateComposition,
  categoryCounts,
  completedDay,
  dailyComposition,
  daysBetween,
  sortNews,
  statisticColumns,
} from './reports';

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
type Cell = string | number | null;
type RowTone = 'positive' | 'negative' | 'metric' | 'agenda';
type Metric = ReportDocument['metrics'][number];
export type ReportTable = {
  name: string;
  headers: string[];
  rows: Cell[][];
  widths: number[];
  tones?: (RowTone | undefined)[];
};
const palette = {
  head: '2F6B4F',
  line: 'BCCBC0',
  zebra: 'F6FAF7',
  ink: '183B2B',
  label: 'E3EEE7',
  positive: { bg: 'E4F1FB', fg: '1B5E9E' },
  negative: { bg: 'FBE7E5', fg: 'A83F36' },
  agenda: { bg: 'FFF4D6', fg: '7A5A00' },
  up: '1F7A4A',
  down: 'C0392B',
};
const statusColors: Record<string, { bg: string; fg: string }> = {
  '최종 완료': { bg: 'DDF1E3', fg: '1F6B3F' },
  '진행 중': { bg: 'DCEBFA', fg: '1B5E9E' },
  '완료 승인 대기': { bg: 'FFF0CC', fg: '7A5A00' },
  '대응 중': { bg: 'FFF0CC', fg: '7A5A00' },
  예정: { bg: 'EEF0EC', fg: '55605A' },
};
const categoryColors = [
  { bg: 'DFF0E6', fg: '1F5B3E' },
  { bg: 'E0EAF8', fg: '23508F' },
  { bg: 'F6E6D8', fg: '8A4B12' },
  { bg: 'EBE2F5', fg: '58358F' },
  { bg: 'F8E2E6', fg: '9A2F45' },
  { bg: 'E2F0F0', fg: '1D6666' },
];
// 상태·분류 칸에만 색을 준다. 분류는 표 안에서 처음 나온 순서대로 색을 배정한다.
function colorOf(header: string, value: Cell, seen: string[]) {
  const text = String(value ?? '');
  if (!text) return undefined;
  if (header === '업무 상태') return statusColors[text];
  if (header === '분류') {
    if (!seen.includes(text)) seen.push(text);
    return categoryColors[seen.indexOf(text) % categoryColors.length];
  }
  return undefined;
}
export function formatNumber(n: number) {
  return n.toLocaleString('ko-KR', {
    maximumFractionDigits: Number.isInteger(n) ? 0 : 1,
  });
}
const signed = (n: number) => (n > 0 ? '+' : '') + n.toFixed(1);
const metricCurrent = (m: Metric) =>
  m.current === null ? '자료 없음' : formatNumber(m.current) + m.unit;
const metricPrevious = (m: Metric) =>
  m.previous === null ? '자료 없음' : formatNumber(m.previous) + m.unit;
const metricChange = (m: Metric) =>
  m.change === null ? m.comparison : signed(m.change) + m.comparison;
const round1 = (n: number | null) =>
  n === null ? null : Math.round(n * 10) / 10 || 0; // -0 은 0 으로
// 비교 상태는 증감 방향을 말로 적는다. 계산할 수 없으면 그 이유를 적는다.
const metricStatus = (m: Metric) => {
  if (m.change === null) return m.comparison;
  const r = round1(m.change)!;
  const word = r > 0 ? '증가' : r < 0 ? '감소' : '변동 없음';
  return m.missing || m.previousMissing ? word + ' · 누락일 있음' : word;
};
const dayCount = (n: number) => n + '일';

const compositionOf = (report: ReportDocument) =>
  calculateComposition(
    report.statistics,
    report.config.statsStart,
    report.config.statsEnd,
  );
export function reportTables(report: ReportDocument): ReportTable[] {
  const visible = report.rows.filter((r) => r.visible);
  const composition = compositionOf(report);
  const dayOf = (r: ReportRow) => r.date || '일정 미정';
  const doneOf = (r: ReportRow) =>
    completedDay(r.completedAt) ||
    (r.status === '최종 완료' ? '완료일 미확인' : '');
  const stepsOf = (r: ReportRow) =>
    r.checklist.map((c) => (c.done ? '✓ ' : '□ ') + c.text).join('\n');
  const toneName = (n: ReportDocument['news'][number]) =>
    n.tone === 'positive' ? '긍정' : n.tone === 'negative' ? '부정' : '미분류';
  const news = sortNews(report.news);
  // 같은 분류를 모아 많은 분류부터 보여준다. 분류 안에서는 작성 순서를 지킨다.
  const bySection = (section: ReportRow['section']) => {
    const rows = visible.filter((r) => r.section === section);
    const order = categoryCounts(rows).map(([name]) => name);
    return rows
      .map((r, i) => ({ r, i }))
      .sort(
        (a, b) =>
          order.indexOf(a.r.category || '기타') -
            order.indexOf(b.r.category || '기타') || a.i - b.i,
      )
      .map(({ r }) => r);
  };
  const countText = (section: ReportRow['section']) =>
    categoryCounts(visible.filter((r) => r.section === section))
      .map(([name, n]) => name + ' ' + n + '건')
      .join(' · ') || '없음';
  const progressRow = (r: ReportRow): Cell[] => [
    r.category,
    r.title,
    r.summary,
    dayOf(r),
    r.status,
    doneOf(r),
    stepsOf(r),
  ];
  const summary: [Cell, Cell, RowTone?][] = [
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
    ['실적 기간', report.config.actualStart + ' ~ ' + report.config.actualEnd],
    ['계획 기간', report.config.planStart + ' ~ ' + report.config.planEnd],
    ['통계 기간', report.config.statsStart + ' ~ ' + report.config.statsEnd],
    ['전년 비교 기간', report.comparisonStart + ' ~ ' + report.comparisonEnd],
    [
      '비교 기준',
      '전년 같은 날짜 구간 / 윤일은 전년 2월 28일까지 / ' +
        daysBetween(report.config.statsStart, report.config.statsEnd).length +
        '일 대 ' +
        daysBetween(report.comparisonStart, report.comparisonEnd).length +
        '일',
    ],
    ...report.metrics.map((m): [Cell, Cell, RowTone] => [
      m.label,
      metricCurrent(m) +
        ' / 전년 ' +
        metricPrevious(m) +
        ' / ' +
        metricChange(m),
      'metric',
    ]),
    [
      '구성비 기준',
      '단체 구성비 = 단체 입장객(내국인 단체 + 외국인 단체) ÷ 전체 입장객\n' +
        '외국인 구성비 = 외국인 전체(외국인 개인 + 외국인 단체) ÷ 전체 입장객\n' +
        '외국인 단체는 두 구성비에 모두 포함되므로 두 비율을 더하지 않습니다. 겹치지 않는 구분은 입장객구성 표를 확인하세요.',
    ],
    ['지표 설명', report.config.metricNote],
    ...report.agendas
      .filter((a) => a.visible)
      .map((a): [Cell, Cell, RowTone] => [
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
        'agenda',
      ]),
    ['이전 진행 분류별', countText('before')],
    ['이후 진행 분류별', countText('after')],
    [
      '관광 동향',
      news.length
        ? '긍정 ' +
          news.filter((n) => n.tone === 'positive').length +
          '건 · 부정 ' +
          news.filter((n) => n.tone === 'negative').length +
          '건' +
          (news.some((n) => !n.tone)
            ? ' · 미분류 ' + news.filter((n) => !n.tone).length + '건'
            : '') +
          ' (관광동향 표 참고)'
        : '선택 없음',
    ],
  ];
  return [
    {
      name: '보고요약',
      headers: ['항목', '내용'],
      rows: summary.map(([a, b]) => [a, b]),
      tones: summary.map(([, , tone]) => tone),
      widths: [14, 86],
    },
    {
      // 이전·이후 진행 모두 다음 행동·담당자·보고 상태·결과 메모 열은 출력하지 않는다.
      name: '이전진행',
      headers: [
        '분류',
        '보고 제목',
        '진행 내용·결과',
        '예정일',
        '업무 상태',
        '완료일',
        '단계별 진행',
      ],
      rows: bySection('before').map(progressRow),
      widths: [8, 18, 34, 8, 8, 8, 16],
    },
    {
      name: '이후진행',
      headers: [
        '분류',
        '보고 제목',
        '진행 내용·결과',
        '예정일',
        '업무 상태',
        '완료일',
        '단계별 진행',
      ],
      rows: bySection('after').map(progressRow),
      widths: [8, 18, 34, 8, 8, 8, 16],
    },
    {
      // 긍정 → 부정 순, 각각 빠른 일자순. 선택한 순서와 관계없이 같은 순서로 나온다.
      name: '관광동향',
      headers: ['구분', '일자', '키워드', '제목', '출처', '링크'],
      rows: news.map((n) => [
        toneName(n),
        n.collectedAt,
        n.category,
        n.title,
        n.source,
        n.url ?? '',
      ]),
      tones: news.map((n) => n.tone),
      widths: [6, 9, 10, 40, 10, 25],
    },
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
      widths: [16, 22, 20, 14, 20, 8],
    },
    {
      name: '경영지표',
      headers: [
        '지표',
        '당년',
        '전년',
        '전년 차이',
        '증감',
        '단위',
        '비교 상태',
        '당년 누락 일수',
        '전년 누락 일수',
      ],
      rows: report.metrics.map((m) => {
        const ratio = m.unit === '%';
        return [
          m.label,
          round1(m.current),
          round1(m.previous),
          m.current === null || m.previous === null
            ? null
            : round1(m.current - m.previous),
          m.change === null ? '—' : signed(m.change) + m.comparison,
          ratio ? '% (차이는 %p)' : m.unit,
          metricStatus(m),
          dayCount(m.missing),
          dayCount(m.previousMissing),
        ];
      }),
      widths: [12, 14, 14, 13, 9, 9, 15, 7, 7],
    },
    {
      name: '입장객구성',
      headers: [
        '구분(중복 없음)',
        '합산되는 지표',
        '당년 인원',
        '당년 비중(%)',
        '전년 인원',
        '전년 비중(%)',
        '비중 차이(%p)',
        '집계 제외 일수',
      ],
      rows: composition.map((c) => [
        c.label,
        c.belongsTo,
        c.current,
        round1(c.currentShare),
        c.previous,
        round1(c.previousShare),
        round1(c.shareChange),
        '당년 ' +
          dayCount(c.missing) +
          ' · 전년 ' +
          dayCount(c.previousMissing),
      ]),
      widths: [13, 22, 10, 10, 10, 10, 10, 15],
    },
    {
      name: '통계원본',
      headers: Object.keys(statisticColumns),
      rows: report.statistics.map((s) =>
        Object.values(statisticColumns).map((k) => s[k]),
      ),
      widths: [11, 13, 9, 9, 9, 9, 9, 9, 10, 12],
    },
  ];
}
const trendHeaders = ['전년 차이', '비중 차이(%p)'];
const numberFormat = (v: number) => (Number.isInteger(v) ? '#,##0' : '#,##0.0');
const visualLength = (text: string) => {
  let n = 0;
  for (let i = 0; i < text.length; i++)
    n += text.charCodeAt(i) > 0x2e80 ? 2 : 1;
  return n;
};
export async function exportReportExcel(report: ReportDocument) {
  const excelModule = await import('exceljs');
  const ExcelJS = excelModule.default ?? excelModule;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = report.config.author;
  workbook.created = new Date(report.finalizedAt ?? report.createdAt);
  const font = (extra: Record<string, unknown> = {}) => ({
    name: '맑은 고딕',
    size: 10,
    ...extra,
  });
  const fill = (rgb: string) => ({
    type: 'pattern' as const,
    pattern: 'solid' as const,
    fgColor: { argb: 'FF' + rgb },
  });
  const side = { style: 'thin' as const, color: { argb: 'FF' + palette.line } };
  const border = { top: side, left: side, bottom: side, right: side };
  const seen: string[] = [];
  for (const table of reportTables(report)) {
    const sheet = workbook.addWorksheet(table.name, {
      views: [{ state: 'frozen', ySplit: 1 }],
      properties: { tabColor: { argb: 'FF' + palette.head } },
      pageSetup: {
        paperSize: 9,
        orientation: table.headers.length > 3 ? 'landscape' : 'portrait',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        printTitlesRow: '1:1',
        margins: {
          left: 0.3,
          right: 0.3,
          top: 0.4,
          bottom: 0.5,
          header: 0.2,
          footer: 0.2,
        },
      },
    });
    sheet.addRow(table.headers);
    sheet.addRows(table.rows);
    const keyValue = table.headers.length === 2;
    const weight = table.widths.reduce((a, b) => a + b, 0);
    const widths = table.widths.map((w) =>
      Math.max(9, Math.round((w / weight) * (keyValue ? 120 : 150))),
    );
    sheet.columns.forEach((column, index) => {
      column.width = widths[index];
    });
    sheet.eachRow((row, index) => {
      if (index === 1) {
        row.height = 24;
        row.eachCell((cell) => {
          cell.font = font({ bold: true, color: { argb: 'FFFFFFFF' } });
          cell.fill = fill(palette.head);
          cell.border = border;
          cell.alignment = {
            vertical: 'middle',
            horizontal: 'center',
            wrapText: true,
          };
        });
        return;
      }
      const values = table.rows[index - 2];
      const tone = table.tones?.[index - 2];
      const toneColor = tone && tone !== 'metric' ? palette[tone] : undefined;
      let lines = 1;
      for (let col = 1; col <= table.headers.length; col++) {
        const cell = row.getCell(col);
        const value = values[col - 1];
        const header = table.headers[col - 1];
        cell.font = font();
        cell.border = border;
        cell.alignment = { vertical: 'top', wrapText: true };
        if (index % 2 === 1) cell.fill = fill(palette.zebra);
        if (typeof value === 'number') {
          cell.numFmt = numberFormat(value);
          cell.alignment = { vertical: 'top', horizontal: 'right' };
          if (trendHeaders.includes(header))
            cell.font = font({
              bold: true,
              color: { argb: 'FF' + (value < 0 ? palette.down : palette.up) },
            });
        }
        const color = colorOf(header, value, seen);
        if (color) {
          cell.fill = fill(color.bg);
          cell.font = font({ bold: true, color: { argb: 'FF' + color.fg } });
        }
        if (toneColor) {
          cell.fill = fill(toneColor.bg);
          if (col === 1)
            cell.font = font({
              bold: true,
              color: { argb: 'FF' + toneColor.fg },
            });
        }
        if (keyValue) {
          if (col === 1) {
            cell.fill = fill(toneColor?.bg ?? palette.label);
            cell.font = font({
              bold: true,
              color: toneColor ? { argb: 'FF' + toneColor.fg } : undefined,
            });
          }
        }
        const per = Math.max(4, widths[col - 1] - 1);
        lines = Math.max(
          lines,
          String(value ?? '')
            .split('\n')
            .reduce(
              (n, line) => n + Math.ceil(Math.max(1, visualLength(line)) / per),
              0,
            ),
        );
      }
      row.height = Math.min(409, Math.max(20, lines * 14 + 4));
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
const badge = (c: { bg: string; fg: string }) =>
  ' style="background:#' + c.bg + ';color:#' + c.fg + ';font-weight:700"';
const reportCss =
  '@page{size:A4 landscape;margin:8mm 9mm;@bottom-center{content:counter(page) " / " counter(pages)}}' +
  '*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
  'body{margin:0;font:10.5px/1.45 "Malgun Gothic",sans-serif;color:#' +
  palette.ink +
  '}h1{font-size:20px;margin:0 0 2px}.meta{margin:0 0 8px;color:#64776a}' +
  'h2{font-size:13px;margin:12px 0 5px;padding-left:7px;border-left:4px solid #' +
  palette.head +
  ';break-after:avoid}' +
  '.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:6px 0 4px}' +
  '.card{border:1px solid #' +
  palette.line +
  ';border-top:3px solid #' +
  palette.head +
  ';border-radius:5px;padding:5px 8px;background:#' +
  palette.zebra +
  ';break-inside:avoid}' +
  '.card b{display:block;color:#64776a;font-size:10px}.card strong{display:block;font-size:17px;line-height:1.3}' +
  '.card span{font-size:10px;color:#55605A}.card em{display:block;font-style:normal;font-size:9px;color:#8A968E;margin-top:2px}' +
  '.bar{display:flex;height:22px;border-radius:4px;overflow:hidden;border:1px solid #' +
  palette.line +
  ';margin:4px 0}.bar i{display:block;color:#fff;font:700 10px/22px "Malgun Gothic",sans-serif;text-align:center;overflow:hidden;white-space:nowrap}' +
  '.bracket{display:flex;font-size:10px;font-weight:700;margin-bottom:6px}.bracket span{border-top:3px solid;padding-top:1px;text-align:center;overflow:hidden;white-space:nowrap}' +
  '.daily{border:1px solid #' +
  palette.line +
  ';border-radius:5px;padding:6px 8px;margin:6px 0;break-inside:avoid}' +
  '.daily h3{font-size:11px;margin:0 0 4px}.legend{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:9.5px;margin:2px 0 4px}' +
  '.legend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;vertical-align:-1px}' +
  '.drow{display:flex;align-items:flex-end;gap:2px}.drow .lab{width:70px;flex:none;font-size:9px;font-weight:700;align-self:center}' +
  '.dcol{flex:1;min-width:0;display:flex;flex-direction:column-reverse;gap:1px;height:56px}' +
  '.dcol b{display:block;min-height:0}.dcol.none{border:1px dashed #BCCBC0;border-radius:2px}' +
  '.dnum,.ddate{display:flex;gap:2px;font-size:8px;color:#55605A}.dnum span,.ddate span{flex:1;min-width:0;text-align:center;overflow:hidden;white-space:nowrap}' +
  '.dnum:before,.ddate:before{content:"";width:70px;flex:none}' +
  '.up{color:#' +
  palette.up +
  '!important;font-weight:700}.down{color:#' +
  palette.down +
  '!important;font-weight:700}' +
  'table{border-collapse:collapse;width:100%;table-layout:fixed;margin-bottom:6px}' +
  'th,td{border:1px solid #' +
  palette.line +
  ';padding:3px 5px;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}' +
  'th{background:#' +
  palette.head +
  ';color:#fff;text-align:center;font-weight:700}' +
  'tbody tr:nth-child(even) td{background:#' +
  palette.zebra +
  '}td.num{text-align:right;font-variant-numeric:tabular-nums}' +
  'tr{break-inside:avoid}thead{display:table-header-group}' +
  '.kv td:first-child{background:#' +
  palette.label +
  ';font-weight:700}.empty{margin:2px 0 8px;color:#8A968E}' +
  'button{padding:10px 22px;cursor:pointer;margin-bottom:8px}@media print{button{display:none}}';
// 일자별 입장객 분포. 윗줄은 내국인·외국인 구성비, 아랫줄은 그 안의 개인·단체 네 구분.
// 아랫줄은 아래부터 내국인 개인 → 내국인 단체 → 외국인 단체 → 외국인 개인으로 쌓아
// 윗줄의 내국인·외국인 경계와 맞고, 단체(내국인+외국인)는 가운데에 이어서 보인다.
export const dailyColors = {
  domestic: '#6B7D71',
  foreign: '#1B5E9E',
  parts: ['#8A968E', '#2F6B4F', '#1B5E9E', '#D9822B'],
};
export const dailyLabels = {
  domestic: '내국인',
  foreign: '외국인',
  parts: ['내국인 개인', '내국인 단체', '외국인 개인', '외국인 단체'],
};
export const dailyStack = [0, 1, 3, 2];
function dailyChartHtml(report: ReportDocument) {
  const days = dailyComposition(
    report.statistics,
    report.config.statsStart,
    report.config.statsEnd,
  );
  if (!days.some((d) => d.value)) return '';
  const pct = (n: number, total: number) =>
    total > 0 ? ((n / total) * 100).toFixed(2) : '0';
  const seg = (n: number, total: number, color: string, title: string) =>
    '<b style="height:' +
    pct(n, total) +
    '%;background:' +
    color +
    '" title="' +
    escapeHtml(
      title +
        ' ' +
        formatNumber(n) +
        '명 (' +
        pct(n, total).slice(0, -1) +
        '%)',
    ) +
    '"></b>';
  const col = (d: (typeof days)[number], top: boolean) => {
    if (!d.value) return '<div class="dcol none" title="미입력"></div>';
    const { visitors, parts } = d.value;
    const inner = top
      ? seg(parts[0] + parts[1], visitors, dailyColors.domestic, '내국인') +
        seg(parts[2] + parts[3], visitors, dailyColors.foreign, '외국인')
      : dailyStack
          .map((i) =>
            seg(parts[i], visitors, dailyColors.parts[i], dailyLabels.parts[i]),
          )
          .join('');
    return '<div class="dcol">' + inner + '</div>';
  };
  const legend = (items: [string, string][]) =>
    '<div class="legend">' +
    items
      .map(
        ([label, color]) =>
          '<span><i style="background:' +
          color +
          '"></i>' +
          escapeHtml(label) +
          '</span>',
      )
      .join('') +
    '</div>';
  const line = (cls: string, cells: string[]) =>
    '<div class="' +
    cls +
    '">' +
    cells.map((c) => '<span>' + c + '</span>').join('') +
    '</div>';
  return (
    '<div class="daily"><h3>일자별 입장객 분포 (막대 높이 = 그날 전체 입장객 100%)</h3>' +
    line(
      'dnum',
      days.map((d) => (d.value ? formatNumber(d.value.visitors) : '미입력')),
    ) +
    '<div class="drow"><span class="lab">내국인·외국인</span>' +
    days.map((d) => col(d, true)).join('') +
    '</div>' +
    legend([
      ['내국인', dailyColors.domestic],
      ['외국인', dailyColors.foreign],
    ]) +
    '<div class="drow"><span class="lab">개인·단체</span>' +
    days.map((d) => col(d, false)).join('') +
    '</div>' +
    line(
      'ddate',
      days.map((d) => d.date.slice(5)),
    ) +
    legend(
      dailyStack.map((i) => [dailyLabels.parts[i], dailyColors.parts[i]]),
    ) +
    '</div>'
  );
}
export function reportHtml(report: ReportDocument) {
  const cardNote: Record<string, string> = {
    '단체 구성비': '단체 ÷ 전체 · 외국인 단체 포함',
    '외국인 구성비': '외국인(개인+단체) ÷ 전체 · 외국인 단체 포함',
  };
  const cards = report.metrics
    .map((m) => {
      const trend = m.change === null ? '' : m.change < 0 ? 'down' : 'up';
      return (
        '<div class="card"><b>' +
        escapeHtml(m.label) +
        '</b><strong>' +
        escapeHtml(metricCurrent(m)) +
        '</strong><span>전년 ' +
        escapeHtml(metricPrevious(m)) +
        ' · </span><span class="' +
        trend +
        '">' +
        escapeHtml(metricChange(m)) +
        '</span>' +
        (cardNote[m.label]
          ? '<em>' + escapeHtml(cardNote[m.label]) + '</em>'
          : '') +
        '<em>' +
        escapeHtml(
          metricStatus(m) +
            ' · 누락 당년 ' +
            dayCount(m.missing) +
            ' / 전년 ' +
            dayCount(m.previousMissing),
        ) +
        '</em></div>'
      );
    })
    .join('');
  const partColors = ['#8A968E', '#2F6B4F', '#1B5E9E', '#D9822B'];
  const parts = compositionOf(report);
  const barReady = parts.every((p) => p.currentShare !== null);
  // 겹치지 않는 네 구분을 한 줄로 쌓고, 단체·외국인 구성비가 어디까지인지 괄호로 표시한다.
  const compositionBar = barReady
    ? '<div class="bar">' +
      [0, 1, 3, 2]
        .map((i) => [parts[i], i] as const)
        .map(
          ([p, i]) =>
            '<i style="width:' +
            p.currentShare!.toFixed(2) +
            '%;background:' +
            partColors[i] +
            '">' +
            (p.currentShare! >= 6
              ? escapeHtml(p.label + ' ' + p.currentShare!.toFixed(1) + '%')
              : '') +
            '</i>',
        )
        .join('') +
      '</div><div class="bracket">' +
      '<span style="width:' +
      parts[0].currentShare!.toFixed(2) +
      '%;border-color:transparent"></span>' +
      '<span style="width:' +
      (parts[1].currentShare! + parts[3].currentShare!).toFixed(2) +
      '%;color:#2F6B4F;border-color:#2F6B4F">단체 구성비 ' +
      (parts[1].currentShare! + parts[3].currentShare!).toFixed(1) +
      '%</span></div><div class="bracket">' +
      '<span style="width:' +
      (parts[0].currentShare! + parts[1].currentShare!).toFixed(2) +
      '%;border-color:transparent"></span>' +
      '<span style="width:' +
      (parts[2].currentShare! + parts[3].currentShare!).toFixed(2) +
      '%;color:#1B5E9E;border-color:#1B5E9E">외국인 구성비 ' +
      (parts[2].currentShare! + parts[3].currentShare!).toFixed(1) +
      '%</span></div>'
    : '';
  const seen: string[] = [];
  const section = (t: ReportTable) => {
    const keyValue = t.headers.length === 2;
    // 요약 카드가 이미 보여주는 지표 줄은 표에서 뺀다.
    const rows = t.rows
      .map((row, i) => ({ row, tone: t.tones?.[i] }))
      .filter(({ tone }) => tone !== 'metric');
    const head = '<section><h2>' + escapeHtml(t.name) + '</h2>';
    if (!rows.length)
      return head + '<p class="empty">표시할 항목이 없습니다.</p></section>';
    const weight = t.widths.reduce((a, b) => a + b, 0);
    const cols = t.widths
      .map(
        (w) => '<col style="width:' + ((w / weight) * 100).toFixed(2) + '%">',
      )
      .join('');
    const body = rows
      .map(({ row, tone }) => {
        const toneColor = tone && tone !== 'metric' ? palette[tone] : undefined;
        const cells = row.map((v, col) => {
          const header = t.headers[col];
          const color = colorOf(header, v, seen);
          const isNumber = typeof v === 'number';
          const trend =
            trendHeaders.includes(header) && isNumber
              ? v < 0
                ? ' down'
                : ' up'
              : '';
          const style = toneColor
            ? col === 0
              ? badge(toneColor)
              : ' style="background:#' + toneColor.bg + '"'
            : color
              ? badge(color)
              : '';
          return (
            '<td' +
            (isNumber ? ' class="num' + trend + '"' : '') +
            style +
            '>' +
            escapeHtml(isNumber ? formatNumber(v) : v) +
            '</td>'
          );
        });
        return '<tr>' + cells.join('') + '</tr>';
      })
      .join('');
    return (
      head +
      '<table' +
      (keyValue ? ' class="kv"' : '') +
      '><colgroup>' +
      cols +
      '</colgroup><thead><tr>' +
      t.headers.map((h) => '<th>' + escapeHtml(h) + '</th>').join('') +
      '</tr></thead><tbody>' +
      body +
      '</tbody></table></section>'
    );
  };
  return (
    '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>' +
    escapeHtml(filename(report)) +
    '</title><style>' +
    reportCss +
    '</style></head><body><button onclick="window.print()">PDF로 저장 / 인쇄</button><h1>' +
    escapeHtml(report.config.title) +
    '</h1><p class="meta">' +
    escapeHtml(
      report.config.meetingDate +
        ' · ' +
        report.config.author +
        ' · 수정 ' +
        report.revision,
    ) +
    '</p>' +
    (cards ? '<div class="cards">' + cards + '</div>' : '') +
    dailyChartHtml(report) +
    compositionBar +
    reportTables(report).map(section).join('') +
    '</body></html>'
  );
}
export function printReport(report: ReportDocument) {
  const previousFocus = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label', '보고서 출력 미리보기');
  dialog.style.cssText =
    'width:min(1200px,96vw);max-width:96vw;height:92vh;max-height:92vh;padding:0;border:1px solid #bccbc0;border-radius:12px;background:white;color:#183b2b;overflow:hidden';
  const toolbar = document.createElement('div');
  toolbar.style.cssText =
    'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid #bccbc0;font:14px "Malgun Gothic",sans-serif';
  const title = document.createElement('strong');
  title.textContent = '보고서 출력 미리보기';
  const close = document.createElement('button');
  close.textContent = '닫기';
  close.type = 'button';
  close.style.cssText =
    'padding:8px 16px;border:1px solid #bccbc0;border-radius:6px;cursor:pointer;background:white;color:#183b2b';
  close.onclick = () => dialog.close();
  toolbar.appendChild(title);
  toolbar.appendChild(close);
  const frame = document.createElement('iframe');
  frame.title = '인쇄할 보고서';
  frame.style.cssText =
    'width:100%;height:calc(100% - 62px);border:0;background:white';
  // Keep the printable document in the app. Electron routes new windows to
  // the external browser, which cannot open this renderer's blob URLs.
  frame.srcdoc = reportHtml(report);
  dialog.appendChild(toolbar);
  dialog.appendChild(frame);
  dialog.addEventListener(
    'close',
    () => {
      dialog.remove();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    },
    { once: true },
  );
  document.body.appendChild(dialog);
  dialog.showModal();
  close.focus();
}
