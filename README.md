# NutriPanda storefront and API

Next.js storefront and server API for NutriPanda. Checkout is guest-only;
Supabase stores catalog and commerce data, Razorpay handles prepaid payments,
and Proship handles fulfilment. The separate dashboard calls the protected API
in this project.

## Local development

Copy `.env.example` to `.env.local`, configure the required services, then run:

```bash
npm install
npm run dev
```

The storefront/API runs at `http://localhost:3002`. The dashboard runs at
`http://localhost:3000` with `NEXT_PUBLIC_API_URL=http://localhost:3002`.

## Database setup

Apply every file in `supabase/migrations/` in filename order. Do this before
deploying the application code: checkout, shipping, notification, dashboard
rate-limit, blog-editor access, customer-login, and refund RPCs depend on those
migrations.

Do not enable `PROSHIP_LIVE_SHIPMENTS` until Proship credentials, pickup data,
package dimensions, sandbox serviceability, booking, reconciliation, and
cancellation have all been verified.

## Dashboard roles

The existing dashboard deployment supports full `admin` and blog-only
`blog_editor` sessions. The admin manages editor emails and passwords from the
Blog Access page; editor password hashes and revocation state live in Supabase.
See `DASHBOARD_ACCESS.md` for the exact flow. API authorization in this project
is authoritative; sidebar hiding alone is never relied on.

## Release checks

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
npm audit
```

The rollback-only SQL integration checks in `tests/commerce-hardening.sql`,
`tests/shipping-hardening.sql`, `tests/checkout-abuse.sql`, and
`tests/legacy-inventory-migration.sql` should also be run against an isolated
database after the migrations are applied. They must never be pointed at
production.

## Production essentials

- Use independent random secrets of at least 32 characters for dashboard,
  customer, order-access, rate-limit, and notification-worker signing.
- Keep `RAZORPAY_WEBHOOK_SECRET` distinct from `RAZORPAY_KEY_SECRET`.
- Configure Razorpay to deliver its signed webhook to
  `/api/razorpay/webhook`.
- Configure the Netlify scheduled notification worker and provider templates.
- Set the canonical HTTPS `NEXT_PUBLIC_SITE_URL` and exact
  `ADMIN_DASHBOARD_URL`.
- For paid prepaid orders, use the dashboard to stop/reconcile the carrier
  first. Only after that succeeds should the exact full Razorpay refund be
  issued and verified; local cancellation then restores inventory once.
- Captures after cancellation/expiry and deliveries after cancellation are
  retained as explicit review states instead of being silently fulfilled or
  hidden from inventory/payment reconciliation.
