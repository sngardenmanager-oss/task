import { randomUUID } from 'node:crypto';
import {
  ApiError,
  apiErrorResponse,
  authenticateRequest,
  requireMaster,
} from '@/lib/auth-server';
import { normalizeCompanyEvent } from '@/lib/company-events';
import {
  CompanyEventsUnavailable,
  deleteCompanyEvent,
  listCompanyEvents,
  saveCompanyEvent,
} from '@/lib/company-events-store';
import type { CompanyEvent } from '@/lib/types';

export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'private, no-store, max-age=0' };

/** 전사 공통 일정 관리(마스터 전용). 각 팀 직원은 /api/state 응답으로 자기 팀 대상 일정만 받습니다. */
export async function GET(request: Request) {
  try {
    const user = await authenticateRequest(request);
    requireMaster(user.email!);
    return Response.json({ events: await listCompanyEvents() }, { headers });
  } catch (error) {
    return apiErrorResponse(error, '전사 일정을 불러오지 못했습니다.');
  }
}

export async function POST(request: Request) {
  try {
    const user = await authenticateRequest(request);
    requireMaster(user.email!);
    const body = (await request.json()) as { event?: Partial<CompanyEvent> };
    if (!body.event) throw new ApiError('저장할 일정이 없습니다.', 400);
    const events = await listCompanyEvents();
    const previous = body.event.id
      ? events.find((item) => item.id === body.event!.id)
      : undefined;
    if (body.event.id && !previous)
      throw new ApiError('수정할 일정을 찾을 수 없습니다.', 404);
    const event = normalizeCompanyEvent(body.event, previous);
    if (typeof event === 'string') throw new ApiError(event, 400);
    if (!event.id) event.id = `company-${randomUUID().slice(0, 12)}`;
    try {
      await saveCompanyEvent(event);
    } catch (error) {
      if (error instanceof CompanyEventsUnavailable)
        throw new ApiError(error.message, 503);
      throw error;
    }
    return Response.json({ event, events: await listCompanyEvents() }, { headers });
  } catch (error) {
    return apiErrorResponse(error, '전사 일정을 저장하지 못했습니다.');
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await authenticateRequest(request);
    requireMaster(user.email!);
    const id = new URL(request.url).searchParams.get('id');
    if (!id) throw new ApiError('지울 일정을 확인해 주세요.', 400);
    await deleteCompanyEvent(id);
    return Response.json({ events: await listCompanyEvents() }, { headers });
  } catch (error) {
    return apiErrorResponse(error, '전사 일정을 지우지 못했습니다.');
  }
}
