import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

const source = await fs.readFile(
  new URL('../../lib/team-access.ts', import.meta.url),
  'utf8',
);
const access = await import(
  'data:text/javascript;base64,' +
    Buffer.from(
      ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
    ).toString('base64')
);

const teams = [
  { id: 'park', name: '파크사업팀', color: '#2f6b4f', active: true, sortOrder: 0 },
  { id: 'team-a', name: '가든팀', color: '#547da8', active: true, sortOrder: 1 },
  { id: 'team-old', name: '없어진 팀', color: '#999999', active: false, sortOrder: 2 },
];
const memberships = [
  { teamId: 'park', email: 'kim@x.com', memberId: 'kim', role: 'member', active: true },
  { teamId: 'team-a', email: 'lee@x.com', memberId: 'lee', role: 'admin', active: true },
  { teamId: 'park', email: 'gone@x.com', memberId: 'gone', role: 'member', active: false },
  { teamId: 'team-old', email: 'old@x.com', memberId: 'old', role: 'member', active: true },
];
const resolve = (email, requestedTeamId, isMaster = false) =>
  access.resolveTeamAccess({
    email,
    isMaster,
    requestedTeamId,
    teams,
    memberships: memberships.filter((m) => m.email === email),
  });

await test('팀원은 자기 팀으로만 들어간다', () => {
  const result = resolve('kim@x.com', null);
  assert.equal(result.team.id, 'park');
  assert.deepEqual(result.accessibleTeams.map((t) => t.id), ['park']);
  assert.equal(resolve('KIM@x.com'.toLowerCase(), 'park').team.id, 'park');
});

await test('다른 팀을 요청하면 403 team_forbidden', () => {
  assert.throws(() => resolve('kim@x.com', 'team-a'), (error) => {
    assert.equal(error.status, 403);
    assert.equal(error.code, 'team_forbidden');
    return true;
  });
});

await test('소속이 없으면 승인 대기, 퇴사자는 비활성', () => {
  assert.throws(() => resolve('new@x.com', null), { code: 'approval_pending' });
  assert.throws(() => resolve('gone@x.com', null), { code: 'account_inactive' });
});

await test('비활성 팀 소속은 들어갈 수 없다', () => {
  assert.throws(() => resolve('old@x.com', null), { code: 'approval_pending' });
});

await test('마스터는 모든 활성 팀에 들어가고 기본은 파크사업팀', () => {
  const byDefault = resolve('boss@x.com', null, true);
  assert.equal(byDefault.team.id, 'park');
  assert.deepEqual(byDefault.accessibleTeams.map((t) => t.id), ['park', 'team-a']);
  assert.equal(resolve('boss@x.com', 'team-a', true).team.id, 'team-a');
  assert.throws(() => resolve('boss@x.com', 'team-old', true), { status: 404 });
});

await test('가입 승인: 팀 관리자는 자기 팀·팀원 역할만, 첫 관리자는 마스터만', () => {
  const base = { isMaster: false, actorRole: 'admin', actorTeamId: 'team-a' };
  assert.equal(access.approvalProblem({ ...base, targetTeamId: 'team-a', role: 'member' }), null);
  assert.equal(access.approvalProblem({ ...base, targetTeamId: 'team-a', role: 'commenter' }), null);
  assert.match(access.approvalProblem({ ...base, targetTeamId: 'park', role: 'member' }), /이 팀으로만/);
  assert.match(access.approvalProblem({ ...base, targetTeamId: 'team-a', role: 'admin' }), /권한이 없습니다/);
  // 직원 화면에 나가는 문구에는 '마스터'가 없어야 합니다.
  for (const text of [
    access.approvalProblem({ ...base, targetTeamId: 'park', role: 'member' }),
    access.approvalProblem({ ...base, targetTeamId: 'team-a', role: 'admin' }),
  ])
    assert.doesNotMatch(text, /마스터/);
  assert.match(
    access.approvalProblem({ ...base, actorRole: 'member', targetTeamId: 'team-a', role: 'member' }),
    /관리자/,
  );
  assert.equal(
    access.approvalProblem({ isMaster: true, actorRole: 'admin', actorTeamId: 'park', targetTeamId: 'team-a', role: 'admin' }),
    null,
  );
});

await test('소속 동기화: 퇴사 처리는 비활성, 역할 변경은 반영, 새 멤버는 만들지 않는다', () => {
  const members = [
    { id: 'kim', name: '김', email: 'kim@x.com', role: 'admin', team: '', active: true },
    { id: 'park2', name: '박', email: 'park2@x.com', role: 'member', team: '', active: false },
    { id: 'new', name: '신규', email: 'new@x.com', role: 'member', team: '', active: true },
  ];
  const current = [
    { teamId: 'park', email: 'kim@x.com', memberId: 'kim', role: 'member', active: true },
    { teamId: 'park', email: 'park2@x.com', memberId: 'park2', role: 'member', active: true },
  ];
  const plan = access.planMembershipSync('park', members, current);
  assert.deepEqual(plan, [
    {
      kind: 'upsert',
      membership: { teamId: 'park', email: 'kim@x.com', memberId: 'kim', role: 'admin', active: true },
    },
    { kind: 'deactivate', email: 'park2@x.com' },
  ]);
});

await test('저장 요청으로 비활성 멤버를 되살리지 못한다', () => {
  const before = [
    { id: 'a', active: false },
    { id: 'b', active: true },
  ];
  const merged = [
    { id: 'a', active: true },
    { id: 'b', active: false },
    { id: 'c', active: true },
  ];
  assert.deepEqual(
    access.keepRetiredMembers(before, merged).map((m) => [m.id, m.active]),
    [
      ['a', false],
      ['b', false],
      ['c', true],
    ],
  );
});

await test('보고서 저장소 키: 파크사업팀은 기존 행, 새 팀은 team:id', () => {
  assert.equal(access.reportOwnerFor('park'), '__team__');
  assert.equal(access.reportOwnerFor('team-a'), 'team:team-a');
});
