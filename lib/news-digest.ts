import type { NewsItem } from '@/lib/types';

type RawNewsFile = {
  id: string;
  name: string;
  content: string;
  modifiedAt: string;
};

// 3일 이내 크롤링 원문을 그대로 헤드라인+원문 링크로 변환한다. AI 요약이나
// 개수 제한 없이 전달받은 파일을 전부 항목으로 만든다 — 최근 것을 놓치지
// 않는 것이 요약보다 우선이라는 피드백에 따른 설계.
export function buildNewsDigest(files: RawNewsFile[]): NewsItem[] {
  return [...files]
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    .map((file) => {
      const heading = file.content.match(/^#\s+(.+)$/m)?.[1]?.trim();
      const title =
        heading || file.name.replace(/\.[^.]+$/, '').replaceAll('_', ' ');
      const url = file.content.match(/https?:\/\/[^\s)\]}>"']+/i)?.[0];
      return {
        id: `digest-${file.id}`,
        title,
        summary: '',
        source: file.name,
        collectedAt: file.modifiedAt.slice(0, 10),
        url,
      };
    });
}
