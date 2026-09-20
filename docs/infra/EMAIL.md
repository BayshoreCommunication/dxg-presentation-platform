# EMAIL.md — SES setup

Status: **live in the dev/shared account** (295229565954, us-east-2) as of 2026-09-17.
Code: `deploy/aws/lib/email-stack.ts`. Application side: D-018, `packages/email`.

## What exists in AWS

| Resource | Value | Notes |
|---|---|---|
| Sending domain | `dxg-agency.com` | Already verified before this work, DKIM `SUCCESS`, signing enabled (Easy DKIM) |
| Configuration set | `pmp-email` | TLS `REQUIRE`, reputation metrics on, suppression on `BOUNCE` + `COMPLAINT` |
| Event destination | `sns-events` | SEND, DELIVERY, BOUNCE, COMPLAINT, REJECT, RENDERING_FAILURE, DELIVERY_DELAY |
| SNS topic | `arn:aws:sns:us-east-2:295229565954:pmp-email-events` | No subscription yet — see below |
| MAIL FROM domain | `mail.dxg-agency.com` | Configured, **`PENDING`** — waiting on two DNS records, see below |
| Account | Production access **enabled**, 50,000/day, 14/sec | Not in the SES sandbox |

Verified by sending a real message through the configuration set on 2026-09-17
(`MessageId 010f01a0aed9d5f1-…`), addressed to the DXG service address.

## Why the configuration set matters

**Without a configuration set, SES publishes no delivery, bounce or complaint events at all.** The
platform would record every message as `sent` and never learn that a speaker's address is dead —
so the one speaker who never got their upload link would look identical to the ones who did. The
application warns at startup when `SES_CONFIGURATION_SET` is unset for exactly this reason.

Note: RFPilot in this same account has **no** configuration set, so it currently receives no
delivery telemetry. Not our decision to change, but worth knowing.

## Application configuration

```bash
MAIL_TRANSPORT=ses
AWS_REGION=us-east-2
MAIL_FROM=presentations@dxg-agency.com      # any address at the verified domain
SES_CONFIGURATION_SET=pmp-email
SNS_TOPIC_ARNS=arn:aws:sns:us-east-2:295229565954:pmp-email-events
```

Credentials come from the standard AWS chain — an instance role in production, never the repo.
The sending principal needs `ses:SendEmail` scoped to the identity and configuration set.

## Custom MAIL FROM domain

Configured on 2026-09-17:

```bash
aws sesv2 put-email-identity-mail-from-attributes --region us-east-2 --profile rfpilot \
  --email-identity dxg-agency.com \
  --mail-from-domain mail.dxg-agency.com \
  --behavior-on-mx-failure USE_DEFAULT_VALUE
```

**Someone with access to the `dxg-agency.com` DNS zone must add these two records.** That zone is
hosted at **Namecheap** (`dns1.registrar-servers.com`), not Route 53 — there is no hosted zone for
it in this AWS account, so it cannot be done from here.

| Host | Type | Priority | Value |
|---|---|---|---|
| `mail` | MX | `10` | `feedback-smtp.us-east-2.amazonses.com` |
| `mail` | TXT | — | `v=spf1 include:amazonses.com ~all` |

Namecheap's *Host* field takes the subdomain only — `mail`, not `mail.dxg-agency.com`. Namecheap
adds the priority in its own column; do not put `10` inside the MX value. Enter the TXT value
without surrounding quotes. **Exactly one MX record** may exist on the MAIL FROM subdomain — SES
fails the setup outright if it finds more than one.

**These records can only come from the `dxg-agency.com` zone.** SES requires the MAIL FROM domain to
be a subdomain of the parent domain of the verified identity, so a domain we *do* control cannot
stand in for it — see "Why `av-rfpilot.com` cannot be used for this" below.

**Status as of 2026-09-20: still `PENDING`, records never published.** That is the 72-hour edge, so
this has almost certainly lapsed to `Failed` by the time anyone reads this. Re-run the configure
command *after* the records are live rather than before.

**The 72-hour window runs from when the MAIL FROM was configured, not from when the records
appear.** SES looks for the MX record for 72 hours; if it has not found it by then the status goes
to `Failed`, SES stops checking, and the setup has to be re-run with the same
`put-email-identity-mail-from-attributes` command. Publishing the records after that point does
nothing on its own. Check the status with:

```bash
aws sesv2 get-email-identity --email-identity dxg-agency.com --region us-east-2 --profile rfpilot \
  --query 'MailFromAttributes'
```

### Why `USE_DEFAULT_VALUE` and not `REJECT_MESSAGE`

