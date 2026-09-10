import {
  ApiError,
  apiErrorResponse,
  authenticateRequest,
  requireWorkspaceMember,
} from '@/lib/auth-server';
import { buildNewsDigest } from '@/lib/news-digest';
import { readNewsDigest, writeNewsDigest } from '@/lib/news-store';
import { readWorkspaceState } from '@/lib/workspace-store';

export const dynamic = 'force-dynamic';

const DIGEST_ID_PREFIX = 'digest-';

type RawNewsFile = {
  id: string;
  name: string;
  content: string;
  modifiedAt: string;
};

export async function POST(request: Request) {
  try {
    const [user, state, body] = await Promise.all([
      authenticateRequest(request),
      readWorkspaceState(),
      request.json() as Promise<{ files?: RawNewsFile[] }>,
    ]);
    const actor = requireWorkspaceMember(state, user.email!);
    if (actor.role !== 'admin') {
      throw new ApiError('관광뉴스 자동 수집은 관리자만 할 수 있습니다.', 403);
    }

    const files = body.files ?? [];
    const digest = buildNewsDigest(files);
    const existing = await readNewsDigest();
    const manualItems = existing.filter(
      (item) => !item.id.startsWith(DIGEST_ID_PREFIX),
    );
    const items = [...digest, ...manualItems];
    await writeNewsDigest(items);
    return Response.json(
      { items },
      { headers: { 'cache-control': 'private, no-store, max-age=0' } },
    );
  } catch (error) {
    return apiErrorResponse(error, '관광뉴스를 자동으로 정리하지 못했습니다.');
  }
}
