import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase-server';

const local = new Map<string, unknown>();
const isMissing = (code?: string) => code === '42P01' || code === 'PGRST205';

export class SettingsUnavailable extends Error {}

/** 앱 전체 설정 한 칸을 읽습니다. 저장소(0006)가 아직 없으면 null입니다. */
export async function readSetting<T>(key: string): Promise<T | null> {
  if (!isSupabaseConfigured()) return (local.get(key) as T) ?? null;
  const { data, error } = await getSupabaseAdmin()
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle<{ value: T }>();
  if (error) {
    if (isMissing(error.code)) return null;
    throw new Error(`Supabase settings read failed: ${error.message}`);
  }
  return data?.value ?? null;
}

export async function writeSetting(key: string, value: unknown) {
  if (!isSupabaseConfigured()) {
    local.set(key, value);
    return;
  }
  const { error } = await getSupabaseAdmin()
    .from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) {
    if (isMissing(error.code))
      throw new SettingsUnavailable(
        '백업 기록 저장소가 아직 준비되지 않았습니다. 0006 준비 명령을 실행해 주세요.',
      );
    throw new Error(`Supabase settings write failed: ${error.message}`);
  }
}

/** 용량 경고용: 팀 업무·보고서 저장소의 크기(바이트)만 조회합니다. 저장소(0006)가 없으면 빈 목록입니다. */
export async function readStorageSizes(): Promise<
  { kind: 'workspace' | 'report'; key: string; bytes: number }[]
> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await getSupabaseAdmin()
    .from('storage_sizes')
    .select('kind,key,bytes');
  if (error) {
    if (isMissing(error.code)) return [];
    throw new Error(`Supabase size read failed: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    kind: row.kind,
    key: row.key,
    bytes: Number(row.bytes),
  }));
}
