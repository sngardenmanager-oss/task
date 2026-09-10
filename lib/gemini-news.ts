import type { NewsItem } from '@/lib/types';

type RawNewsFile = {
  id: string;
  name: string;
  content: string;
  modifiedAt: string;
};

const GEMINI_MODEL = 'gemini-flash-latest';
const MAX_SOURCE_FILES = 60;
const MAX_CONTENT_CHARS_PER_FILE = 4000;

function heuristicDigest(files: RawNewsFile[]): NewsItem[] {
  const today = new Date().toISOString().slice(0, 10);
  return [...files]
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    .slice(0, 10)
    .map((file) => {
      const normalized = file.content
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const heading = file.content.match(/^#\s+(.+)$/m)?.[1]?.trim();
      const title =
        heading || file.name.replace(/\.[^.]+$/, '').replaceAll('_', ' ');
      const url = file.content.match(/https?:\/\/[^\s)\]}>"']+/i)?.[0];
      return {
        id: `digest-${file.id}`,
        title,
        summary:
          normalized
            .replace(/^#\s+[^\n]+/, '')
            .trim()
            .slice(0, 320) || '요약할 내용이 없습니다.',
        source: file.name,
        collectedAt: today,
        url,
      };
    });
}

type GeminiDigestEntry = {
  index: number;
  title: string;
  summary: string;
  url?: string;
};

export async function summarizeNewsWithGemini(
  files: RawNewsFile[],
): Promise<NewsItem[]> {
  if (files.length === 0) return [];

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return heuristicDigest(files);

  const sourceFiles = files.slice(0, MAX_SOURCE_FILES);
  const articles = sourceFiles
    .map(
      (file, index) =>
        `[${index}] 파일명: ${file.name}\n${file.content.slice(0, MAX_CONTENT_CHARS_PER_FILE)}`,
    )
    .join('\n\n---\n\n');

  const prompt = `다음은 최근 며칠간 수집된 관광 뉴스 크롤링 원문입니다. 업무에 참고할 만한 중요도 높은 순서로 최대 10건을 선정해 한국어로 정리해 주세요.
반드시 아래 JSON 스키마의 배열로만 응답하세요 (설명, 코드블록 표시 등 다른 텍스트 없이 JSON 배열만):
[{"index": 원본 파일 번호(정수), "title": "간결한 헤드라인", "summary": "1~2문장 핵심 요약", "url": "본문에서 찾은 원문 URL, 없으면 빈 문자열"}]

원문 목록:
${articles}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Gemini request failed with status ${response.status}`);
    }
    const payload = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini returned no content');

    const parsed = JSON.parse(text) as GeminiDigestEntry[];
    const today = new Date().toISOString().slice(0, 10);
    const items = parsed
      .filter(
        (entry) =>
          typeof entry.index === 'number' &&
          sourceFiles[entry.index] &&
          entry.title,
      )
      .slice(0, 10)
      .map((entry): NewsItem => {
        const file = sourceFiles[entry.index];
        return {
          id: `digest-${file.id}`,
          title: entry.title.trim() || file.name,
          summary:
            (entry.summary ?? '').trim().slice(0, 400) ||
            '요약할 내용이 없습니다.',
          source: file.name,
          collectedAt: today,
          url: entry.url?.trim() || undefined,
        };
      });
    return items.length ? items : heuristicDigest(files);
  } catch {
    return heuristicDigest(files);
  }
}
