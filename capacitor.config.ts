import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'kr.co.snoopygarden.workcalendar',
  appName: '스누피가든 업무캘린더',
  webDir: 'public',
  server: {
    url: 'https://snoopy-work-calendar-pig15.vercel.app',
    androidScheme: 'https',
  },
};

export default config;
