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

## Authentication posture

Both DNS fixes were made at GoDaddy on 2026-09-20, in that order deliberately.

**SPF — done and verified.** The record was `v=spf1 include:spf.em.secureserver.net ?all`, which did
not authorize SES at all; mail authenticated on DKIM alone with no fallback. (The previous sending
domain, `dxg-agency.com`, already published `include:amazonses.com`, so the switch to this domain had
quietly been a step backwards.) Now:

```
v=spf1 include:spf.em.secureserver.net include:amazonses.com ~all
```

Confirmed identical on the authoritative nameservers and on 1.1.1.1 / 8.8.8.8 / 9.9.9.9: exactly one
SPF record, `amazonses.com` authorized, `~all` rather than the old neutral `?all`, and 2 of the
permitted 10 DNS lookups used.

**DMARC — duplicate removed.** `_dmarc` carried two records (`p=none` and `p=quarantine`), and per
[RFC 7489 §6.6.3](https://datatracker.ietf.org/doc/html/rfc7489#section-6.6.3) a receiver finding more
than one **must not apply DMARC at all** — so the domain had no effective policy despite asking for
`p=quarantine`. The stray `p=none` record was deleted; the surviving policy is:

```
v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;
```

**Order mattered and should be preserved if this is ever redone.** While DMARC was unenforced, the
weak SPF cost nothing. Deleting the duplicate is what switches enforcement on — had that been done
first, DKIM would have been the only thing between both products' mail and the spam folder.

`adkim=r; aspf=r` is relaxed alignment and mail now passes on both paths, so enforcement should be
uneventful. The `rua=` aggregate reports are the place to check for forgotten senders before anyone
considers `p=reject`.

### Verifying

```bash
dig +short av-rfpilot.com TXT | grep spf              # expect exactly 1 record
dig +short _dmarc.av-rfpilot.com TXT                  # expect exactly 1 record
```

Query the authoritative nameservers (`@ns35.domaincontrol.com`, `@ns36.domaincontrol.com`) when
checking a recent change. GoDaddy's anycast nodes converge unevenly — during the DMARC edit `ns36`
returned the new answer while `ns35` alternated between old and new for several minutes. A single
`dig` during that window is not evidence either way; query both nameservers and a public resolver,
more than once.

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
MAIL_REPLY_TO=dxgrfptool@gmail.com          # see "Sender decision"
```

Credentials come from the standard AWS chain — an instance role in production, never the repo.
The sending principal needs `ses:SendEmail` scoped to the identity and configuration set.

## Outstanding

1. ~~SPF does not include `amazonses.com`~~ — **done 2026-09-20**, see "Authentication posture".
2. ~~Duplicate DMARC record~~ — **done 2026-09-20**, see "Authentication posture".
3. **No SNS subscription yet.** Events publish to the topic and go nowhere, because the API has no
   public URL. When it is deployed, subscribe `POST https://<api>/api/v1/webhooks/email` — the
   endpoint already verifies SNS signatures and handles subscription confirmation.
4. ~~`MAIL_REPLY_TO` is unset~~ — **set 2026-09-20** to `dxgrfptool@gmail.com` (D-020). Worth
   revisiting when DXG provides a branded, monitored mailbox; it is one env change.
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
