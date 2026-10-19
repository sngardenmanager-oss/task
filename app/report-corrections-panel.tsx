'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Member } from '@/lib/types';
import type { ReportDocument, ReportStore } from '@/lib/report-types';

const statusText = { open: '검토 대기', applied: '정정본으로 반영', dismissed: '반려' } as const;

/** 확정본 정정 제안. 오류를 발견한 사람이 제안을 남기고, 관리자가 반영(정정본 작성) 또는 반려합니다. */
export default function CorrectionPanel({
  report,
  store,
  actor,
  busy,
  onPropose,
  onDismiss,
  onApply,
}: {
  report: ReportDocument;
  store: ReportStore;
  actor: Member;
  busy: boolean;
  onPropose: (note: string) => Promise<boolean>;
  onDismiss: (proposalId: string, reason: string) => Promise<void>;
  onApply: (proposalIds: string[]) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const items = (store.corrections ?? [])
    .filter((item) => item.reportId === report.id)
    .sort((a, b) => b.at.localeCompare(a.at));
  const open = items.filter((item) => item.status === 'open');
  const admin = actor.role === 'admin';
  return (
    <section className="space-y-3 rounded-2xl border border-[#efcf94] bg-[#fffaf0] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-[#7a4500]">
          정정 제안 {open.length > 0 && <span>· 대기 {open.length}건</span>}
        </h3>
        {admin && open.length > 0 && (
          <Button disabled={busy} onClick={() => void onApply(open.map((item) => item.id))}>
            대기 제안 반영해 정정본 작성
          </Button>
        )}
      </div>
      <p className="text-sm text-[#7a5a2b]">
        확정본에서 오류를 발견하면 고칠 내용을 제안으로 남깁니다. 확정본은 그대로 보존되고, 관리자가 제안을
        반영하면 제안 내용이 정정 사유로 채워진 정정본이 열립니다.
      </p>
      <label className="block text-sm font-medium">
        잘못된 내용과 고칠 내용
        <textarea
          className="mt-1 min-h-20 w-full rounded-lg border border-[#e2c58f] bg-white p-2 text-sm"
          maxLength={2000}
          value={note}
          placeholder="예: 입장객 9/30 수치 단위 오류(1,200 → 12,000)"
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <Button
        variant="outline"
        disabled={busy || !note.trim()}
        onClick={() =>
          void onPropose(note).then((ok) => {
            if (ok) setNote('');
          })
        }
      >
        정정 제안 등록
      </Button>
      {items.length > 0 && (
        <ol className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <b>{item.proposedByName}</b> · {new Date(item.at).toLocaleString('ko-KR')}
                </span>
                <span
                  className={
                    'rounded-full px-2 py-0.5 text-xs font-bold ' +
                    (item.status === 'open'
                      ? 'bg-[#fff3dc] text-[#9a5800]'
                      : 'bg-[#eef1ec] text-[#64776a]')
                  }
                >
                  {statusText[item.status]}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap">{item.note}</p>
              {item.status !== 'open' && (
                <p className="mt-1 text-xs text-[#64776a]">
                  {item.resolvedByName} · {item.resolution}
                </p>
              )}
              {admin && item.status === 'open' && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <input
                    aria-label="반려 사유"
                    className="min-w-0 flex-1 rounded-lg border p-2 text-sm"
                    placeholder="반려 사유"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !reason.trim()}
                    onClick={() => void onDismiss(item.id, reason).then(() => setReason(''))}
                  >
                    반려
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
