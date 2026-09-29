'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowRightLeft,
  Check,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  UserMinus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Role, Team, TeamDirectoryEntry } from '@/lib/types';

const inputClass =
  'h-10 w-full rounded-xl border border-[#d8ded4] bg-white px-3 text-sm outline-none transition focus:border-[#2f6b4f] focus:ring-2 focus:ring-[#2f6b4f]/10';
const roleLabels: Record<Role, string> = {
  admin: '관리자(팀장)',
  member: '팀원',
  commenter: '조회·댓글',
};
const palette = ['#2f6b4f', '#547da8', '#9b6caf', '#d58b45', '#cc6b61', '#4f8a8b', '#8a7a4f'];

type Directory = { teams: Team[]; people: TeamDirectoryEntry[] };

/** 마스터 전용 '팀 관리': 팀 만들기·이름·색·중단, 사람의 팀 이동·권한 변경·내보내기. */
export default function TeamManagementPanel({
  accessToken,
  currentTeamId,
  onTeamsChanged,
}: {
  accessToken: string;
  currentTeamId: string;
  /** 팀 목록이 바뀌면 사이드바 팀 메뉴를 새로 받도록 화면을 다시 엽니다. */
  onTeamsChanged: () => void;
}) {
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(palette[1]);

  const call = useCallback(
    async (init?: { body: unknown }) => {
      const response = await fetch('/api/teams', {
        method: init ? 'POST' : 'GET',
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(init ? { 'content-type': 'application/json' } : {}),
        },
        body: init ? JSON.stringify(init.body) : undefined,
        cache: 'no-store',
      });
      const result = (await response.json()) as Partial<Directory> & {
        error?: string;
      };
      if (!response.ok || !result.teams || !result.people)
        throw new Error(result.error ?? '팀 정보를 처리하지 못했습니다.');
      setDirectory({ teams: result.teams, people: result.people });
    },
    [accessToken],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void call().catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : '팀 목록을 불러오지 못했습니다.'),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [call]);

  async function run(body: unknown, done: string, teamsChanged = false) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await call({ body });
      setMessage(done);
      if (teamsChanged) onTeamsChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '처리하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  const teams = directory?.teams ?? [];
  const activeTeams = teams.filter((team) => team.active);
  const teamName = (id: string) => teams.find((team) => team.id === id)?.name ?? id;
  const people = [...(directory?.people ?? [])].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      teamName(a.teamId).localeCompare(teamName(b.teamId)) ||
      a.name.localeCompare(b.name),
  );

  return (
    <section className="rounded-3xl border-2 border-[#2f6b4f]/30 bg-[#fbfaf5] p-5">
      <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h3 className="font-black">팀 관리 · 마스터</h3>
          <p className="mt-1 text-xs text-[#748078]">
            팀을 만들고 사람을 팀에 배정합니다. 직원은 한 팀에만 소속되며 자기 팀 업무만 봅니다.
            새 팀의 첫 관리자는 아래 가입 승인 또는 팀 이동에서 &lsquo;관리자&rsquo;로 지정해 주세요.
          </p>
        </div>
        <Button variant="outline" disabled={busy} onClick={() => void call()}>
          <RefreshCw />
          새로고침
        </Button>
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded-xl bg-[#f7e8e4] px-3 py-2 text-sm font-semibold text-[#8d342e]">
          {error}
        </p>
      )}
      {message && (
        <output className="mb-3 block rounded-xl bg-[#e7f0eb] px-3 py-2 text-sm font-semibold text-[#2f6b4f]">
          {message}
        </output>
      )}

      {!directory ? (
        <p className="flex items-center gap-2 text-sm text-[#748078]">
          <LoaderCircle className="size-4 animate-spin" /> 팀 목록을 불러오는 중입니다.
        </p>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="space-y-2">
            <h4 className="text-sm font-black">팀</h4>
            {teams.map((team) => (
              <div
                key={team.id}
                className={`flex items-center gap-2 rounded-xl border border-[#e0e3de] bg-white p-3 ${team.active ? '' : 'opacity-50'}`}
              >
                <label
                  title={`${team.name} 색상 변경`}
                  className="relative grid size-8 shrink-0 cursor-pointer place-items-center rounded-full hover:bg-[#eef0ea]"
                >
                  <input
                    type="color"
                    aria-label={`${team.name} 색상 선택`}
                    value={team.color}
                    onChange={(event) =>
                      void run(
                        { action: 'updateTeam', teamId: team.id, color: event.target.value },
                        '팀 색상을 바꿨습니다.',
                      )
                    }
                    className="absolute inset-0 size-full cursor-pointer opacity-0"
                  />
                  <span className="size-3.5 rounded-full" style={{ background: team.color }} />
                </label>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm">
                    {team.name}
                    {team.id === currentTeamId && (
                      <span className="ml-1.5 text-[10px] font-bold text-[#2f6b4f]">보는 중</span>
                    )}
                  </strong>
                  <span className="text-xs text-[#748078]">
                    {people.filter((p) => p.active && p.teamId === team.id).length}명
                    {team.active ? '' : ' · 중단됨'}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    const name = window.prompt('팀 이름', team.name);
                    if (name === null || !name.trim() || name.trim() === team.name) return;
                    void run(
                      { action: 'updateTeam', teamId: team.id, name: name.trim() },
                      '팀 이름을 바꿨습니다.',
                      true,
                    );
                  }}
                >
                  <Pencil />
                  이름
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || (team.active && team.id === currentTeamId)}
                  title={
                    team.active && team.id === currentTeamId
                      ? '보고 있는 팀은 중단할 수 없습니다.'
                      : undefined
                  }
                  onClick={() => {
                    if (
                      team.active &&
                      !window.confirm(
                        `${team.name}을(를) 중단할까요?\n소속 직원은 이 팀에 들어갈 수 없게 됩니다. 데이터는 지워지지 않고, 복원하면 다시 쓸 수 있습니다.`,
                      )
                    )
                      return;
                    void run(
                      { action: 'updateTeam', teamId: team.id, active: !team.active },
                      team.active ? '팀을 중단했습니다.' : '팀을 복원했습니다.',
                      true,
                    );
                  }}
                >
                  {team.active ? <Pause /> : <Play />}
                  {team.active ? '중단' : '복원'}
                </Button>
              </div>
            ))}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!newName.trim()) return;
                void run(
                  { action: 'createTeam', name: newName.trim(), color: newColor },
                  `${newName.trim()}을(를) 만들었습니다. 가입 승인에서 첫 관리자를 지정해 주세요.`,
                  true,
                ).then(() => setNewName(''));
              }}
              className="flex gap-2 rounded-xl border border-dashed border-[#c9d1c6] p-3"
            >
              <label className="relative grid size-10 shrink-0 cursor-pointer place-items-center rounded-xl border border-[#d8ded4] bg-white">
                <input
                  type="color"
                  aria-label="새 팀 색상"
                  value={newColor}
                  onChange={(event) => setNewColor(event.target.value)}
                  className="absolute inset-0 size-full cursor-pointer opacity-0"
                />
                <span className="size-4 rounded-full" style={{ background: newColor }} />
              </label>
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="새 팀 이름"
                aria-label="새 팀 이름"
                className={inputClass}
              />
              <Button type="submit" disabled={busy || !newName.trim()}>
                <Plus />
                팀 만들기
              </Button>
            </form>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-black">직원 소속</h4>
            {people.length ? (
              people.map((person) => (
                <PersonRow
                  key={`${person.teamId}:${person.email}`}
                  person={person}
                  teams={activeTeams}
                  teamName={teamName(person.teamId)}
                  busy={busy}
                  onApply={(toTeamId, role) =>
                    toTeamId === person.teamId
                      ? run(
                          { action: 'setRole', email: person.email, teamId: toTeamId, role },
                          `${person.name}님의 권한을 ${roleLabels[role]}(으)로 바꿨습니다.`,
                        )
                      : run(
                          { action: 'moveMember', email: person.email, toTeamId, role },
                          `${person.name}님을 ${teamName(toTeamId)}(으)로 옮겼습니다.`,
                        )
                  }
                  onRemove={() => {
                    if (
                      !window.confirm(
                        `${person.name}님을 ${teamName(person.teamId)}에서 내보낼까요?\n과거 기록은 남고, 미완료 업무는 그 팀 관리자에게 넘어갑니다. 가입 승인 대기로 돌아갑니다.`,
                      )
                    )
                      return;
                    void run(
                      { action: 'removeMember', email: person.email, teamId: person.teamId },
                      `${person.name}님을 팀에서 내보냈습니다.`,
                    );
                  }}
                />
              ))
            ) : (
              <p className="text-sm text-[#748078]">소속된 직원이 없습니다.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function PersonRow({
  person,
  teams,
  teamName,
  busy,
  onApply,
  onRemove,
}: {
  person: TeamDirectoryEntry;
  teams: Team[];
  teamName: string;
  busy: boolean;
  onApply: (toTeamId: string, role: Role) => Promise<void>;
  onRemove: () => void;
}) {
  const [teamId, setTeamId] = useState(person.teamId);
  const [role, setRole] = useState<Role>(person.role);
  const changed = teamId !== person.teamId || role !== person.role;
  if (!person.active)
    return (
      <div className="flex items-center gap-3 rounded-xl border border-[#e0e3de] bg-white p-3 opacity-50">
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-sm">{person.name}</strong>
          <span className="block truncate text-xs text-[#748078]">
            {person.email} · {teamName} · 퇴사(비활성)
          </span>
        </span>
      </div>
    );
  return (
    <div className="rounded-xl border border-[#e0e3de] bg-white p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-sm">{person.name}</strong>
          <span className="block truncate text-xs text-[#748078]">{person.email}</span>
        </span>
        <Button size="sm" variant="outline" disabled={busy} onClick={onRemove}>
          <UserMinus />
          내보내기
        </Button>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_140px_auto]">
        <select
          aria-label={`${person.name} 소속 팀`}
          value={teamId}
          onChange={(event) => setTeamId(event.target.value)}
          className={inputClass}
        >
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
        <select
          aria-label={`${person.name} 권한`}
          value={role}
          onChange={(event) => setRole(event.target.value as Role)}
          className={inputClass}
        >
          {(Object.keys(roleLabels) as Role[]).map((key) => (
            <option key={key} value={key}>
              {roleLabels[key]}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          className="h-10"
          disabled={busy || !changed}
          onClick={() => void onApply(teamId, role)}
        >
          {teamId !== person.teamId ? <ArrowRightLeft /> : <Check />}
          {teamId !== person.teamId ? '팀 이동' : '적용'}
        </Button>
      </div>
    </div>
  );
}
