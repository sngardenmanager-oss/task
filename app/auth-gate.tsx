'use client';

import { useCallback, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { Clock3, Leaf, LoaderCircle, LockKeyhole, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import WorkCalendarApp from '@/app/work-calendar-app';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import type { Member, RegistrationRequest, WorkspaceState } from '@/lib/types';

type WorkspacePayload = {
  state: WorkspaceState;
  actor: Member;
  pendingRegistrations: RegistrationRequest[];
};
type GateState =
  | { kind: 'checking' }
  | { kind: 'signed-out' }
  | { kind: 'loading' }
  | { kind: 'ready'; workspace: WorkspacePayload }
  | { kind: 'denied'; message: string; code?: string };

export default function AuthGate() {
  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [gate, setGate] = useState<GateState>({ kind: 'checking' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setGate(data.session ? { kind: 'loading' } : { kind: 'signed-out' });
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setGate((current) => {
        if (!nextSession) return { kind: 'signed-out' };
        return current.kind === 'ready' ? current : { kind: 'loading' };
      });
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const accessToken = session?.access_token;

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/state', {
          headers: { authorization: `Bearer ${accessToken}` },
          cache: 'no-store',
          signal: controller.signal,
        });
        const result = (await response.json()) as WorkspacePayload & { error?: string; code?: string };
        if (!response.ok) {
          setGate({
            kind: 'denied',
            message: result.error ?? '업무 데이터를 불러오지 못했습니다.',
            code: result.code,
          });
          return;
        }
        setGate({ kind: 'ready', workspace: result });
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : '로그인 권한을 확인하지 못했습니다.';
        setGate({ kind: 'denied', message });
      }
    })();
    return () => controller.abort();
  }, [accessToken, reloadToken]);

  const signOut = useCallback(async () => {
    setGate({ kind: 'checking' });
    await supabase.auth.signOut({ scope: 'local' });
    setSession(null);
    setGate({ kind: 'signed-out' });
  }, [supabase]);

  if (gate.kind === 'checking' || gate.kind === 'loading') {
    return <FullScreenMessage label={gate.kind === 'checking' ? '로그인 상태를 확인하는 중입니다.' : '업무 데이터를 불러오는 중입니다.'} />;
  }
  if (gate.kind === 'signed-out' || !session) {
    return <LoginPanel supabase={supabase} />;
  }
  if (gate.kind === 'denied') {
    const isPending = gate.code === 'approval_pending';
    return (
      <main className="grid min-h-screen place-items-center bg-[#f5f3ec] p-5 text-[#26352d]">
        <section className="w-full max-w-md rounded-3xl border border-[#d8ded4] bg-[#fbfaf5] p-7 text-center shadow-[0_24px_70px_rgba(55,74,62,0.12)]">
          <div className={`mx-auto mb-4 grid size-14 place-items-center rounded-2xl ${isPending ? 'bg-[#fff1dd] text-[#806743]' : 'bg-[#f7e8e4] text-[#a83f36]'}`}>
            {isPending ? <Clock3 /> : <LockKeyhole />}
          </div>
          <h1 className="text-xl font-black">{isPending ? '관리자 승인 대기 중' : '접근 권한이 없습니다'}</h1>
          <p className="mt-2 text-sm leading-6 text-[#5f6d64]">{gate.message}</p>
          <p className="mt-3 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-[#5f6d64]">{session.user.email}</p>
          {isPending && <button onClick={() => { setGate({ kind: 'loading' }); setReloadToken((value) => value + 1); }} className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#2f6b4f] px-4 text-sm font-bold text-white">
            <RefreshCw className="size-4" /> 승인 상태 확인
          </button>}
          <button onClick={() => void signOut()} className={`${isPending ? 'mt-2 border border-[#d8ded4] bg-white text-[#26352d]' : 'mt-5 bg-[#2f6b4f] text-white'} inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold`}>
            <LogOut className="size-4" /> 다른 계정으로 로그인
          </button>
        </section>
      </main>
    );
  }

  return (
    <WorkCalendarApp
      key={session.user.id}
      initialData={gate.workspace.state}
      initialActor={gate.workspace.actor}
      initialPendingRegistrations={gate.workspace.pendingRegistrations}
      accessToken={session.access_token}
      onSignOut={signOut}
    />
  );
}

function FullScreenMessage({ label }: { label: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f5f3ec] text-[#26352d]">
      <div className="flex items-center gap-3 rounded-2xl border border-[#d8ded4] bg-[#fbfaf5] px-5 py-4 text-sm font-bold shadow-sm">
        <LoaderCircle className="size-5 animate-spin text-[#2f6b4f]" />{label}
      </div>
    </main>
  );
}

type AuthMode = 'login' | 'signup' | 'bootstrap';
type LoginSubmitEvent = Parameters<NonNullable<ComponentProps<'form'>['onSubmit']>>[0];

function formValue(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}

