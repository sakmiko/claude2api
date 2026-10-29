"""Seed only a fresh review database with fictional, non-working credentials."""
import datetime as dt
import json
import sqlite3
import sys

conn = sqlite3.connect(sys.argv[1])
if conn.execute('select count(*) from accounts').fetchone()[0]:
    raise SystemExit('Refusing to seed a non-empty database')
now = dt.datetime.now(dt.timezone.utc)
states = ['active', 'active', 'active', 'active', 'expired', 'unknown']
for i, state in enumerate(states):
    limits = None if i == 5 else {'type': 'within_limit', 'resolved': {'status': 'allowed', 'limit': {'percent': [24, 68, 12, 91, 100][i], 'resets_at': (now+dt.timedelta(hours=3, minutes=18+i)).isoformat(), 'kind': 'session', 'is_active': True}}, 'windows': {'5h': {'status': 'allowed', 'utilization': .24, 'resets_at': int((now+dt.timedelta(hours=3)).timestamp())}}}
    conn.execute('insert into accounts (email,org_uuid,cookies,status,created_at,updated_at,session_limits,last_limit_update) values(?,?,?,?,?,?,?,?)', (['studio','research','writing','creative','archive','personal'][i]+'@example.com',f'review-org-{i+1}', json.dumps({'sessionKey': 'review-only-invalid-session'}),state,(now-dt.timedelta(days=14+i)).isoformat(),(now-dt.timedelta(minutes=5+i)).isoformat(),json.dumps(limits) if limits else None,now.isoformat()))
for i, endpoint in enumerate(['messages','responses','chat/completions','chat/completions','responses']):
    success = i != 1
    request = {'model':'claude-sonnet-4-6','messages':[{'role':'user','content':'这是本地界面审阅的示例消息。'}]}
    conn.execute('insert into api_logs (created_at,endpoint,model,account,stream,success,status_code,input_tokens,output_tokens,duration_ms,first_token_ms,tps,error,request,response) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',((now-dt.timedelta(minutes=i*3+1)).strftime('%Y-%m-%dT%H:%M:%SZ'),endpoint,'claude-sonnet-4-6','studio@example.com',1,int(success),200 if success else 429,126+i*12,280+i*9,2460+i*340,430+i*22,47.8,'上游额度已用尽（示例）' if not success else '',json.dumps(request,ensure_ascii=False),'这是本地审阅示例，并非真实上游调用。'))
conn.execute('update accounts set paused = 1 where email = ?',('writing@example.com',))
conn.execute('update accounts set cooldown_until = ?, cooldown_reason = ? where email = ?',((now+dt.timedelta(minutes=5)).isoformat(),'额度受限','creative@example.com'))
conn.commit()
