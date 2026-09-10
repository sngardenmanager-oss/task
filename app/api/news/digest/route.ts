import {
  ApiError,
  apiErrorResponse,
  authenticateRequest,
  requireWorkspaceMember,
} from '@/lib/auth-server';
import { readNewsDigest, writeNewsDigest } from '@/lib/news-store';
import { readWorkspaceState } from '@/lib/workspace-store';
import type { NewsItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

const DIGEST_ID_PREFIX = 'digest-';

type RawNewsItem = {
  id: string;
  title: string;
  category: string;
  source: string;
  url?: string;
  pubDate: string;
};

function safeHttpUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const trimmed = value.trim();
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? trimmed
      : undefined;
  } catch {
    return undefined;
  }
}

function isRawNewsItem(value: unknown): value is RawNewsItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<RawNewsItem>;
  return (
    typeof item.id === 'string' &&
    typeof item.title === 'string' &&
    Boolean(item.title.trim()) &&
    typeof item.category === 'string' &&
    Boolean(item.category.trim()) &&
    typeof item.pubDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(item.pubDate)
  );
}

export async function POST(request: Request) {
  try {
    const [user, state, body] = await Promise.all([
      authenticateRequest(request),
      readWorkspaceState(),
      request.json() as Promise<{ items?: unknown[] }>,
    ]);
    const actor = requireWorkspaceMember(state, user.email!);
    if (actor.role !== 'admin') {
      throw new ApiError('관광뉴스 자동 수집은 관리자만 할 수 있습니다.', 403);
    }

    const incoming: NewsItem[] = (Array.isArray(body.items) ? body.items : [])
      .filter(isRawNewsItem)
      .slice(0, 5000)
      .map((item) => ({
        id: `${DIGEST_ID_PREFIX}${item.id}`,
        title: item.title.trim(),
        category: item.category.trim(),
        source: typeof item.source === 'string' ? item.source.trim() : '',
        collectedAt: item.pubDate,
        url: safeHttpUrl(item.url),
      }));
    const existing = await readNewsDigest();
    const manualItems = existing.filter(
      (item) => !item.id.startsWith(DIGEST_ID_PREFIX),
    );
    const items = [...incoming, ...manualItems];
    await writeNewsDigest(items);
    return Response.json(
      { items },
      { headers: { 'cache-control': 'private, no-store, max-age=0' } },
    );
  } catch (error) {
    return apiErrorResponse(error, '관광뉴스를 자동으로 정리하지 못했습니다.');
  }
}
