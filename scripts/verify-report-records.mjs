// Runs against a local/preview server with an isolated, disposable team and account.
// Never changes existing users or business records. Secrets stay in process memory.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import pg from '../.reports-tools/node_modules/pg/lib/index.js';

const base = process.env.RECORDS_TEST_URL ?? 'http://localhost:3100';
const suffix=randomUUID(); const teamId='records-qa-'+suffix;const owner='team:'+teamId;
const email=`records-qa-${suffix}@example.com`;const password=randomUUID()+'Aa!7';
const actor={id:'qa-'+suffix,name:'보고 검증 담당',email,role:'admin',team:'보고 검증 전용',active:true};
const day=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});
const supa=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY??process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const url=new URL(process.env.POSTGRES_URL_NON_POOLING??process.env.POSTGRES_URL);
for(const key of ['sslmode','sslrootcert','sslcert','sslkey'])url.searchParams.delete(key);
const dbConfig={connectionString:url.toString(),ssl:{ca:await fs.readFile(new URL('../.reports-tools/prod-ca-2021.crt',import.meta.url),'utf8'),rejectUnauthorized:true},connectionTimeoutMillis:15000};
let db=new pg.Client(dbConfig);
db.on('error',()=>{});
let userId;let browser;let page;let token;let report;let fixtureCreated=false;
const results={ok:false,checkedAt:new Date().toISOString(),target:base,checks:[],errors:[],cleaned:false};
async function api(path,method='GET',body,expected=200){console.log(`Verify API: ${method} ${path.split('?')[0]} expected ${expected}`);const response=await fetch(base+path,{method,signal:AbortSignal.timeout(30000),headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();assert.equal(response.status,expected,`${method} ${path.split('?')[0]}: ${JSON.stringify(data.error??'unexpected status')}`);return data;}
async function clickSave(name,method='POST',endpoint='/api/reports'){
  console.log('Verify UI: '+name);
  const pending=page.waitForResponse(response=>new URL(response.url()).pathname===endpoint&&response.request().method()===method);
  await page.getByRole('button',{name,exact:true}).click();
  const response=await pending;const body=await response.json();assert.equal(response.status(),200,JSON.stringify(body.error??'save failed'));return body;
}
try{
  await fs.mkdir(new URL('../outputs/',import.meta.url),{recursive:true});await db.connect();
  const created=await supa.auth.admin.createUser({email,password,email_confirm:true});if(created.error)throw created.error;userId=created.data.user.id;
  const loginClient=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY??process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const login=await loginClient.auth.signInWithPassword({email,password});if(login.error)throw login.error;token=login.data.session.access_token;
  const task={id:'project-'+suffix,title:'기록 검증 메인 일정',description:'Isolated automated verification',date:day,categoryId:'qa',assigneeId:actor.id,collaborators:[],priority:'normal',status:'in_progress',type:'task',checklist:[],comments:[],createdBy:actor.id,createdAt:new Date().toISOString()};
  const child={...task,id:'child-'+suffix,title:'기록 검증 하위 일정',parentId:task.id,status:'scheduled'};
  const workspace={members:[actor],categories:[{id:'qa',name:'검증',color:'#2f6b4f',active:true}],tasks:[task,child],notes:[],routines:[],deletedIds:[]};
  await db.query('BEGIN');
  await db.query('insert into teams(id,name) values($1,$2)',[teamId,actor.team]);
  await db.query('insert into workspace_state(team_id,payload) values($1,$2)',[teamId,JSON.stringify(workspace)]);
  await db.query('insert into team_memberships(team_id,email,member_id,role,active) values($1,$2,$3,$4,true)',[teamId,email,actor.id,'admin']);
  await db.query('COMMIT');fixtureCreated=true;await db.end();
  assert.equal((await fetch(base+'/api/records')).status,401);
  await api('/api/records?team=park','GET',undefined,403);results.checks.push('anonymous and cross-team access denied');
  browser=await chromium.launch({headless:true,channel:'chrome'});page=await browser.newPage({viewport:{width:1440,height:1080}});page.setDefaultTimeout(30000);page.on('pageerror',error=>results.errors.push(error.message));
  await page.goto(base);await page.getByPlaceholder('name@example.com').fill(email);await page.getByPlaceholder('8자 이상').fill(password);await page.getByRole('button',{name:'로그인',exact:true}).click();
  await page.getByRole('button',{name:'보고서',exact:true}).waitFor({timeout:30000});await page.getByRole('button',{name:'보고서',exact:true}).click();
  await page.getByRole('button',{name:'초안 저장',exact:true}).waitFor({timeout:30000});
  let saved=await clickSave('초안 저장','PUT');report=saved.store.reports[0];assert.ok(report);
  await page.getByLabel('보고 처리 사유',{exact:true}).fill('검증 팀의 본인 확정 예외');saved=await clickSave('보고 제출');report=saved.store.reports.find(r=>r.id===report.id);assert.equal(report.workflow.status,'submitted');
  await expect(page.getByLabel('보고서 제목',{exact:true})).toBeDisabled();
  await clickSave('검토 시작');await page.getByLabel('보고 처리 사유',{exact:true}).fill('근거 보완 검증');await clickSave('보완 요청');await expect(page.getByLabel('보고서 제목',{exact:true})).toBeEnabled();
  await clickSave('초안 저장','PUT');await page.getByLabel('보고 처리 사유',{exact:true}).fill('보완 완료 및 본인 확정 예외');await clickSave('보고 제출');await clickSave('검토 완료');saved=await clickSave('최종 확정');report=saved.store.reports.find(r=>r.id===report.id);assert.equal(report.status,'final');assert.equal(report.workflow.submission,2);assert.equal(report.workflow.events.length,6);assert.ok(report.projects?.length);results.checks.push('browser draft-submit-review-return-resubmit-approve-finalize with immutable project snapshot');
  await page.screenshot({path:fileURLToPath(new URL('../outputs/report-workflow-desktop.png',import.meta.url)),fullPage:true});
  const tampered=structuredClone(saved.store);tampered.reports[0].config.title='Unauthorized edit';await api('/api/reports?team='+teamId,'PUT',{store:tampered,version:saved.version,bases:{reports:{[report.id]:report}}},409);results.checks.push('final report overwrite denied');
  await page.getByRole('button',{name:'결정 등록',exact:true}).click();await page.getByLabel('결정 제목',{exact:true}).fill('검증 후속 조치');await page.getByLabel('결정 내용',{exact:true}).fill('실제 기록과 후속 업무 연결을 확인합니다.');await page.getByLabel('결정 사유',{exact:true}).fill('검증 완료 기록 필요');await page.getByLabel('이 결정으로 새 후속 업무도 만들기').check();const decision=await clickSave('결정·조치 저장','POST','/api/records');assert.ok(decision.task?.id);
  const after=await api('/api/state?team='+teamId);assert.ok(after.state.tasks.some(t=>t.id===decision.task.id));results.checks.push('decision and follow-up task committed together');
  const decisionRequest={id:decision.decision.id,version:decision.decision.version,requestId:randomUUID(),payload:{...decision.decision.payload,result:'Verified follow-up',reason:'QA outcome',status:'done'}};
  await api('/api/records?team='+teamId,'POST',{...decisionRequest,payload:{...decisionRequest.payload,dueDate:'2026-02-30'}},400);
  const completedDecision=await api('/api/records?team='+teamId,'POST',decisionRequest);
  const replay=await api('/api/records?team='+teamId,'POST',decisionRequest);assert.equal(replay.decision.version,completedDecision.decision.version);
  await api('/api/records?team='+teamId,'POST',{...decisionRequest,requestId:randomUUID()},409);results.checks.push('decision completion, strict dates, safe retries and stale update rejection');
  const changed={...child,title:'기록 검증 변경된 일정',changeNote:'검증 사유'};await api('/api/state?team='+teamId,'PUT',{state:{...workspace,tasks:[changed],members:[],categories:[],notes:[],routines:[]},deletedIds:[]});
  const records=await api('/api/records?team='+teamId+'&taskId='+child.id);const event=records.items.find(item=>item.entity_type==='task'&&item.action==='변경');assert.ok(event);const detail=await api('/api/records?team='+teamId+'&id='+event.id);assert.equal(detail.items[0].before_data.title,child.title);assert.equal(detail.items[0].data.title,changed.title);
  const archive=await api('/api/records?kind=archive&team='+teamId+'&reportId='+report.id);assert.deepEqual(archive.items[0].payload,report);results.checks.push('before-after audit and frozen archive survive source changes');
  const filteredArchive=await supa.from('report_archive').select('owner_id,payload').in('owner_id',[owner]).gte('payload->config->>meetingDate',report.config.planStart).lte('payload->config->>meetingDate',report.config.planEnd).order('owner_id').order('report_id').range(0,199);assert.ifError(filteredArchive.error);assert.equal(filteredArchive.data.length,1);results.checks.push('archived report lookup for combined meeting week');
  await page.getByRole('tab',{name:'보고·업무 기록',exact:true}).click();await page.getByRole('button',{name:'보관본 열기',exact:true}).waitFor();await page.getByLabel('기록 검색어').fill('검증');await expect(page.getByText('장기 보관함',{exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:fileURLToPath(new URL('../outputs/report-workflow-mobile.png',import.meta.url)),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));results.checks.push('desktop and mobile archive and record search render');
  assert.deepEqual(results.errors,[]);results.ok=true;
}catch(error){results.error=error.message;process.exitCode=1;if(page)await page.screenshot({path:fileURLToPath(new URL('../outputs/report-workflow-error.png',import.meta.url)),fullPage:true}).catch(()=>{});}
finally{
  if(browser)await browser.close().catch(()=>{});
  await db.query('ROLLBACK').catch(()=>{});
  await db.end().catch(()=>{});db=new pg.Client(dbConfig);db.on('error',()=>{});await db.connect();
  if(fixtureCreated&&/^records-qa-[a-f0-9-]{36}$/.test(teamId)){
    await db.query('BEGIN');
    for(const table of ['work_records','work_decisions'])await db.query(`delete from ${table} where team_id=$1`,[teamId]);
    for(const table of ['report_archive','weekly_report_state'])await db.query(`delete from ${table} where owner_id=$1`,[owner]);
    await db.query('delete from teams where id=$1',[teamId]);await db.query('COMMIT');
  }
  if(userId){const removed=await supa.auth.admin.deleteUser(userId);if(removed.error){results.cleanupError=removed.error.message;process.exitCode=1;}}
  await db.end().catch(()=>{});results.cleaned=!results.cleanupError;
  await fs.writeFile(new URL('../outputs/report-workflow-verification.json',import.meta.url),JSON.stringify(results,null,2));
  console.log(JSON.stringify(results));
}
