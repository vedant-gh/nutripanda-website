# Dashboard access

The existing dashboard supports two roles in one deployment:

- `admin` — access to the complete dashboard, including Blog.
- `blog_editor` — access only to `/dashboard/blog` and the blog image uploader.

The dashboard menu is filtered for editors, editor navigation outside Blog is
redirected, and every API route enforces the role on the server. Hiding links is
not the security boundary.

## Production configuration

Set these variables on the **NutriPanda website/API deployment**:

```env
ADMIN_PASSWORD=<existing-admin-password>
ADMIN_EMAIL=<optional-admin-email>

BLOG_EDITOR_1_EMAIL=<first-editor-email>
BLOG_EDITOR_1_PASSWORD=<unique-first-editor-password>
BLOG_EDITOR_2_EMAIL=<second-editor-email>
BLOG_EDITOR_2_PASSWORD=<unique-second-editor-password>

# Generate a random value with: openssl rand -base64 48
DASHBOARD_SESSION_SECRET=<at-least-32-random-characters>

ADMIN_DASHBOARD_URL=https://admin.nutripanda.in
```

Set this variable on the **existing dashboard deployment**:

```env
NEXT_PUBLIC_API_URL=https://nutripanda.in
```

Use unique passwords for all three accounts. An editor account is enabled only
when both its email and password are configured.

`admin.nutripanda.in` is a recommended custom domain for the existing dashboard
deployment. Keeping the dashboard and API under the same `nutripanda.in` site
also avoids browser restrictions on third-party cookies. This is only a domain
alias; it is not another deployment.

## Login flow

1. Everyone opens the existing dashboard login page.
2. The admin can enter `ADMIN_EMAIL` and `ADMIN_PASSWORD`. For backward
   compatibility, the admin can leave Email blank and use `ADMIN_PASSWORD`.
3. A blog editor enters their assigned email and password.
4. The API verifies the credentials and creates a signed, HTTP-only, 24-hour
   session cookie containing the account role.
5. The admin lands on `/dashboard`; an editor lands on `/dashboard/blog`.
6. An editor who manually opens Orders, Products, Inventory, Coupons, or the
   general product uploader is rejected by the server-side admin guard.

Changing `DASHBOARD_SESSION_SECRET` signs everyone out. Removing either editor
environment variable disables that editor on the next deployment.

## Database migration

Apply every file in `supabase/migrations/` in filename order before deploying
the matching application code. In particular, the blog schema, durable login
rate limits, payment/shipping state machines, and signed customer access rely
on the new RPCs. Public blog access is read-only and limited by RLS to published
posts; dashboard writes use the service-role API.
