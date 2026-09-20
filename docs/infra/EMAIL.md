# EMAIL.md — SES setup

Status: **live in the dev/shared account** (295229565954, us-east-2) as of 2026-09-20.
Code: `deploy/aws/lib/email-stack.ts`. Application side: D-018, `packages/email`.

## What exists in AWS

| Resource | Value | Notes |
|---|---|---|
| Sending identity | `av-rfpilot.com` | Verified, DKIM `SUCCESS`, signing enabled. DNS at GoDaddy |
| Sending address | `noreply@av-rfpilot.com` | Shared with RFPilot — see below |
| Configuration set | `pmp-email` | TLS `REQUIRE`, reputation metrics on, suppression on `BOUNCE` + `COMPLAINT` |
| Event destination | `sns-events` | SEND, DELIVERY, BOUNCE, COMPLAINT, REJECT, RENDERING_FAILURE, DELIVERY_DELAY |
| SNS topic | `arn:aws:sns:us-east-2:295229565954:pmp-email-events` | No subscription yet — see Outstanding |
| Account | Production access **enabled**, 50,000/day, 14/sec | Not in the SES sandbox |

Verified on 2026-09-20 by sending as `noreply@av-rfpilot.com` through the `pmp-email` configuration
set (`MessageId 010f01a0bd30a596-…`).

## Sender decision

**This platform sends as `noreply@av-rfpilot.com`** — the same address RFPilot production uses.
Decided by the user on 2026-09-20, superseding the earlier `presentations@dxg-agency.com`.

Two consequences are worth having written down, because neither is visible from the code:

1. **Speakers receive event mail from a vendor domain, not their event agency's.** A DXG speaker
   getting "upload your presentation" from `av-rfpilot.com` has no prior relationship with that
   name. Setting `MAIL_REPLY_TO` to a real DXG address is worth doing to soften this — the platform
   already supports it and it is currently unset.
2. **The identity is shared with another product.** Anything done to the `av-rfpilot.com` identity —
   MAIL FROM attributes, DKIM rotation, a suppression-list entry, a reputation problem caused by
   either product — lands on both. Bounces from a bad speaker list can affect RFPilot's
   deliverability and vice versa. The `pmp-email` configuration set keeps the *telemetry* separate,
   but reputation is per-identity, not per-configuration-set.

## Action required: the SPF record does not authorize SES

```
av-rfpilot.com. TXT "v=spf1 include:spf.em.secureserver.net ?all"
```

**`amazonses.com` is not in there.** Mail this platform sends therefore does not pass SPF for its own
From domain. It authenticates today only because DKIM signs as `av-rfpilot.com` and aligns — a single
path with no fallback. (The previous sending domain, `dxg-agency.com`, already published
`include:amazonses.com`, so this is a step backwards that came with the switch.)

Add `include:amazonses.com` to the apex TXT record at GoDaddy — **edit the existing record, do not
add a second one**, as two SPF records are as broken as none:

```
v=spf1 include:spf.em.secureserver.net include:amazonses.com ~all
```

Changing `?all` to `~all` is the other half of it. `?all` is "neutral" — it tells receivers nothing
about unauthorized senders, which is close to having no SPF policy at all.

Verify with:

```bash
dig +short av-rfpilot.com TXT | grep spf
```

### Related, and currently broken

`_dmarc.av-rfpilot.com` publishes **two** DMARC records:

```
"v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;"
"v=DMARC1; p=none;"
```

