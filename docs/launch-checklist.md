# TrackJot — launch checklist

One-time setup that needs a human in a browser. Everything here is blocked on
dashboard access, not on code.

**Do these in order.** Step 2 depends on values that only exist after step 1,
and doing Apple first means doing it twice.

---

## 0. Where things stand

| | |
| --- | --- |
| Live at | `https://trackjot.com` (TLS, HSTS, `noindex`) |
| Invite code | `jot-2026-preview` |
| Clerk | **development** instance, allowed origin still the old host |
| Google sign-in | Clerk's **shared** dev credentials — not valid in production |
| Apple sign-in | not configured |
| Database | droplet-local `trackjot`, 0 users, 0 notes |
| Backups | hourly, encrypted, mirrored to Drive, restore rehearsed |

---

## 1. Clerk production instance (~1 hour, plus DNS propagation)

Why this is first: everything else — Apple, passkeys, the production Google
credentials — binds to the Clerk **Frontend API URL**, which does not exist
until the production instance does.

### 1a. Create the instance

1. Clerk Dashboard → the **Development** pill at the top → **Create production
   instance**.
2. Choose **clone development settings**, so email OTP and Google carry over.
3. Set the application name to **TrackJot** and the home URL to
   `https://trackjot.com`.

### 1b. Add Clerk's DNS records at GoDaddy

Clerk shows the exact records under **Domains**. They are `CNAME`s, typically at
`clerk`, `accounts`, `clkmail`, `clk._domainkey`, and `clk2._domainkey`.

> **Do not touch the Microsoft 365 records.** Clerk's mail records use different
> names (`clk._domainkey`, `clk2._domainkey`) from Microsoft's
> (`selector1._domainkey`, `selector2._domainkey`), so they coexist. Add only
> what Clerk lists; change nothing that exists.
>
> One thing to watch: the apex SPF record is `v=spf1 include:secureserver.net -all`
> — a hard fail. Clerk sends from its own subdomain, so this should not matter,
> but **send yourself a test sign-in email afterwards** and confirm it arrives
> rather than assuming.


**TTL: 600 seconds** (Custom), matching the apex A record. TTL is how long a
*wrong* value stays cached — at 600s a typo costs ten minutes to correct, at the
30-minute default it costs thirty. No reason to raise it afterwards at this
scale.

**The Name field takes the prefix only** — `clerk`, not `clerk.trackjot.com`.
GoDaddy appends the domain itself.

**Use "Add More Records" and enter all five before saving — but if any row shows
a validation error, fix or delete it first.** GoDaddy holds the entire batch
until every pending row is valid, and the table below optimistically renders
changes that have not actually committed. That is precisely what silently
blocked the apex A record the first time.

| Name | Value |
| --- | --- |
| `clerk` | `frontend-api.clerk.services` |
| `accounts` | `accounts.clerk.services` |
| `clkmail` | `mail.gqrzko06589u.clerk.services` |
| `clk._domainkey` | `dkim1.gqrzko06589u.clerk.services` |
| `clk2._domainkey` | `dkim2.gqrzko06589u.clerk.services` |

Propagation can take up to 48 hours. Clerk shows a **Deploy certificates**
button once the records verify — press it.

### 1c. Your own Google OAuth credentials

Development uses Clerk's shared Google app. Production requires your own.

