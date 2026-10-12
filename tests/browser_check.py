"""Browser QA against the isolated real Docker/PostgreSQL fixture, never a mock inbox."""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright, expect

root=Path(__file__).resolve().parents[1]
target=os.environ.get('FJORDMAIL_TEST_URL','http://192.168.1.110:18101')
output=root/'test-results';output.mkdir(exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch()
    page=browser.new_page(viewport={'width':1440,'height':1000})
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(target)
    expect(page.get_by_role('heading',name='Velkommen til FjordMail')).to_be_visible()
    page.screenshot(path=str(output/'login-desktop.png'))
    page.get_by_label('Brugernavn',exact=True).fill('admin')
    page.get_by_label('Adgangskode',exact=True).fill('Foundation-test-admin-20261013!')
    page.locator('form button.primary').click()
    expect(page.locator('.mail-list h1')).to_be_visible()
    page.get_by_role('button',name='Administration',exact=True).click()
    expect(page.get_by_role('heading',name='Administration',exact=True)).to_be_visible()
    page.screenshot(path=str(output/'admin-desktop.png'))
    page.get_by_role('tab',name='Domæner',exact=True).click()
    domains=page.request.get(target+'/api/admin/domains').json()['items']
    if not any(d['name']=='gleruphub.dk' for d in domains):
        page.get_by_role('button',name='Tilføj domæne',exact=True).click()
        expect(page.get_by_role('status')).to_contain_text('Domænet er tilføjet')
    page.get_by_role('tab',name='Mailkonti',exact=True).click()
    boxes=page.request.get(target+'/api/admin/mailboxes').json()['items']
    if not any(b['local_part']=='test' and b['domain']=='gleruphub.dk' for b in boxes):
        page.locator('select[name=domainId]').select_option(label='gleruphub.dk')
        page.get_by_role('button',name='Opret mailkonto',exact=True).click()
        expect(page.get_by_role('status')).to_contain_text('Mailkontoen og adgangstildelingen er gemt')
    page.get_by_role('button',name='Indbakke',exact=True).click()
    expect(page.get_by_role('heading',name='Mailkontoen er klargjort')).to_be_visible()
    expect(page.get_by_role('combobox',name='Mailkonto',exact=True)).to_contain_text('test@gleruphub.dk')
    page.screenshot(path=str(output/'inbox-desktop.png'))
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.get_by_role('button',name='Mit udseende',exact=True).click()
    page.get_by_label('Farvetema').select_option('light')
    expect(page.locator('html')).to_have_attribute('data-theme','light')
    page.get_by_role('button',name='Indbakke',exact=True).click()
    page.screenshot(path=str(output/'inbox-light.png'))
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(output/'inbox-mobile.png'))
    page.get_by_role('button',name='Åbn navigation').click()
    page.get_by_role('button',name='Administration',exact=True).click()
    expect(page.get_by_role('heading',name='Administration',exact=True)).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.get_by_role('tab',name='Resend',exact=True).click()
    expect(page.get_by_role('heading',name='Forbind Resend')).to_be_visible()
    page.screenshot(path=str(output/'resend-mobile.png'))
    assert not errors,errors
    browser.close()
print('PASS real login, domain/account writes, desktop/mobile layout and light/dark rendering.')
