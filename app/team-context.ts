'use client';

import { createContext, useContext } from 'react';
import type { Team } from '@/lib/types';

/** 지금 보고 있는 팀. 업무 화면 안쪽 어디서든 팀별 API 주소를 만들 때 씁니다. */
export const CurrentTeamContext = createContext<Team | null>(null);

export function useCurrentTeam() {
  return useContext(CurrentTeamContext);
}

/** API 주소에 ?team= 을 붙입니다. 서버는 이 값으로 팀 소속을 다시 확인합니다. */
export function withTeam(path: string, teamId?: string | null) {
  if (!teamId) return path;
  return `${path}${path.includes('?') ? '&' : '?'}team=${encodeURIComponent(teamId)}`;
}