function LoginPanel({ supabase }: { supabase: SupabaseClient }) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [bootstrapAvailable, setBootstrapAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    void fetch('/api/auth/bootstrap', { cache: 'no-store' })
      .then(async (response) => (await response.json()) as { available?: boolean })
      .then((result) => {
        if (result.available) {
          setBootstrapAvailable(true);
          setMode('bootstrap');
        }
      })
      .catch(() => undefined);
  }, []);

  async function submit(event: LoginSubmitEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const form = new FormData(event.currentTarget);
    const email = formValue(form, 'email').trim().toLowerCase();
    const password = formValue(form, 'password');
    const name = formValue(form, 'name').trim();

    try {
      if (mode === 'bootstrap') {
        const response = await fetch('/api/auth/bootstrap', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password, name }),
        });
        const result = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(result.error ?? '관리자 계정을 만들지 못했습니다.');
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        return;
      }

      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: name ? { display_name: name } : undefined },
        });
        if (signUpError) throw signUpError;
        if (!data.user) throw new Error('가입 신청을 접수하지 못했습니다.');
        setNotice('가입 신청이 접수되었습니다. 관리자가 승인하면 로그인할 수 있습니다.');
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw new Error('이메일 또는 비밀번호를 확인해 주세요.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '로그인 처리 중 오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'bootstrap' ? '최초 관리자 설정' : mode === 'signup' ? '계정 만들기' : '로그인';
  const description = mode === 'bootstrap'
    ? '처음 사용할 관리자 계정을 만들어 주세요. 이 설정은 한 번만 가능합니다.'
    : mode === 'signup'
      ? '계정을 만들면 관리자 승인 대기 목록에 자동으로 등록됩니다.'
      : '등록된 스누피가든 업무 계정으로 로그인해 주세요.';
  const submitLabel = mode === 'bootstrap' ? '관리자 계정 만들기' : mode === 'signup' ? '계정 만들기' : '로그인';

  return (
    <main className="grid min-h-screen bg-[#f5f3ec] p-5 text-[#26352d] lg:grid-cols-[1.1fr_0.9fr]">
      <section className="hidden items-center justify-center rounded-[2rem] bg-[#2f6b4f] p-12 text-white lg:flex">
        <div className="max-w-lg">
          <div className="mb-8 grid size-16 place-items-center rounded-3xl bg-white/15"><Leaf className="size-8" /></div>
          <p className="text-sm font-bold tracking-[0.18em] text-white/70">SNOOPY GARDEN</p>
          <h1 className="mt-3 text-4xl font-black leading-tight">함께 관리하는<br />파크사업팀 워크 캘린더</h1>
          <p className="mt-5 max-w-md text-sm leading-7 text-white/75">업무, 루틴, 현장 특이사항을 안전하게 공유하고 팀의 일정을 한곳에서 확인하세요.</p>
          <div className="mt-10 flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-3 text-sm font-semibold text-white/85"><ShieldCheck className="size-5" /> Supabase Auth로 계정과 세션을 보호합니다.</div>
        </div>
      </section>

      <section className="flex items-center justify-center p-0 sm:p-8">
        <div className="w-full max-w-md rounded-[2rem] border border-[#d8ded4] bg-[#fbfaf5] p-6 shadow-[0_24px_70px_rgba(55,74,62,0.12)] sm:p-8">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <div className="grid size-11 place-items-center rounded-2xl bg-[#2f6b4f] text-white"><Leaf className="size-5" /></div>
            <div><p className="text-[11px] font-bold tracking-[0.12em] text-[#708076]">SNOOPY GARDEN</p><p className="font-black">워크 캘린더</p></div>
          </div>
          <h2 className="text-2xl font-black">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-[#5f6d64]">{description}</p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            {(mode === 'signup' || mode === 'bootstrap') && <AuthField label="이름"><input name="name" required autoComplete="name" className={authInputClass} placeholder="이름" /></AuthField>}
            <AuthField label="이메일"><input name="email" type="email" required autoComplete="email" className={authInputClass} placeholder="name@example.com" /></AuthField>
            <AuthField label="비밀번호"><input name="password" type="password" required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} className={authInputClass} placeholder="8자 이상" /></AuthField>
            {error && <p role="alert" className="rounded-xl bg-[#f7e8e4] px-3 py-2.5 text-sm font-semibold text-[#8d342e]">{error}</p>}
            {notice && <output className="block rounded-xl bg-[#e7f0eb] px-3 py-2.5 text-sm font-semibold text-[#2f6b4f]">{notice}</output>}
            <button disabled={busy} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#2f6b4f] px-4 text-sm font-black text-white transition hover:bg-[#255940] disabled:cursor-wait disabled:opacity-60">
              {busy && <LoaderCircle className="size-4 animate-spin" />}{submitLabel}
            </button>
          </form>

          <div className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs font-bold text-[#5f6d64]">
            {mode !== 'login' && <button onClick={() => { setMode('login'); setError(''); setNotice(''); }} className="hover:text-[#2f6b4f]">이미 계정이 있어요</button>}
            {!bootstrapAvailable && mode !== 'signup' && <button onClick={() => { setMode('signup'); setError(''); setNotice(''); }} className="hover:text-[#2f6b4f]">새 계정 만들기</button>}
            {bootstrapAvailable && mode !== 'bootstrap' && <button onClick={() => { setMode('bootstrap'); setError(''); setNotice(''); }} className="hover:text-[#2f6b4f]">최초 관리자 설정</button>}
          </div>
        </div>
      </section>
    </main>
  );
}

const authInputClass = 'mt-1.5 h-12 w-full rounded-xl border border-[#d8ded4] bg-white px-3 text-sm outline-none transition focus:border-[#2f6b4f] focus:ring-2 focus:ring-[#2f6b4f]/10';

function AuthField({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm font-bold text-[#3e4d44]">{label}{children}</label>;
}
