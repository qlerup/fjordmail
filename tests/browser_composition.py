import http.server,threading,json,time
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
(root/'test-results').mkdir(exist_ok=True)
class Handler(http.server.SimpleHTTPRequestHandler):
 def __init__(self,*a,**k):super().__init__(*a,directory=str(root/'dist'),**k)
 def log_message(self,*a):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',18115),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
mailbox='11111111-1111-4111-8111-111111111111'
source={'id':'message-1','subject':'Fixture message','from':[{'email':'sender@example.org','name':'Sender'}],'to':[{'email':'fixture@gleruphub.dk'},{'email':'other@example.org'}],'cc':[],'replyTo':[],'receivedAt':'2026-10-13T12:00:00Z','preview':'Fixture body','text':'Fixture body','keywords':{},'attachments':[]}
with sync_playwright() as p:
 browser=p.chromium.launch()
 for width in [1440,390]:
  context=browser.new_context(viewport={'width':width,'height':900});page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));saved={};requests=[]
  def route(r):
   u=r.request.url;method=r.request.method
   if u.endswith('/bootstrap'):data={'managed':False,'ready':True}
   elif u.endswith('/me'):data={'user':{'id':'user','username':'fixture','email':'fixture@example.org','role':'admin','preferences':{}},'csrf':'test-csrf'}
   elif u.endswith('/mailboxes'):data={'items':[{'id':mailbox,'local_part':'fixture','domain':'gleruphub.dk','display_name':'Fixture','kind':'personal','provision_status':'ready'}]}
   elif '/drafts/' in u:
    id=u.split('/drafts/')[1]
    if method=='PUT':body=r.request.post_data_json;saved[id]=body;data={'id':id,'revision':body['revision']};requests.append(body)
    elif method=='DELETE':saved.pop(id,None);data={'ok':True}
    else:data={**saved[id],'id':id}
   elif '/messages?' in u:
    items=[{**source,'id':'draft-message-'+id,'subject':d['subject'],'preview':d['text'],'draftId':id} for id,d in saved.items()] if 'folder=drafts' in u else [source];data={'items':items,'total':len(items)}
   elif '/messages/' in u:data=source
   elif '/uploads?' in u:data={'id':'22222222-2222-4222-8222-222222222222','name':'fixture.txt','type':'text/plain','size':7,'token':'fixture-token'}
   elif u.endswith('/send'):data={'id':'submission','state':'queued'}
   elif '/submissions/' in u:data={'state':'accepted','sent_id':'sent-1'}
   else:data={}
   r.fulfill(status=200,content_type='application/json',body=json.dumps(data))
  page.route('**/api/**',route);page.goto('http://127.0.0.1:18115');page.get_by_role('button',name='Fixture message',exact=False).click();page.get_by_role('button',name='Svar alle',exact=True).click()
  assert page.get_by_label('Til',exact=True).input_value()=='sender@example.org, other@example.org'
  page.locator('textarea').fill('Draft retained after close')
  page.get_by_role('button',name='Tilf\u00f8j CC / BCC').click();page.get_by_label('CC',exact=True).fill('cc@example.org');page.get_by_label('BCC',exact=True).fill('bcc@example.org')
  page.locator('input[type=file]').set_input_files({'name':'fixture.txt','mimeType':'text/plain','buffer':b'fixture'})
  page.get_by_role('button',name='Gem og luk').click();page.wait_for_function("!document.querySelector('.basic-compose')")
  assert requests[-1]['text']=='Draft retained after close' and requests[-1]['bcc']==['bcc@example.org'] and len(requests[-1]['attachments'])==1
  if width<850:page.get_by_role('button',name='\u00c5bn navigation').click()
  page.get_by_role('button',name='Kladder',exact=True).click();page.get_by_role('button',name='Re: Fixture message',exact=False).click();page.locator('textarea').wait_for();assert page.locator('textarea').input_value()=='Draft retained after close'
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.screenshot(path=str(root/'test-results'/f'composer-{width}.png'),full_page=True)
  page.get_by_role('button',name='Send mail',exact=True).click();page.get_by_text('Resend har accepteret mailen. Den er gemt i Sendt.',exact=True).wait_for()
  assert page.get_by_role('button',name='Sat i k\u00f8',exact=True).is_disabled()
  assert not errors,errors
  print('PASS browser',width,'reply-all, CC/BCC, upload, save/close/reopen, queued send, no overflow/errors')
  context.close()
 browser.close()
server.shutdown()