`REJECT_MESSAGE` is the stricter setting, and it is the wrong one here. The DNS records do not
exist yet, so it would reject **every outgoing message** — upload links, reminders, password
resets — from the moment it was set until someone else did work in a system we do not control.
`USE_DEFAULT_VALUE` falls back to `amazonses.com` as the MAIL FROM, which is exactly the behaviour
in place before this change: mail keeps flowing, DKIM still signs, and the only thing missing is
the stronger SPF alignment we are trying to add.

Once the records are verified and the identity reads `SUCCESS`, switching to `REJECT_MESSAGE` is
worth doing — at that point a failed MX lookup means the DNS actually broke, which is worth failing
loudly over:

```bash
aws sesv2 put-email-identity-mail-from-attributes --region us-east-2 --profile rfpilot \
  --email-identity dxg-agency.com --mail-from-domain mail.dxg-agency.com \
  --behavior-on-mx-failure REJECT_MESSAGE
```

Verified on 2026-09-17 that sending is unaffected while `PENDING`: a message through the `pmp-email`
configuration set was accepted (`MessageId 010f01a0aee21e1f-…`).

## Why `av-rfpilot.com` cannot be used for this

We do control `av-rfpilot.com` (GoDaddy, `ns35/36.domaincontrol.com`), it is already a verified SES
identity in this same account with DKIM `SUCCESS`, and `mail.av-rfpilot.com` is unused. It still
cannot solve the `dxg-agency.com` problem, for two separate reasons.

**1. SES forbids it.** The MAIL FROM domain "has to be a subdomain of the parent domain of a
verified identity" ([AWS docs](https://docs.aws.amazon.com/ses/latest/dg/mail-from.html)). A MAIL
FROM of `mail.av-rfpilot.com` cannot serve the `dxg-agency.com` identity. The two are coupled by
design — the whole point is proving common ownership.

**2. Even if it were allowed, it would be the wrong thing.** Speakers at a DXG event receiving
"upload your presentation" from a domain that is not their event agency's is worse for trust and
for deliverability than the SPF alignment is worth. And `av-rfpilot.com` is **RFPilot production's
live sending identity** (`noreply@av-rfpilot.com`, per that repo's `deploy/aws/STATE.md`), so
changing its MAIL FROM attribute would alter a different product's production email.

If a fully self-controlled pipeline is ever needed for testing, verify a *separate* identity such as
`pmp.av-rfpilot.com` with its own DKIM and its own `mail.pmp.av-rfpilot.com`. That keeps RFPilot's
identity untouched. It is still vendor-branded, so it is a testing tool, not the production answer.

## This is an improvement, not a blocker

Worth stating plainly so nobody treats the `PENDING` status as broken:

| Check | Status for `presentations@dxg-agency.com` today |
|---|---|
| DKIM | Signs as `dxg-agency.com` → **aligned** |
| SPF | Authenticates `amazonses.com` (the fallback MAIL FROM) → not aligned |
| DMARC | **Passes**, via DKIM alignment. Policy on the domain is `p=none` |

DMARC needs SPF *or* DKIM to align, not both. DKIM already aligns, so mail authenticates correctly
right now. The custom MAIL FROM adds SPF alignment as a second independent path — genuine defence in
depth, and worth finishing, but not a reason to compromise on the sending domain.

Note `dxg-agency.com` also already publishes `v=spf1 include:amazonses.com ~all` at the apex.

## Outstanding

1. **No SNS subscription yet.** Events are published to the topic and go nowhere, because the API
   has no public URL. When it is deployed, subscribe `POST https://<api>/api/v1/webhooks/email` —
   the endpoint already verifies SNS signatures and handles the subscription confirmation.
2. **Open and click tracking are off.** SES rewrites every link through `awstrack.me` unless a
   custom tracking domain exists, and a speaker being asked to click an unfamiliar redirect is
   worse than the metric is worth. Add `TrackingOptions` once a subdomain is available.
3. **MAIL FROM domain is `PENDING`.** The SES side is done; it stays pending until the two DNS
   records below exist. Nothing is broken in the meantime — see "Custom MAIL FROM domain".
4. **The live resources were created with the CLI, not CloudFormation.** `deploy/aws/lib/email-stack.ts`
   describes them exactly, but a first `cdk deploy` would fail on the existing names. Either
   `cdk import` them into the stack, or delete and let CDK create them. Until that is done, this is
   known drift.

## Reconciling the drift

```bash
cd deploy/aws
npx cdk import Pmp-Email --profile rfpilot      # adopt the existing resources
# or, to start clean:
aws sesv2 delete-configuration-set --configuration-set-name pmp-email --region us-east-2 --profile rfpilot
aws sns delete-topic --topic-arn arn:aws:sns:us-east-2:295229565954:pmp-email-events --region us-east-2 --profile rfpilot
npx cdk deploy Pmp-Email --profile rfpilot
```
