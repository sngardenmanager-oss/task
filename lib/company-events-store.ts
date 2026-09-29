import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase-server';
import type { CompanyEvent } from '@/lib/types';

const localEvents = new Map<string, CompanyEvent>();

/** 테이블이 아직 없을 때(0005 마이그레이션 전)는 전사 일정이 없는 것으로 봅니다. */
const isMissingTable = (code?: string) => code === '42P01' || code === 'PGRST205';

export class CompanyEventsUnavailable extends Error {}

export async function listCompanyEvents(): Promise<CompanyEvent[]> {
  if (!isSupabaseConfigured()) return [...localEvents.values()];
  const { data, error } = await getSupabaseAdmin()
    .from('company_events')
    .select('payload');
  if (error) {
    if (isMissingTable(error.code)) return [];
    throw new Error(`Supabase company events read failed: ${error.message}`);
  }
  return (data as { payload: CompanyEvent }[])
    .map((row) => row.payload)
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

export async function saveCompanyEvent(event: CompanyEvent) {
  if (!isSupabaseConfigured()) {
    localEvents.set(event.id, event);
    return;
  }
  const { error } = await getSupabaseAdmin()
    .from('company_events')
    .upsert({ id: event.id, payload: event, updated_at: event.updatedAt });
  if (error) {
    if (isMissingTable(error.code))
      throw new CompanyEventsUnavailable(
        '전사 일정 저장소가 아직 준비되지 않았습니다. 0005 마이그레이션을 실행해 주세요.',
      );
    throw new Error(`Supabase company events write failed: ${error.message}`);
  }
}

export async function deleteCompanyEvent(id: string) {
  if (!isSupabaseConfigured()) {
    localEvents.delete(id);
    return;
  }
  const { error } = await getSupabaseAdmin()
    .from('company_events')
    .delete()
    .eq('id', id);
  if (error && !isMissingTable(error.code))
    throw new Error(`Supabase company events delete failed: ${error.message}`);
}
