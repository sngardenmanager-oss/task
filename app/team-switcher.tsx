'use client';

import { Layers } from 'lucide-react';
import { ALL_TEAMS_ID } from '@/lib/team-access';
import type { Team } from '@/lib/types';

/** 사이드바 맨 위의 팀 전환 메뉴. 마스터에게는 맨 위에 '전체 팀(통합 관제)'이 있습니다. */
export default function TeamSwitcher({
  current,
  teams,
  isMaster,
  onSwitch,
}: {
  current: string;
  teams: Team[];
  isMaster: boolean;
  onSwitch: (teamId: string) => void;
}) {
  const currentTeam = teams.find((team) => team.id === current);
  return (
    <label className="mb-4 block rounded-2xl border border-[#d8ded4] bg-white p-2">
      <span className="flex items-center gap-1.5 px-1 text-[11px] font-bold text-[#708076]">
        <Layers className="size-3.5" />
        {isMaster ? '팀 선택 · 마스터' : '팀 선택'}
      </span>
      <span className="mt-1 flex items-center gap-2">
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{
            background:
              current === ALL_TEAMS_ID ? '#26352d' : (currentTeam?.color ?? '#9ca3af'),
          }}
        />
        <select
          aria-label="팀 선택"
          value={current}
          onChange={(event) => {
            if (event.target.value !== current) onSwitch(event.target.value);
          }}
          className="h-9 w-full min-w-0 cursor-pointer rounded-lg bg-transparent text-sm font-black outline-none"
        >
          {isMaster && <option value={ALL_TEAMS_ID}>전체 팀 (통합 관제)</option>}
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}
