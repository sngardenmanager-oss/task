import { randomUUID } from 'node:crypto';
import { readSetting, writeSetting } from '@/lib/app-settings-store';
import type { MasterAlert } from '@/lib/types';

const KEY = 'master_alerts';
const kstDay = (iso: string) =>
  new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

/** 마스터에게만 보이는 알림을 남깁니다. 같은 팀·같은 종류는 하루에 한 줄로 묶고 횟수만 늘립니다.
 * 알림 저장에 실패해도 사용자의 작업은 막지 않습니다(직원 화면에는 아무것도 드러내지 않음). */
export async function recordMasterAlert(
  alert: Pick<MasterAlert, 'kind' | 'teamId'> & { bytes?: number },
) {
  try {
    const now = new Date().toISOString();
    const alerts = (await readSetting<MasterAlert[]>(KEY)) ?? [];
    const same = alerts.find(
      (item) =>
        !item.dismissedAt &&
        item.kind === alert.kind &&
        item.teamId === alert.teamId &&
        kstDay(item.at) === kstDay(now),
    );
    const next = same
      ? alerts.map((item) =>
          item === same
            ? { ...item, at: now, count: item.count + 1, bytes: alert.bytes ?? item.bytes }
            : item,
        )
      : [{ id: randomUUID(), at: now, count: 1, ...alert }, ...alerts];
    await writeSetting(KEY, next.slice(0, 50));
  } catch (error) {
    console.error('Master alert:', error);
  }
}

export async function listMasterAlerts(): Promise<MasterAlert[]> {
  return ((await readSetting<MasterAlert[]>(KEY)) ?? []).filter(
    (item) => !item.dismissedAt,
  );
}

export async function dismissMasterAlert(id: string) {
  const alerts = (await readSetting<MasterAlert[]>(KEY)) ?? [];
  await writeSetting(
    KEY,
    alerts.map((item) =>
      item.id === id ? { ...item, dismissedAt: new Date().toISOString() } : item,
    ),
  );
}
