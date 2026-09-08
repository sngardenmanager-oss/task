import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL('https://snoopy-garden-work-calendar.workspace-738291.chatgpt.site'),
  title: '스누피가든 워크 캘린더',
  description: '파크사업팀의 루틴, 현장 이슈, 행사 일정을 함께 관리하는 업무 캘린더',
  openGraph: {
    title: '스누피가든 워크 캘린더',
    description: '루틴·현장 이슈·행사 일정을 한곳에서 관리하세요.',
    type: 'website',
    locale: 'ko_KR',
    images: [{ url: '/og.png', width: 1536, height: 1024, alt: '스누피가든 워크 캘린더' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '스누피가든 워크 캘린더',
    description: '루틴·현장 이슈·행사 일정을 한곳에서 관리하세요.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
