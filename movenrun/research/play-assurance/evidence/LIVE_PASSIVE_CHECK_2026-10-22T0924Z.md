# Passive live check, 22 October 2026 09:24Z

Read-only requests permitted by the Track C brief (health, readiness, CORS preflight, public pages). Run once from a remote shell outside this workspace, because the workspace network blocks the hosts. No credentials, tokens or request bodies were sent. One request woke the sleeping free API.

## Commands

```
A=https://movenrun-staging-api.onrender.com
curl -s -w "%{http_code} %{time_total}s" --max-time 90 $A/health
curl -s -w "%{http_code} %{time_total}s" --max-time 90 $A/ready
for o in https://movenrun.xyz https://www.movenrun.xyz https://evil.example; do
  curl -s -o /dev/null -D - -X OPTIONS -H "Origin: $o" -H "Access-Control-Request-Method: POST" $A/identity/auth/google/complete
done
for u in https://movenrun.xyz/ https://www.movenrun.xyz/ https://movenrun.xyz/privacy/ https://movenrun.xyz/account-deletion/ https://movenrun.xyz/sign-in/; do
  curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}" $u
done
curl -sI https://movenrun.xyz/sign-in/   # security headers
curl -s -o /dev/null -w "%{http_code}" https://movenrun.xyz/scripts/ignored-build.sh
```

## Output (verbatim, CSP line truncated by the command)

```
2026-10-22T09:24:11Z
/health 200 42.424152s
{"status":"ok"}
/ready 200 0.330507s
{"status":"ready","database":"ready","signIn":"supabase"}
https://movenrun.xyz -> HTTP/2 204
https://movenrun.xyz -> access-control-allow-origin: https://movenrun.xyz
https://www.movenrun.xyz -> HTTP/2 200
https://evil.example -> HTTP/2 200
https://movenrun.xyz/ 200 ->
https://www.movenrun.xyz/ 308 -> https://movenrun.xyz/
https://movenrun.xyz/privacy/ 200 ->
https://movenrun.xyz/account-deletion/ 200 ->
https://movenrun.xyz/sign-in/ 200 ->
content-security-policy: default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self
referrer-policy: no-referrer
strict-transport-security: max-age=63072000
x-frame-options: DENY
ignored-build path 404
```

## Reading

- The `www` and `evil.example` preflights got 200 without `access-control-allow-origin`, so a browser refuses them; only the apex is allowed.
- 42.4 s is one wake from spin-down, not a distribution.
- This does not show which commit Render or Vercel serves; that remains the reviewer-reported 2192de6 / 61d30bb.