Per [RFC 7489 §6.6.3](https://datatracker.ietf.org/doc/html/rfc7489#section-6.6.3), a receiver that
finds more than one DMARC record **must not apply DMARC at all**. So this domain has *no* effective
DMARC policy despite one record asking for `p=quarantine`. Confirmed against two resolvers on
2026-09-20. Delete the redundant `p=none` record.

Do the SPF fix *before* DMARC starts being enforced. Once exactly one record remains and
`p=quarantine` takes effect, DKIM becomes the only thing standing between this platform's mail and
the spam folder.

## Custom MAIL FROM domain

**Not currently set on `av-rfpilot.com`.** Unlike the previous domain, this one is now possible
without waiting on anyone — GoDaddy DNS is ours, `mail.av-rfpilot.com` is unused, and SES's rule
(the MAIL FROM domain must be a subdomain of the parent domain of the verified identity) is
satisfied.

It is deliberately **not** done yet, because it is an attribute of an identity RFPilot also sends
from, so it changes another product's production envelope sender. That needs RFPilot's agreement,
not just this project's.

When it is agreed, publish these at GoDaddy **first**:

| Host | Type | Priority | Value |
|---|---|---|---|
| `mail` | MX | `10` | `feedback-smtp.us-east-2.amazonses.com` |
| `mail` | TXT | — | `v=spf1 include:amazonses.com ~all` |

Exactly one MX record on that subdomain — SES fails the setup outright if it finds more than one.
Then configure:

```bash
aws sesv2 put-email-identity-mail-from-attributes --region us-east-2 --profile rfpilot \
  --email-identity av-rfpilot.com \
  --mail-from-domain mail.av-rfpilot.com \
  --behavior-on-mx-failure USE_DEFAULT_VALUE
```

**Records first, then configure — the order matters.** SES looks for the MX record for 72 hours
*from when the MAIL FROM was configured*, not from when the records appear. If it has not found it
by then the status goes to `Failed`, SES stops checking, and publishing the records afterwards does
nothing until the command above is re-run. Check with:

```bash
aws sesv2 get-email-identity --email-identity av-rfpilot.com --region us-east-2 --profile rfpilot \
  --query 'MailFromAttributes'
```

Start with `USE_DEFAULT_VALUE`, which falls back to `amazonses.com` if the MX lookup fails. Switch to
the stricter `REJECT_MESSAGE` only once the status reads `SUCCESS` — before that it would reject
every outgoing message, and on a shared identity it would take RFPilot's mail down too.

## The abandoned `dxg-agency.com` setup

Kept here so the leftover state in AWS is not a mystery to whoever finds it.

`dxg-agency.com` is verified with DKIM `SUCCESS` and has `mail.dxg-agency.com` configured as a custom
MAIL FROM, stuck in `PENDING` since 2026-09-17 — the required records were never published, because
that zone is at **Namecheap** and outside our control. It has since passed SES's 72-hour window and
will read `Failed`.

**This is harmless and needs no cleanup.** `BehaviorOnMxFailure` is `USE_DEFAULT_VALUE`, and nothing
sends as `dxg-agency.com` any more. Note the API is still served at `api.dxg-agency.com`, so the
domain itself is still in use — do not delete the identity on the assumption that it is dead.

## Why the configuration set matters

**Without a configuration set, SES publishes no delivery, bounce or complaint events at all.** The
platform would record every message as `sent` and never learn that a speaker's address is dead — so
the one speaker who never got their upload link would look identical to the ones who did. The
application warns at startup when `SES_CONFIGURATION_SET` is unset for exactly this reason.

Note RFPilot has **no** configuration set of its own, so it receives no delivery telemetry. Now that
both products share a sending identity, that gap is worth closing on their side too.

## Application configuration

```bash
MAIL_TRANSPORT=ses
AWS_REGION=us-east-2
MAIL_FROM=noreply@av-rfpilot.com
SES_CONFIGURATION_SET=pmp-email
SNS_TOPIC_ARNS=arn:aws:sns:us-east-2:295229565954:pmp-email-events
# MAIL_REPLY_TO=<a real DXG address>   # recommended, see "Sender decision"
```

Credentials come from the standard AWS chain — an instance role in production, never the repo.
The sending principal needs `ses:SendEmail` scoped to the identity and configuration set.

## Outstanding

1. **SPF does not include `amazonses.com`.** See above — one record edit at GoDaddy, and the
   highest-value item here.
2. **Duplicate DMARC record** on `av-rfpilot.com` means DMARC is not applied at all. See above.
3. **No SNS subscription yet.** Events publish to the topic and go nowhere, because the API has no
   public URL. When it is deployed, subscribe `POST https://<api>/api/v1/webhooks/email` — the
   endpoint already verifies SNS signatures and handles subscription confirmation.
4. **`MAIL_REPLY_TO` is unset.** Worth pointing at a real DXG address now that the From domain is a
   vendor one.
5. **Open and click tracking are off.** SES rewrites every link through `awstrack.me` unless a custom
   tracking domain exists, and a speaker being asked to click an unfamiliar redirect is worse than
   the metric is worth. Add `TrackingOptions` once a subdomain is available.
6. **Custom MAIL FROM** — possible now, needs RFPilot's agreement first. See above.
7. **The live resources were created with the CLI, not CloudFormation.** `deploy/aws/lib/email-stack.ts`
   describes them exactly, but a first `cdk deploy` would fail on the existing names. Either
   `cdk import` them into the stack, or delete and let CDK create them. Until then this is known drift.

## Reconciling the drift

```bash
cd deploy/aws
npx cdk import Pmp-Email --profile rfpilot      # adopt the existing resources
# or, to start clean:
aws sesv2 delete-configuration-set --configuration-set-name pmp-email --region us-east-2 --profile rfpilot
aws sns delete-topic --topic-arn arn:aws:sns:us-east-2:295229565954:pmp-email-events --region us-east-2 --profile rfpilot
npx cdk deploy Pmp-Email --profile rfpilot
```
