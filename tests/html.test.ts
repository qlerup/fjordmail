import test from 'node:test';
import assert from 'node:assert/strict';
import {safeHtml,htmlDocument} from '../server/html.js';
test('HTML mail cannot execute scripts, forms, CSS trackers or unsafe links',()=>{
 const result=safeHtml('<script>alert(1)</script><form action="https://evil.invalid"><input></form><p style="background:url(https://evil.invalid)">Text</p><a href="javascript:alert(1)" onclick="alert(2)">Link</a><svg onload="alert(3)"></svg>');
 assert(!result.includes('<script'));assert(!result.includes('<form'));assert(!result.includes('onclick'));assert(!result.includes('javascript:'));assert(!result.includes('style='));assert(!result.includes('<svg'));assert(result.includes('Text'));
});
test('Remote images are opt-in, HTTPS only, without active attributes',()=>{
 const html='<img src="https://example.org/image.png" onerror="alert(1)"><img src="http://example.org/tracker"><img src="//example.org/tracker">';
 assert(!safeHtml(html).includes('<img'));const allowed=safeHtml(html,true);assert(allowed.includes('src="https://example.org/image.png"'));assert(!allowed.includes('onerror'));assert(!allowed.includes('src="http:'));assert(!allowed.includes('src="//'));
 assert(!htmlDocument(html,false).includes('src="https:'));
});
test('Formatting and safe links survive sanitization',()=>{const value=safeHtml('<p><strong>Bold</strong> <em>Italic</em><u>Underline</u></p><ul><li>Item</li></ul><a href="https://example.org">Site</a>');assert(value.includes('<strong>Bold</strong>'));assert(value.includes('<li>Item</li>'));assert(value.includes('noopener noreferrer'));});
