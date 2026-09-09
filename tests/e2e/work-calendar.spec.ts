import { expect, test } from '@playwright/test';
import { seedState } from '../../lib/seed';

test('요청된 업무 캘린더 핵심 흐름', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await request.put('/api/state', { data: { state: seedState } });
  await page.goto('/');
  await expect(page.getByText('업무 데이터를 불러오는 중입니다.')).toBeHidden();
  await expect(page.getByRole('heading', { name: '오늘', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'D-day · 7일 이내 마감' })).toBeVisible();
  await expect(page.getByRole('button', { name: /전일 특이사항/ })).toContainText('오후 강풍 예보');
  await expect(page.getByRole('heading', { name: '관광뉴스 요약' })).toBeVisible();

  const ddaySection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'D-day · 7일 이내 마감' }) }).last();
  const labelsBefore = await ddaySection.locator('button').allTextContents();
  expect(labelsBefore[0]).toContain('긴급');
  const completedLabel = await ddaySection.getByRole('checkbox').first().getAttribute('aria-label');
  await ddaySection.getByRole('checkbox').first().check();
  await expect(ddaySection.getByRole('checkbox', { name: completedLabel ?? '' })).toBeChecked();
  const statesAfter = await ddaySection.getByRole('checkbox').evaluateAll((items) => items.map((item) => ({ label:item.getAttribute('aria-label'), checked:(item as HTMLInputElement).checked })));
  const completedIndex = statesAfter.findIndex((item) => item.label === completedLabel);
  expect(completedIndex).toBeGreaterThanOrEqual(statesAfter.filter((item) => !item.checked).length);

  await page.getByRole('button', { name: '캘린더', exact: true }).click();
  await page.getByRole('button', { name: '9월 9일 업무 추가' }).click({ position: { x: 8, y: 110 } });
  const createDialog = page.getByRole('dialog', { name: '새 업무' });
  await expect(createDialog).toBeVisible();
  await createDialog.getByLabel('업무명').fill('기간 연속 표시 검증');
  await createDialog.getByLabel('종료일').fill('2026-09-12');
  await createDialog.getByLabel('우선순위').selectOption('urgent');
  await createDialog.getByRole('button', { name: '업무 등록' }).click();
  await expect(page.getByRole('button', { name: '기간 연속 표시 검증' })).toHaveCount(4);

  await page.getByRole('button', { name: '기간 연속 표시 검증' }).first().click();
  const detailDialog = page.getByRole('dialog', { name: '기간 연속 표시 검증' });
  await detailDialog.getByRole('button', { name: '수정' }).click();
  const editDialog = page.getByRole('dialog', { name: '업무 수정' });
  await editDialog.getByLabel('업무명').fill('기간 업무 수정 완료');
  await editDialog.getByLabel('종료일').fill('2026-09-13');
  await editDialog.getByRole('button', { name: '수정 저장' }).click();
  await expect(page.getByRole('button', { name: '기간 업무 수정 완료' })).toHaveCount(5);

  await page.getByRole('button', { name: '루틴 관리', exact: true }).click();
  const routineButton = page.getByRole('button', { name: /상세 보기/ }).first();
  const routineName = (await routineButton.getAttribute('aria-label'))?.replace(' 상세 보기', '') ?? '';
  await routineButton.click();
  const routineDialog = page.getByRole('dialog', { name: routineName });
  await expect(routineDialog.getByText('등록된 루틴 상세 내용')).toBeVisible();
  await expect(routineDialog.getByText(/반복 주기/)).toBeVisible();
  await routineDialog.getByRole('button', { name: '닫기' }).click();
  await expect(page.getByRole('button', { name: '오늘 실행' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /중단|재시작/ }).first()).toBeVisible();

  await page.getByRole('button', { name: '루틴 추가' }).click();
  const routineForm = page.getByRole('dialog', { name: '새 루틴' });
  await routineForm.getByLabel('루틴명').fill('자동 캘린더 루틴');
  await routineForm.getByLabel('반복 주기').fill('매일');
  await routineForm.getByLabel('다음 실행일').fill('2026-09-10');
  await routineForm.getByLabel('체크리스트').fill('현장 확인\n결과 공유');
  await routineForm.getByRole('button', { name: '루틴 등록' }).click();
  await page.getByRole('button', { name: '캘린더', exact: true }).click();
  await expect(page.getByRole('button', { name: /루틴 자동 캘린더 루틴/ })).toHaveCount(21);
  await page.getByRole('button', { name: /루틴 자동 캘린더 루틴/ }).first().click();
  await expect(page.getByRole('dialog', { name: '자동 캘린더 루틴' })).toContainText('현장 확인');
  await page.getByRole('dialog', { name: '자동 캘린더 루틴' }).getByRole('button', { name: '닫기' }).click();

  await page.getByRole('button', { name: '특이사항', exact: true }).click();
  const activeSection = page.locator('section').filter({ has: page.getByRole('heading', { name: /진행 중 특이사항/ }) }).last();
  const archiveSection = page.locator('section').filter({ has: page.getByRole('heading', { name: '완료 보관함' }) }).last();
  const noteLabel = await activeSection.getByRole('checkbox').first().getAttribute('aria-label');
  await activeSection.getByRole('checkbox').first().click();
  await expect(archiveSection.getByRole('checkbox', { name: noteLabel ?? '' })).toBeChecked();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation', { name: '모바일 메뉴' })).toBeVisible();
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflows).toBe(false);
  await page.screenshot({ path: 'test-results/mobile-qa.png', fullPage: true });
  expect(errors).toEqual([]);
});
