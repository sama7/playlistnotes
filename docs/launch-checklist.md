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
| Clerk | **production** instance on `clerk.trackjot.com` |
| Google sign-in | TrackJot's own OAuth credentials |
| Apple sign-in | live and verified end to end |
| Database | droplet-local `trackjot`, 0 users, 0 notes |
| Backups | hourly, encrypted, mirrored to Drive, restore rehearsed |

---

## 1. Clerk production instance — ✅ DONE 2026-08-13

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

## 2. Sign in with Apple — ✅ DONE 2026-08-13

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
   Register an App ID with description `TrackJot` and **Bundle ID
   `com.trackjot.app`**, explicit.

   > Sign in with Apple works perfectly well for a pure web app. What Apple
   > lacks is a web-only *configuration* path: the Services ID is the real web
   > client, but it cannot stand alone and must be attached to a primary App ID.
   > The App ID is a registration artifact here, not a commitment to ship an
   > iOS app. Enable **Sign In with Apple**, and
   when prompted choose **"Enable as a primary App ID"** — on a first App ID it
   is preselected and the alternative is greyed out, so there is nothing to do
   but Save. Leave **Server-to-Server Notification Endpoint** blank; it is
   optional and Clerk does not consume it. The App ID Prefix is
   your **Team ID** — `HHDCP3JTWP`.

   > **Take the primary option even though this is web-only.** Apple issues a
   > *different user identifier per app group*. If the planned iOS share
   > extension later ships under a separate, ungrouped App ID, the same person
   > signing in on web and in the app arrives as two different Apple subjects —
   > two Clerk identities, two TrackJot accounts, a split journal. Grouping the
   > future app against this primary keeps them one person. Cheap now,
   > expensive to unpick later.
2. **Identifiers → Services IDs → +**
   Register one — its identifier is your **Services ID**. Then open it, tick
   **Sign In with Apple**, and press the **`Configure`** button beside it.

   > **That Configure button is the step everyone misses.** Ticking the checkbox
   > reveals nothing; the domain and return-URL fields only exist behind it.

   | Field | Value |
   | --- | --- |
   | Primary App ID | `com.trackjot.app` |
   | Domains and Subdomains | `clerk.trackjot.com` |
   | Return URLs | the exact value Clerk showed |

   It is `clerk.trackjot.com`, **not** `trackjot.com`. Apple needs the host that
   actually handles the OAuth callback, which belongs to Clerk rather than to the
   application.

   **The domain-association file turned out not to matter.** It was flagged here
   as a possible blocker; it still 404s on `clerk.trackjot.com` and Apple
   accepted the configuration regardless, so it is not required for the web
   OAuth flow. Do not host it.
3. **Keys → +** — register a key, enable **Sign In with Apple**, configure it
   against the App ID. Save the **Key ID** and download the `.p8`.
   **It can only be downloaded once.**
4. **Services → Sign in with Apple for Email Communication** → add Clerk's
   **Email Source** value. This is a *different screen* from step 2 and covers
   the opposite direction: mail TrackJot sends **to** relay addresses, so Apple
   accepts it.

   Clerk's value is an **address** — `bounces+<digits>@clkmail.trackjot.com` —
   so it goes in **Email Addresses**. Register the **domain**
   `clkmail.trackjot.com` as well, in the other box: Apple covers every address
   at a registered domain, so the domain survives Clerk changing that `+` tag,
   which nothing guarantees will stay put. The domain qualifies because it is
   DKIM-signed through the `clk._domainkey` CNAME.

   Both entries coexist. Adding the domain later is additive — there is no need
   to remove the address first, and doing so would only open a gap.

   Easy to end up here while hunting for step 2's fields — both screens talk
   about domains, and neither says which direction it means.

### 2c. Back in Clerk

Paste the Team ID, Services ID, Key ID, and the whole `.p8` contents including
the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines.

### 2d. Hide My Email — a support question, not a blocker