1. [Google Cloud Console](https://console.cloud.google.com/) → create a project
   named **TrackJot**.
2. **APIs & Services → OAuth consent screen** → External → app name *TrackJot*,
   support email, developer email. Add `trackjot.com` under authorised domains.
3. **Credentials → Create credentials → OAuth client ID → Web application.**
4. **Authorised redirect URI:** copy it from Clerk's Google connection settings.
   It will look like `https://clerk.trackjot.com/v1/oauth_callback`. Take it from
   Clerk rather than typing it — a mismatch fails at sign-in with an opaque error.
5. Paste the Client ID and Client Secret into Clerk → **SSO connections →
   Google → Use custom credentials.**

**User support email:** whatever the dropdown offers — it is a dropdown, not a
text field, and Google only accepts the signed-in Google account or a Google
Group you manage. A Microsoft 365 mailbox at `support@trackjot.com` will not
appear, because that address is not a Google account. Use the gmail and move on:
it is editable later from the Branding page, and the only catch is that changing
it *after* app verification can trigger re-verification — which is irrelevant
until 100+ users or sensitive scopes.

If a branded address is wanted before inviting people, the cheap path is a
**Google Group** at `support@trackjot.com`, not a mailbox. Groups are selectable
here, cost nothing, and forward anywhere.

**Developer contact information** (step 3) is a different field: free text,
internal, and where Google sends project notices. Put a real address there.


### 1d. Move the keys into the right three places

This is where a rename or a key swap usually breaks, because the publishable key
lives in three places and one of them is baked in at build time.

| Key | Goes where | Note |
| --- | --- | --- |
| `pk_live_…` | GitHub → Settings → Secrets and variables → Actions → **Variables** → `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | **Inlined into the bundle at build time.** Changing it requires a rebuild and redeploy, not just a restart. |
| `sk_live_…` | `/srv/trackjot/current/.env` on the droplet | Then `pm2 restart trackjot --update-env` |
| `sk_test_…` (development) | GitHub → **Secrets** → `CLERK_SECRET_KEY` | **Leave this as the development key.** The e2e job signs up real accounts and deliberately refuses a `sk_live_` key. |

Tell me when 1a–1c are done and I will do 1d, rebuild, redeploy, and verify.

### 1e. Verify before moving on

- Sign in with an email code on `https://trackjot.com`.
- Sign in with Google.
- Confirm the verification email arrives and is not in spam.
- Existing sessions will be signed out — that is expected. Dev and production
  are separate instances and do not share sessions.

---

## 2. Sign in with Apple (~45 minutes)

Only after step 1, because Apple needs the production Frontend API URL.

> Two things to keep straight: the **Team ID** is the same one TrackJot already
> uses for Apple Music, but the **key is a different key**. The Apple Music key
> is a MusicKit key. Sign in with Apple needs its own. Do not reuse or overwrite
> the MusicKit one — TrackJot's Apple imports depend on it.

### 2a. Start in Clerk

Clerk Dashboard → **SSO connections → Add connection → Apple.** Enable it, tick
**Use custom credentials**, and copy the two values Clerk shows:

- **Return URL**
- **Email Source for Apple Private Email Relay**

### 2b. Apple Developer portal

1. **Certificates, IDs & Profiles → Identifiers → App IDs → +**
   Register an App ID, enable **Sign In with Apple**. The App ID Prefix is your
   **Team ID**.
2. **Identifiers → Services IDs → +**
   Register one — its identifier is your **Services ID**. Configure it:
   - Select the App ID from step 1.
   - **Domains and Subdomains:** Clerk's Frontend API URL *without* the scheme,
     e.g. `clerk.trackjot.com`.
   - **Return URLs:** the Return URL Clerk gave you.
3. **Keys → +** — register a key, enable **Sign In with Apple**, configure it
   against the App ID. Save the **Key ID** and download the `.p8`.
   **It can only be downloaded once.**
4. **Services → Sign in with Apple for Email Communication** → add Clerk's
   **Email Source** value.

### 2c. Back in Clerk

Paste the Team ID, Services ID, Key ID, and the whole `.p8` contents including
the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines.

### 2d. Know this limitation before you enable it

If a user picks **Hide My Email**, Apple sends a
`…@privaterelay.appleid.com` address. That will not match their Google or
email-code identity, so **Clerk cannot automatically link them** — the same
person ends up with two TrackJot accounts and a split journal.

This is the exact failure mode that ruled out SuperTokens. It is not a reason to
skip Apple, but it is a reason to watch for it during the tester round.

---

## 3. Screen-reader pass (~1 hour, and it is yours to do)

### What it actually is

Automated tools catch roughly a third of real accessibility problems. Axe already
reports **zero** WCAG 2 A/AA violations on every page, including populated ones —
so the remaining third is, by definition, the part no tool can see: whether the
page is *comprehensible* when you cannot see it.

A machine can tell you a button has a name. Only a person can tell you that
hearing "Add a note" fifty times in a row is useless.

### Why I cannot do it

I can drive a browser and read the DOM, which is what the axe and keyboard specs
already do. I cannot hear what a screen reader says, and the whole question is
what the experience sounds like in sequence. That is a judgement call about
comprehension, not a check with a pass/fail.

### How to do it — macOS VoiceOver

Turn it on with **⌘ + F5**. It will talk immediately; **Control** silences it
mid-sentence. Turn it off the same way.

"VO" below means **Control + Option**, held together.

| Keys | Does |
| --- | --- |
| `VO + A` | Read the whole page from here |
| `VO + →` / `←` | Move forward / back one element |
| `VO + Space` | Click the focused thing |
| `VO + U` | **The rotor** — a menu of all headings, links, form controls |
| `Control` | Shut it up |
| `Tab` | Move between interactive elements only |

**The rotor is the important one.** `VO + U`, then ← → to switch between
Headings / Links / Form Controls. It is how blind users actually navigate — they
jump by landmark rather than reading top to bottom. If the heading list reads
like a table of contents, the page is well structured. If the button list is
fifty identical entries, it is not.

### The specific route to walk

Sign in at `https://trackjot.com`, put on headphones, close your eyes where you
can, and go through:

1. **Landing page** — does the heading list make sense alone? Are "Create an
   account" and "Sign in" clearly different?
2. **Sign-in** — is it obvious what to type and what happened after you submit?
3. **`/notes`, empty** — does the capture form explain itself? Is "Music link"
   announced along with the field, or does it just say "edit text"?
4. **Write a note** — open the "Title and artist" disclosure with `VO + Space`.
   Is it announced as expanded? After saving, are you *told* it saved, or does
   the page silently change beneath you?
5. **`/notes`, populated** — `VO + U` → Form Controls. Can you tell which note
   each Save button belongs to?
6. **A collection** — `VO + U` → Buttons. This is the one I already fixed: each
   should now read "Add a note about CN TOWER" rather than "Add a note". Confirm
   it, and check the tracklist reads as a list with positions.
7. **Share a note** — is the share URL readable? Does "Make private" say what it
   affects?

### What to write down

Anything where you had to look at the screen to understand what happened. That
is the finding. Send me the list and I will fix them.

Most likely candidates, based on what is there now: status messages after a
Server Action that are visually obvious but never announced, and the invite-code
error.

---

## 4. At invite time only

- **Clerk Pro**, $25/mo. Set inactivity timeout ≈ 90 days and **disable** the
  absolute maximum. On Hobby the fixed 7-day session would manufacture exactly
  the lapses `AuthLapse` exists to measure, corrupting the retention signal.
- **Passkeys**, once `trackjot.com` is settled as canonical — they bind to the
  relying-party domain.
- **Drive backup account** — move to a TrackJot-owned Google account. Walk
  through `rclone config` as before; only the account changes.
- **Flip `ALLOW_INDEXING`** — and not before. Indexing on while the invite gate
  is up would put a private preview in search results.
