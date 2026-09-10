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

async function requireAdminActor(request: Request) {
  const [user, state] = await Promise.all([
    authenticateRequest(request),
    readWorkspaceState(),
  ]);
  const actor = requireWorkspaceMember(state, user.email!);
  if (actor.role !== 'admin') {
    throw new ApiError('관광뉴스 관리는 관리자만 할 수 있습니다.', 403);
  }
  return actor;
}

export async function GET(request: Request) {
  try {
    const [user, state] = await Promise.all([
      authenticateRequest(request),
      readWorkspaceState(),
    ]);
    requireWorkspaceMember(state, user.email!);
    const items = await readNewsDigest();
    return Response.json(
      { items },
      { headers: { 'cache-control': 'private, no-store, max-age=0' } },
    );
  } catch (error) {
    return apiErrorResponse(error, '관광뉴스를 불러오지 못했습니다.');
  }
}

export async function POST(request: Request) {
  try {
    await requireAdminActor(request);
    const body = (await request.json()) as { items?: NewsItem[] };
    if (!body.items?.length) {
      return Response.json(
        { error: '가져올 문서가 없습니다.' },
        { status: 400 },
      );
    }
    const existing = await readNewsDigest();
    const items = [...body.items, ...existing];
    await writeNewsDigest(items);
    return Response.json(
      { items },
      { headers: { 'cache-control': 'private, no-store, max-age=0' } },
    );
  } catch (error) {
    return apiErrorResponse(error, '관광뉴스를 저장하지 못했습니다.');
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAdminActor(request);
    const body = (await request.json()) as { item?: NewsItem };
    if (!body.item) {
      return Response.json(
        { error: '수정할 항목이 없습니다.' },
        { status: 400 },
      );
    }
    const nextItem = body.item;
    const existing = await readNewsDigest();
    const items = existing.map((news) =>
      news.id === nextItem.id ? nextItem : news,
    );
    await writeNewsDigest(items);
    return Response.json(
      { items },
      { headers: { 'cache-control': 'private, no-store, max-age=0' } },
    );
  } catch (error) {
    return apiErrorResponse(error, '관광뉴스를 수정하지 못했습니다.');
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdminActor(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return Response.json(
        { error: '삭제할 항목이 없습니다.' },
        { status: 400 },
      );
    }
    const existing = await readNewsDigest();
    const items = existing.filter((news) => news.id !== id);
    await writeNewsDigest(items);
    return Response.json(
      { items },
      { headers: { 'cache-control': 'private, no-store, max-age=0' } },
    );
  } catch (error) {
    return apiErrorResponse(error, '관광뉴스를 삭제하지 못했습니다.');
  }
}