If someone picks **Hide My Email**, Apple sends a `…@privaterelay.appleid.com`
address, which cannot match their Google or email-code identity, so Clerk will
not link it. They get a second account.

**This was previously written up as "the failure mode that ruled out
SuperTokens", which overstated it.** The SuperTokens problem split *every*
multi-method user, silently, with no user action and no visible cause. This
splits only users who deliberately chose to hide their address, and the cause is
legible in the choice they just made — hiding your email from an app is a poor
basis for expecting that app to recognise you.

The residual is someone who signed up with Google, later taps Sign in with
Apple, picks Hide out of habit, and finds an empty journal. If that shows up in
the tester round, the cheap fix is a line on a brand-new account whose email ends
in `privaterelay.appleid.com`: *"New here? If you've used TrackJot before, sign
in the way you did last time."* Roughly fifteen minutes. Not worth pre-building.

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

## 4. Launch day

**One sequencing change if there is no beta phase:** Clerk Pro moves *before*
opening rather than after. On Hobby every session dies at seven days regardless
of use, which means real users get logged out for a billing reason and
`scripts/retention.mjs` records the lapse — corrupting the one number the whole
exercise exists to produce. That was tolerable when "invite day" was a discrete
event with a handful of known people. It is not tolerable as the opening state.

### Before anyone else arrives

1. **Use it yourself, properly.** Paste a track you actually care about and write
   something you would want to keep. Import a playlist. Search for it a day
   later. Share a note, then revoke it. Tests prove the parts work; this is the
   only thing that tells you whether it is pleasant.
2. **The screen-reader pass** (step 3).

### Clerk Pro — $25/mo

Dashboard → the instance → **Plan**. Then **Sessions**:

- **Inactivity timeout: 90 days.**
- **Maximum lifetime: disabled**, or a year if it insists on a value.
- Leave device/session revocation on.

Verify by checking that a session survives longer than a week — or simply watch
the forced-sign-out count in the retention report stay at zero.

### Passkeys

Clerk → **User & Authentication → Passkeys** → enable. Only now: passkeys bind to
the relying-party domain, and `trackjot.com` is finally settled. Users enroll one
after signing in by another method; Clerk allows up to ten per account.

### The Drive backup account

Currently `playlistnotesapp@gmail.com` — a name from a product that no longer
exists. Nothing is broken, and the archives are ciphertext either way, so this is
tidiness rather than security.

```bash
# On a machine with a browser, signed into the TrackJot Google account:
rclone config          # new remote "tjdrive", type drive, scope 3 (drive.file)
rclone config show tjdrive | ssh root@<droplet> 'cat >> /root/.config/rclone/rclone.conf'
```

Then on the droplet, point `PN_RCLONE_DEST` in `/etc/cron.d/trackjot-backup` at
`tjdrive:trackjot-backups`, run `/usr/local/bin/pn-backup.sh` once by hand, and
confirm the archive lands. **Leave the old remote configured until the new one
has uploaded successfully** — an untested backup destination is not a backup
destination.

### Opening it up

- **`ALLOW_INDEXING=true`** in the droplet's `.env`, then rebuild and redeploy.
  This is the switch that turns `robots.txt` from *disallow everything* into a
  real policy, and it must not be flipped while the invite gate is still up —
  a private preview in search results is the worst of both.
- **The invite gate**: set `REQUIRE_INVITE_CODE=false`. Keep the code and the
  page in place. It stops being a phase and becomes an emergency brake — one
  environment variable and a restart closes the door again if something goes
  wrong.
- Submit `https://trackjot.com/sitemap.xml` to Search Console.

### Then watch the number

```bash
ssh root@<droplet> 'cd /srv/trackjot/current && /opt/node24/bin/node scripts/retention.mjs'
```

Run it weekly. The line that matters is **came back and wrote again**. Everything
else in the report exists to explain that line when it disappoints.
