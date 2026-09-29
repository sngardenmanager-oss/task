'use client';

import { useState } from 'react';
import { CalendarPlus, Pencil, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { COMPANY_COLOR } from '@/lib/company-events';
import type { CompanyEvent, Team } from '@/lib/types';

const inputClass =
  'h-10 w-full rounded-xl border border-[#d8ded4] bg-white px-3 text-sm outline-none focus:border-[#2f6b4f]';

type Draft = {
  id?: string;
  title: string;
  description: string;
  date: string;
  endDate: string;
  time: string;
  endTime: string;
  allTeams: boolean;
  teamIds: string[];
};

const emptyDraft = (date: string): Draft => ({
  title: '',
  description: '',
  date,
  endDate: '',
  time: '',
  endTime: '',
  allTeams: true,
  teamIds: [],
});

const formatDay = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  });

/** 마스터 전용: 전사 공통 일정 등록·수정·삭제. 대상 팀 캘린더와 오늘 화면에 읽기 전용으로 보입니다. */
export default function CompanyEventsPanel({
  events,
  teams,
  accessToken,
  onChanged,
}: {
  events: CompanyEvent[];
  teams: Team[];
  accessToken: string;
  onChanged: (events: CompanyEvent[]) => void;
}) {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPast, setShowPast] = useState(false);

  async function send(method: 'POST' | 'DELETE', body?: unknown, id?: string) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        id ? `/api/company-events?id=${encodeURIComponent(id)}` : '/api/company-events',
        {
          method,
          headers: {
            authorization: `Bearer ${accessToken}`,
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        },
      );
      const result = (await response.json()) as { events?: CompanyEvent[]; error?: string };
      if (!response.ok || !result.events)
        throw new Error(result.error ?? '전사 일정을 처리하지 못했습니다.');
      onChanged(result.events);
      setDraft(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '처리하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  const teamNames = (event: CompanyEvent) =>
    event.teamIds.length
      ? event.teamIds.map((id) => teams.find((team) => team.id === id)?.name ?? id).join(', ')
      : '모든 팀';
  const listed = events
    .filter((event) => showPast || (event.endDate ?? event.date) >= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <section className="rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h3 className="font-black">전사 공통 일정</h3>
          <p className="mt-1 text-xs text-[#748078]">
            등록하면 대상 팀 캘린더와 오늘 화면에 읽기 전용으로 보이고, 구글 캘린더 구독에도 들어갑니다.
          </p>
        </div>
        <label className="flex items-center gap-1.5 text-xs font-bold text-[#5f6d64]">
          <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />
          지난 일정도 보기
        </label>
        <Button disabled={busy} onClick={() => setDraft(emptyDraft(today))}>
          <CalendarPlus />
          일정 등록
        </Button>
      </div>
      {error && (
        <p role="alert" className="mb-3 rounded-xl bg-[#f7e8e4] px-3 py-2 text-sm font-semibold text-[#8d342e]">
          {error}
        </p>
      )}

      {draft && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send('POST', {
              event: {
                id: draft.id,
                title: draft.title,
                description: draft.description,
                date: draft.date,
                endDate: draft.endDate || undefined,
                time: draft.time || undefined,
                endTime: draft.endTime || undefined,
                teamIds: draft.allTeams ? [] : draft.teamIds,
              },
            });
          }}
          className="mb-4 space-y-3 rounded-2xl border border-[#ead7b8] bg-white p-4"
        >
          <div className="flex items-center">
            <strong className="text-sm">{draft.id ? '전사 일정 수정' : '새 전사 일정'}</strong>
            <Button type="button" variant="ghost" size="icon" aria-label="닫기" className="ml-auto" onClick={() => setDraft(null)}>
              <X />
            </Button>
          </div>
          <label className="block text-xs font-bold text-[#5f6d64]">
            일정 이름
            <input
              required
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className={`${inputClass} mt-1`}
              placeholder="예: 할로윈 페스티벌 오픈"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="block text-xs font-bold text-[#5f6d64]">
              시작일
              <input type="date" required value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className={`${inputClass} mt-1`} />
            </label>
            <label className="block text-xs font-bold text-[#5f6d64]">
              종료일(선택)
              <input type="date" value={draft.endDate} min={draft.date} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} className={`${inputClass} mt-1`} />
            </label>
            <label className="block text-xs font-bold text-[#5f6d64]">
              시작 시각(선택)
              <input type="time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} className={`${inputClass} mt-1`} />
            </label>
            <label className="block text-xs font-bold text-[#5f6d64]">
              종료 시각(선택)
              <input type="time" value={draft.endTime} disabled={!draft.time} onChange={(e) => setDraft({ ...draft, endTime: e.target.value })} className={`${inputClass} mt-1`} />
            </label>
          </div>
          <label className="block text-xs font-bold text-[#5f6d64]">
            내용(선택)
            <textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className="mt-1 min-h-20 w-full rounded-xl border border-[#d8ded4] p-3 text-sm outline-none focus:border-[#2f6b4f]"
            />
          </label>
          <fieldset className="rounded-xl bg-[#f7f6f0] p-3">
            <legend className="px-1 text-xs font-bold text-[#5f6d64]">보여 줄 팀</legend>
            <label className="mr-4 inline-flex items-center gap-1.5 text-sm font-bold">
              <input type="radio" checked={draft.allTeams} onChange={() => setDraft({ ...draft, allTeams: true })} />
              모든 팀
            </label>
            <label className="inline-flex items-center gap-1.5 text-sm font-bold">
              <input type="radio" checked={!draft.allTeams} onChange={() => setDraft({ ...draft, allTeams: false })} />
              선택한 팀만
            </label>
            {!draft.allTeams && (
              <div className="mt-2 flex flex-wrap gap-3">
                {teams.map((team) => (
                  <label key={team.id} className="inline-flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.teamIds.includes(team.id)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          teamIds: e.target.checked
                            ? [...draft.teamIds, team.id]
                            : draft.teamIds.filter((id) => id !== team.id),
                        })
                      }
                    />
                    {team.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDraft(null)}>
              취소
            </Button>
            <Button type="submit" disabled={busy || (!draft.allTeams && !draft.teamIds.length)}>
              저장
            </Button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {listed.length ? (
          listed.map((event) => (
            <div key={event.id} className="flex items-center gap-3 rounded-xl border border-[#e0e3de] bg-white p-3">
              <span className="h-10 w-1.5 shrink-0 rounded-full" style={{ background: COMPANY_COLOR }} />
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-sm">{event.title}</strong>
                <span className="text-xs text-[#748078]">
                  {formatDay(event.date)}
                  {event.endDate ? ` ~ ${formatDay(event.endDate)}` : ''}
                  {event.time ? ` ${event.time}${event.endTime ? `~${event.endTime}` : ''}` : ''} ·{' '}
                  {teamNames(event)}
                </span>
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  setDraft({
                    id: event.id,
                    title: event.title,
                    description: event.description,
                    date: event.date,
                    endDate: event.endDate ?? '',
                    time: event.time ?? '',
                    endTime: event.endTime ?? '',
                    allTeams: !event.teamIds.length,
                    teamIds: event.teamIds,
                  })
                }
              >
                <Pencil />
                수정
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`'${event.title}' 일정을 지울까요? 모든 팀 캘린더에서 사라집니다.`))
                    void send('DELETE', undefined, event.id);
                }}
              >
                <Trash2 />
                삭제
              </Button>
            </div>
          ))
        ) : (
          <p className="py-6 text-center text-sm text-[#748078]">
            {showPast ? '등록된 전사 일정이 없습니다.' : '예정된 전사 일정이 없습니다.'}
          </p>
        )}
      </div>
    </section>
  );
}
