'use client';

import { useEffect, useEffectEvent } from 'react';

/** 휴대폰 크롬은 화면을 한 번도 누르기 전에 넣은 방문 기록을 뒤로 가기 때 건너뛰어 앱 밖으로 나가 버립니다.
 * 그래서 "앱 안에 머물기"용 기록은 사용자가 처음 화면을 누른 뒤에 넣습니다. 취소 함수를 돌려줍니다. */
export function afterUserActivation(action: () => void) {
  const activation = (
    navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }
  ).userActivation;
  if (!activation || activation.hasBeenActive) {
    action();
    return () => {};
  }
  const events = ['pointerup', 'touchend', 'keydown'] as const;
  const cancel = () =>
    events.forEach((name) => window.removeEventListener(name, run, true));
  function run() {
    cancel();
    action();
  }
  events.forEach((name) => window.addEventListener(name, run, true));
  return cancel;
}

const key = '__snoopyStayInApp';

/** 휴대폰 뒤로 가기를 눌러도 앱 밖으로 나가지 않게 합니다. onBack에서 열린 창 닫기·첫 화면으로 돌아가기를 처리합니다. */
export function useStayInApp(onBack: () => void) {
  const handleBack = useEffectEvent(onBack);
  useEffect(() => {
    const push = () =>
      window.history.pushState(
        { ...window.history.state, [key]: 'screen' },
        '',
        window.location.href,
      );
    let cancel = () => {};
    if (window.history.state?.[key] !== 'screen') {
      window.history.replaceState(
        { ...window.history.state, [key]: 'guard' },
        '',
        window.location.href,
      );
      cancel = afterUserActivation(() => {
        if (window.history.state?.[key] === 'guard') push();
      });
    }
    const onPop = (event: PopStateEvent) => {
      if (event.state?.[key] === 'screen') return;
      handleBack();
      push();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      cancel();
      window.removeEventListener('popstate', onPop);
    };
  }, []);
}
