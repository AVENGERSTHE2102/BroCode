// Exercise the rendered Next.js server action without creating a user.
const origin = process.env.ORIGIN ?? 'http://localhost:3000';
const page = await fetch(`${origin}/login`);
const html = await page.text();
const forms = [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)];
const form = forms.find((match) => match[1].includes('Create account'));
const action = form?.[1].match(/name="(\$ACTION_ID_[^"]+)"/);
if (!action) throw new Error('Signup server-action field not found');
const body = new FormData();
body.set(action[1], '');
body.set('email', 'invalid-address');
body.set('password', 'diagnostic-invalid-address-only');
const response = await fetch(`${origin}/login`, {
  method: 'POST', body, headers: { Origin: origin }, redirect: 'manual',
});
console.log(JSON.stringify({ status: response.status, redirect: response.headers.get('location') }));
if (response.status !== 303 || response.headers.get('location') !== '/login?error=signup_validation') {
  throw new Error('The signup action did not return the expected provider validation result');
}
