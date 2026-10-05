// Default is a rollback-only migration rehearsal. --apply commits additive schema changes.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import pg from '../.reports-tools/node_modules/pg/lib/index.js';
const connection = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
if (!connection) throw new Error('Postgres connection is not configured');
const url = new URL(connection);
for (const key of ['sslmode','sslrootcert','sslcert','sslkey']) url.searchParams.delete(key);
const client = new pg.Client({ connectionString:url.toString(),ssl:{ca:await fs.readFile(new URL('../.reports-tools/prod-ca-2021.crt',import.meta.url),'utf8'),rejectUnauthorized:true},connectionTimeoutMillis:15000 });
const fingerprint = async () => (await client.query("select 'workspace' kind, team_id id, md5(payload::text) hash from workspace_state union all select 'report', owner_id, md5(payload::text) from weekly_report_state order by kind,id")).rows;
try {
  await client.connect();
  if (process.argv.includes('--status')) {
    const result = await client.query("select to_regclass('public.work_records') is not null records, to_regclass('public.report_archive') is not null archive, to_regclass('public.work_decisions') is not null decisions, to_regclass('public.meeting_records') is not null meetings");
    console.log(JSON.stringify(result.rows[0]));
  } else {
  await client.query('BEGIN');
  await client.query("set local lock_timeout='8s'; set local statement_timeout='45s'");
  const before = await fingerprint();
  await client.query(await fs.readFile(new URL('../supabase/migrations/0007_reporting_records.sql',import.meta.url),'utf8'));
  assert.deepEqual(await fingerprint(),before,'Existing payloads must remain unchanged');
  const permissions=await client.query("select c.relname,c.relrowsecurity,has_table_privilege('authenticated',c.oid,'select') public_read,has_table_privilege('service_role',c.oid,'delete') service_delete from pg_class c where c.oid in ('work_records'::regclass,'report_archive'::regclass,'work_decisions'::regclass,'meeting_records'::regclass)");
  for(const row of permissions.rows){assert.equal(row.relrowsecurity,true);assert.equal(row.public_read,false);if(row.relname!=='work_decisions')assert.equal(row.service_delete,false);}
  await client.query('SAVEPOINT fixture');
  const team='records-verification-'+Date.now(); const owner='team:'+team;
  await client.query('insert into teams(id,name) values($1,$2)',[team,'Isolated verification']);
  const task={id:'fixture-task',title:'Before',date:'2026-10-05',status:'scheduled'};
  const actor={id:'fixture-author',name:'Verification',requestId:'fixture-request'};
  await client.query('insert into workspace_state(team_id,payload,audit_context) values($1,$2,$3)',[team,JSON.stringify({tasks:[task],notes:[],routines:[]}),JSON.stringify(actor)]);
  await client.query('update workspace_state set payload=$2,audit_context=$3 where team_id=$1',[team,JSON.stringify({tasks:[{...task,title:'After'}],notes:[],routines:[]}),JSON.stringify({...actor,requestId:'fixture-update'})]);
  const changes=(await client.query("select before_data,data,actor from work_records where team_id=$1 and action='변경'",[team])).rows;
  assert.equal(changes.length,1);assert.equal(changes[0].before_data.title,'Before');assert.equal(changes[0].data.title,'After');assert.equal(changes[0].actor.id,actor.id);
  const report={id:'fixture-report',status:'final',revision:1,config:{title:'Verification report',meetingDate:'2026-10-05'},rows:[{id:'row',taskId:task.id}],agendas:[]};
  await client.query('insert into weekly_report_state(owner_id,payload,audit_context) values($1,$2,$3)',[owner,JSON.stringify({reports:[report]}),JSON.stringify(actor)]);
  assert.equal((await client.query('select count(*) from report_archive where owner_id=$1',[owner])).rows[0].count,'1');
  await client.query('SAVEPOINT immutable');
  await assert.rejects(client.query('update weekly_report_state set payload=$2 where owner_id=$1',[owner,JSON.stringify({reports:[{...report,revision:99}]})]),/immutable/);
  await client.query('ROLLBACK TO SAVEPOINT immutable');
  await client.query('update weekly_report_state set payload=$2 where owner_id=$1',[owner,JSON.stringify({reports:[]})]);
  assert.deepEqual((await client.query('select payload from report_archive where owner_id=$1',[owner])).rows[0].payload,report);
  const decision={title:'Decision',reportId:report.id,taskIds:['new-fixture-task'],status:'open'};
  const newTask={...task,id:'new-fixture-task'};
  const rpc='select save_work_decision($1,$2,$3,$4,$5,$6) result';
  const args=[team,'fixture-decision',0,JSON.stringify(decision),JSON.stringify({...actor,requestId:'decision-request'}),JSON.stringify(newTask)];
  const saved=(await client.query(rpc,args)).rows[0].result;
  assert.equal(saved.version,1);
  const replay=(await client.query(rpc,args)).rows[0].result;assert.equal(replay.version,1);
  assert.equal((await client.query("select count(*) from work_records where team_id=$1 and entity_type='decision'",[team])).rows[0].count,'1');
  await client.query('SAVEPOINT conflict');
  await assert.rejects(client.query(rpc,[team,'fixture-decision',0,JSON.stringify(decision),JSON.stringify({...actor,requestId:'different-request'}),null]),{code:'PT409'});
  await client.query('ROLLBACK TO SAVEPOINT conflict');
  await client.query('SAVEPOINT atomic');
  await assert.rejects(client.query(rpc,[team,'bad-decision',0,JSON.stringify({...decision,taskIds:['missing']}),JSON.stringify(actor),JSON.stringify({...task,id:'must-rollback'})]),/missing/);
  await client.query('ROLLBACK TO SAVEPOINT atomic');
  assert.equal((await client.query("select exists(select 1 from workspace_state w,jsonb_array_elements(w.payload->'tasks') t where w.team_id=$1 and t->>'id'='must-rollback') present",[team])).rows[0].present,false);
  await client.query('ROLLBACK TO SAVEPOINT fixture');
  assert.deepEqual(await fingerprint(),before);
  const apply=process.argv.includes('--apply');
  await client.query(apply?'COMMIT':'ROLLBACK');
  console.log(JSON.stringify({ok:true,mode:apply?'applied':'rehearsal-rolled-back',existingRowsVerified:before.length,checks:['payload preservation','RLS','append-only permissions','task diff audit','immutable finals','archive after removal','decision and task atomicity','idempotency','conflict protection','fixtures rolled back']}));
  }
} catch(error){await client.query('ROLLBACK').catch(()=>{});console.error('Reporting migration failed:',error.code??'',error.message);process.exitCode=1;} finally{await client.end().catch(()=>{});}
