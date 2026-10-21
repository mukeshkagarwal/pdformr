# Deploy PDFormr: Vercel (app) + Supabase (sign-in & users)

The app is a static site hosted on **Vercel**. **Supabase** provides Google/Facebook sign-in and the `profiles` users table. PDFs and form data are not uploaded; they stay in each user's browser, in a separate workspace per account.

> Supabase itself can't host the web app: it serves HTML from Storage and Edge Functions as plain text. That's why the site goes on Vercel.

You'll need accounts on Supabase, Vercel, Google Cloud and Meta for Developers. Each step below is something you do in their dashboards.

---

## 1. Create the Supabase project

1. <https://supabase.com/dashboard> → **New project**. Pick a region near your users.
2. **Project Settings → API**. Copy:
   - **Project URL**, e.g. `https://abcd1234.supabase.co`, which becomes `VITE_SUPABASE_URL`;
   - **publishable key (`sb_publishable_…`)**, which becomes `VITE_SUPABASE_PUBLISHABLE_KEY`. This key is meant to be public.
   - Never put the `service_role` / secret key in this app.

## 2. Create the users table

**SQL Editor → New query**. Paste and run [`supabase/migrations/20261021000000_profiles.sql`](supabase/migrations/20261021000000_profiles.sql). It creates:

- `public.profiles` with `id, email, full_name, avatar_url, provider, created_at, last_sign_in_at`;
- row-level security, so each user can read and update only their own row;
- a trigger that adds a row automatically the first time someone signs in.

With the Supabase CLI instead: `supabase link --project-ref <ref>` and then `supabase db push`.

You can see users under **Table Editor → profiles**, and their accounts under **Authentication → Users**.

## 3. Set the allowed URLs

**Authentication → URL Configuration**:

- **Site URL**: your production address, e.g. `https://pdformr.vercel.app`. You can update this after step 6.
- **Redirect URLs**: add all of these:
  - `http://localhost:5173/**` (local development)
  - `https://pdformr.vercel.app/**` (production; use your real domain)
  - `https://*-<your-vercel-team-slug>.vercel.app/**` (Vercel preview deployments)

## 4. Google sign-in

1. <https://console.cloud.google.com> → create or select a project.
2. **APIs & Services → OAuth consent screen**. Choose External, enter the app name (**PDFormr**, which users see on Google's sign-in page), support email and app domain, then publish.
3. **Credentials → Create credentials → OAuth client ID → Web application**:
   - **Authorized JavaScript origins**: `https://pdformr.vercel.app`, `http://localhost:5173`
   - **Authorized redirect URIs**: `https://<project-ref>.supabase.co/auth/v1/callback`. Copy the exact value from Supabase → Authentication → Providers → Google.
4. Supabase → **Authentication → Providers → Google**. Turn it on and paste the **Client ID** and **Client secret**.

## 5. Facebook sign-in

1. <https://developers.facebook.com/apps> → **Create app** named **PDFormr**. Choose the "Authenticate and request data from users with Facebook Login" use case.
2. **Facebook Login → Settings → Valid OAuth Redirect URIs**: `https://<project-ref>.supabase.co/auth/v1/callback`
3. **Use cases → Customize** and add the **email** permission. `public_profile` is included by default.
4. **App settings → Basic**: copy the **App ID** and **App secret**. Fill in **Privacy Policy URL**, **User data deletion** (instructions URL or callback) and the app domain. Meta requires these before the app can go **Live**.
5. Supabase → **Authentication → Providers → Facebook**. Turn it on and paste the App ID and App secret.
6. Set the Meta app to **Live**. In Development mode, only people listed as app roles (admins, developers, testers) can sign in.

## 6. Deploy to Vercel

**Option A: from Git (recommended).** Push this folder to GitHub, GitLab or Bitbucket. Then Vercel → **Add New… → Project** → import the repo. Vercel detects Vite automatically; `vercel.json` already sets the build command and output folder.

**Option B: from your terminal.**

```bash
npx vercel
```

The first run links the folder to a project and makes a preview deployment. For production:

```bash
npx vercel --prod
```

**Environment variables** (Vercel → Project → **Settings → Environment Variables**), for Production *and* Preview:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | your Project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | your publishable key (`sb_publishable_…`) |

Vite builds these into the app, so **redeploy after adding or changing them**. Then put the final domain into Supabase's Site URL and Redirect URLs (step 3), and into Google's JavaScript origins (step 4).

## 7. Local development

```bash
cp .env.example .env.local
```

Fill in the two values, then:

```bash
npm run dev
```

Without `.env.local`, the dev server skips sign-in and runs as a local user. A production build without the variables shows a "sign-in isn't configured" message instead.

---

## How sign-in behaves

- Users must sign in with Google or Facebook before using the app.
- **Offline:** after one online sign-in, the app keeps opening offline for that user, using their saved sign-in, until they sign out. The avatar shows an amber dot while offline.
- **Per-user data:** each account gets its own local workspace (IndexedDB `pdf-form-editor:<user id>`), so people sharing a browser don't see each other's forms. Forms saved before sign-in existed move into the first account that signs in on that browser.
- **Sign out** keeps the forms in the browser for next time. **Sign out & remove my forms from this device** deletes them; export anything you need first.
