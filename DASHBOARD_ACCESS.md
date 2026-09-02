# Dashboard access

The existing dashboard supports two roles in one deployment:

- `admin` — access to the complete dashboard, including Blog.
- `blog_editor` — access only to `/dashboard/blog` and the blog image uploader.

The full admin manages blog-editor accounts from **Dashboard → Blog Access**.
Editor credentials live in Supabase with salted scrypt password hashes; no blog
editor environment variables are required. The menu is filtered for editors,
editor navigation outside Blog is redirected, and every API route enforces the
role on the server. Hiding links is not the security boundary.

## Production configuration

Set these variables on the **NutriPanda website/API deployment**:

```env
ADMIN_PASSWORD=<existing-admin-password>
ADMIN_EMAIL=<optional-admin-email>

# Generate a random value with: openssl rand -base64 48
DASHBOARD_SESSION_SECRET=<at-least-32-random-characters>

ADMIN_DASHBOARD_URL=https://admin.nutripanda.in
```

Set this variable on the **existing dashboard deployment**:

```env
NEXT_PUBLIC_API_URL=https://nutripanda.in
```

Keep the admin password unique. The API refuses to create an editor whose email
or password matches the admin credentials.

`admin.nutripanda.in` is a recommended custom domain for the existing dashboard
deployment. Keeping the dashboard and API under the same `nutripanda.in` site
also avoids browser restrictions on third-party cookies. This is only a domain
alias; it is not another deployment.

## Login flow

1. Everyone opens the existing dashboard login page.
2. The admin can enter `ADMIN_EMAIL` and `ADMIN_PASSWORD`. For backward
   compatibility, the admin can leave Email blank and use `ADMIN_PASSWORD`.
3. The admin opens **Blog Access**, enters an editor email and a unique password,
   and shares those credentials with that editor.
4. A blog editor enters the assigned email and password.
5. The API verifies the stored scrypt hash and creates a signed, HTTP-only, 24-hour
   session cookie containing the account role.
6. The admin lands on `/dashboard`; an editor lands on `/dashboard/blog`.
7. An editor who manually opens Orders, Products, Inventory, Coupons, Blog
   Access, or the
   general product uploader is rejected by the server-side admin guard.

Deleting an editor revokes access on their next request. Resetting an editor's
password increments a database session version and immediately invalidates all
of their existing sessions. Changing `DASHBOARD_SESSION_SECRET` signs everyone
out.

## Database migration

Apply every file in `supabase/migrations/` in filename order before deploying
the matching application code. The `dashboard_blog_editors` table has RLS
enabled, grants no access to public/anon/authenticated roles, and is accessed
only through role-checked service-role API routes. Public blog access remains
read-only and limited by RLS to published posts.
