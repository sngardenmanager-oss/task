'use client';

import { useMemo, useState } from 'react';
import { Newspaper } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { NewsItem } from '@/lib/types';
import type { NewsTone, ReportNewsItem } from '@/lib/report-types';

const toneLabel: Record<NewsTone, string> = {
  positive: '긍정',
  negative: '부정',
};
const toneStyle: Record<NewsTone, string> = {
  positive: 'border-[#1b5e9e] bg-[#e4f1fb] text-[#1b5e9e]',
  negative: 'border-[#a83f36] bg-[#fbe7e5] text-[#a83f36]',
};
const ALL = '__all__';

function ToneButtons({
  tone,
  disabled,
  onChange,
}: {
  tone?: NewsTone;
  disabled?: boolean;
  onChange: (tone?: NewsTone) => void;
}) {
  return (
    <fieldset
      className="m-0 flex min-w-0 shrink-0 gap-1 border-0 p-0"
      aria-label="보고서 표시 성향"
    >
      {(['positive', 'negative'] as const).map((value) => (
        <button
          key={value}
          type="button"
          disabled={disabled}
          aria-pressed={tone === value}
          onClick={() => onChange(tone === value ? undefined : value)}
          className={
            'min-h-8 rounded-md border px-3 text-xs font-bold ' +
            (tone === value
              ? toneStyle[value]
              : 'border-[#d8ded4] bg-white text-[#64776a]')
          }
        >
          {toneLabel[value]}
        </button>
      ))}
    </fieldset>
  );
}

// 보고서에 넣을 관광 뉴스를 모든 키워드(카테고리)에서 골라 담는 팝업과 선택 목록.
export default function ReportNewsPicker({
  news,
  selected,
  disabled,
  onOpen,
  onChange,
}: {
  news: NewsItem[];
  selected: ReportNewsItem[];
  disabled?: boolean;
  onOpen: () => void;
  onChange: (next: ReportNewsItem[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState(ALL);
  const [query, setQuery] = useState('');
  const chosen = useMemo(
    () => new Map(selected.map((n) => [n.id, n])),
    [selected],
  );
  const keywords = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of news)
      counts.set(n.category, (counts.get(n.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [news]);
  const visible = useMemo(() => {
    const text = query.trim().toLowerCase();
    return news
      .filter(
        (n) =>
          (keyword === ALL || n.category === keyword) &&
          (!text ||
            n.title.toLowerCase().includes(text) ||
            n.source.toLowerCase().includes(text)),
      )
      .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
  }, [news, keyword, query]);
  function toggle(item: NewsItem, on: boolean) {
    onChange(
      on
        ? [...selected, { ...item }]
        : selected.filter((n) => n.id !== item.id),
    );
  }
  function setTone(id: string, tone?: NewsTone) {
    onChange(selected.map((n) => (n.id === id ? { ...n, tone } : n)));
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => {
            onOpen();
            setOpen(true);
          }}
        >
          <Newspaper />
          관광 뉴스 선택
        </Button>
        <span className="text-sm text-[#64776a]">
          선택 {selected.length}건 · 긍정{' '}
          {selected.filter((n) => n.tone === 'positive').length} · 부정{' '}
          {selected.filter((n) => n.tone === 'negative').length}
        </span>
      </div>
      {selected.length ? (
        <ul className="space-y-1">
          {selected.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#d8ded4] px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1">
                <span className="text-xs text-[#64776a]">
                  [{item.category}] {item.source} · {item.collectedAt}
                </span>
                <span className="block">{item.title}</span>
              </span>
              <ToneButtons
                tone={item.tone}
                disabled={disabled}
                onChange={(tone) => setTone(item.id, tone)}
              />
              <button
                type="button"
                disabled={disabled}
                className="text-xs text-[#a83f36]"
                onClick={() => toggle(item, false)}
              >
                제외
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[#64776a]">
          선택한 관광 뉴스가 없습니다. 보고서에는 선택한 뉴스만 들어갑니다.
        </p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[88vh] w-[96vw] max-w-[96vw] flex-col gap-3 sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>관광 뉴스 선택</DialogTitle>
            <DialogDescription>
              모든 키워드에서 자유롭게 고를 수 있고, 키워드를 바꿔도 선택은
              유지됩니다. 각 뉴스의 [긍정]·[부정] 버튼을 누르면 그 표시로 바로
              담깁니다.
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[220px_1fr]">
            <nav
              aria-label="키워드"
              className="max-h-40 space-y-1 overflow-y-auto md:max-h-none"
            >
              {[[ALL, news.length] as const, ...keywords].map(
                ([name, count]) => {
                  const picked =
                    name === ALL
                      ? selected.length
                      : selected.filter((n) => n.category === name).length;
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={keyword === name}
                      onClick={() => setKeyword(name)}
                      className={
                        'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ' +
                        (keyword === name
                          ? 'bg-[#2f6b4f] font-bold text-white'
                          : 'bg-[#f3f5f1] text-[#183b2b]')
                      }
                    >
                      <span className="truncate">
                        {name === ALL ? '전체 키워드' : name}
                      </span>
                      <span className="shrink-0 text-xs">
                        {picked ? picked + ' / ' : ''}
                        {count}
                      </span>
                    </button>
                  );
                },
              )}
            </nav>
            <div className="flex min-h-0 flex-col gap-2">
              <input
                className="min-h-10 w-full rounded-lg border border-[#d8ded4] px-3 text-sm"
                placeholder="제목·출처 검색"
                aria-label="뉴스 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                {visible.map((item) => {
                  const picked = chosen.get(item.id);
                  return (
                    <li
                      key={item.id}
                      className={
                        'flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm ' +
                        (picked
                          ? 'border-[#2f6b4f] bg-[#f1f8f3]'
                          : 'border-[#d8ded4] bg-white')
                      }
                    >
                      <label className="flex min-w-0 flex-1 items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-1"
                          aria-label={item.title + ' 선택'}
                          checked={!!picked}
                          onChange={(e) => toggle(item, e.target.checked)}
                        />
                        <span className="min-w-0">
                          <span className="block">{item.title}</span>
                          <span className="block text-xs text-[#64776a]">
                            [{item.category}] {item.source} · {item.collectedAt}
                          </span>
                        </span>
                      </label>
                      <ToneButtons
                        tone={picked?.tone}
                        onChange={(tone) =>
                          picked
                            ? setTone(item.id, tone)
                            : onChange([...selected, { ...item, tone }])
                        }
                      />
                    </li>
                  );
                })}
                {!visible.length && (
                  <li className="py-8 text-center text-sm text-[#64776a]">
                    조건에 맞는 뉴스가 없습니다.
                  </li>
                )}
              </ul>
            </div>
          </div>
          <DialogFooter>
            <span className="mr-auto self-center text-sm text-[#64776a]">
              선택 {selected.length}건
            </span>
            <Button type="button" onClick={() => setOpen(false)}>
              완료
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
