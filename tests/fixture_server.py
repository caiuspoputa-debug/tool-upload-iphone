"""TEST ONLY: mocked Google/Drive bound to localhost. Never deploy this fixture."""
import sys,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
sys.path.insert(0,str(Path(__file__).resolve().parent))
from flask import request,redirect,jsonify
from server.app import create_app
from server.drive import SCOPE
from test_private import FakeDriveHTTP
import time
store_dir=tempfile.TemporaryDirectory()
app=create_app({'TESTING':True,'SECRET_KEY':'local-QA-only-not-a-credential-'*3,'GOOGLE_CLIENT_ID':'qa-client','GOOGLE_CLIENT_SECRET':'qa-secret','PRIVATE_ORIGIN':'http://127.0.0.1:8792','ADMIN_EMAILS':'owner@example.test','DATA_DIRECTORY':store_dir.name,'SESSION_COOKIE_SECURE':False,'SESSION_COOKIE_NAME':'qa-session'})
store=app.extensions['agenda_store'];store.set_user('barber@example.test',True)
http=FakeDriveHTTP();app.extensions['agenda_drive'].http=http
provider=app.extensions['agenda_google']
def token():
 if request.args.get('reset')=='1':
  http.files.clear();http.calls.clear();http.fail_upload=False;http.lost_ack=False
  store.forget_grant('owner@example.test');store.forget_grant('barber@example.test')
 email=request.args.get('account','owner@example.test')
 sub='owner' if email=='owner@example.test' else 'barber'
 return {'userinfo':{'email':email,'email_verified':True,'sub':sub},'scope':'openid email '+SCOPE,'access_token':email,'refresh_token':'qa-refresh-'+email,'expires_at':time.time()+3600}
provider.authorize_access_token=token
provider.authorize_redirect=lambda *a,**k:redirect('/auth/google/drive-callback')
@app.get('/api/__qa/state')
def qa_state():return jsonify(calls=http.calls,files={k:v.decode() for k,v in http.files.items()})
@app.post('/api/__qa/fail')
def qa_fail():http.fail_upload=bool(request.json.get('fail'));return jsonify(ok=True)
app.run(host='127.0.0.1',port=8792,use_reloader=False)
