import { seedNews } from '@/lib/seed';
import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase-server';
import type { NewsItem } from '@/lib/types';

type StoredRow = { items: NewsItem[] };

export async function readNewsDigest(): Promise<NewsItem[]> {
  if (!isSupabaseConfigured()) return structuredClone(seedNews);

  const { data, error } = await getSupabaseAdmin()
    .from('news_digest')
    .select('items')
    .eq('id', 1)
    .maybeSingle<StoredRow>();

  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  if (data?.items) return data.items;

  const initialItems = structuredClone(seedNews);
  const { error: insertError } = await getSupabaseAdmin()
    .from('news_digest')
    .insert({
      id: 1,
      items: initialItems,
      updated_at: new Date().toISOString(),
    });
  if (insertError)
    throw new Error(`Supabase seed failed: ${insertError.message}`);
  return initialItems;
}

export async function writeNewsDigest(items: NewsItem[]): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const { error } = await getSupabaseAdmin().from('news_digest').upsert({
    id: 1,
    items,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Supabase write failed: ${error.message}`);
  return true;
}
