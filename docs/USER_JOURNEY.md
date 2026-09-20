# How to use the Presentation Management Platform

Written for someone opening it for the first time. No technical background assumed.

There are two separate places to sign in. **Speakers** get a simple one-page site for sending in
their presentation. **DXG staff** get the full control centre. They are deliberately different: a
speaker should never have to learn a system, and should never see anyone else's material.

---

## Part 1 — The speaker's experience

This is what a presenter at your event goes through. It is three steps and takes about a minute.

### 1. They receive an email

The platform emails each speaker a link and a personal access code. The code looks like
`NEV3-9QPF-TEJR`.

There is **no account to create and no password to choose**. This is on purpose — speakers are busy
people who will be doing this once, and every extra step is someone who does not upload.

### 2. They sign in

They open the link and enter two things: the email address you hold for them, and the access code.

Following the link alone is not enough — the email address is still required. That way a forwarded
email does not hand someone else access to the presentation.

### 3. They upload

They see one page, showing only their own talk:

- The title, the room, and the date and time they are presenting
- The **upload deadline**
- The **requirements**, in plain language — 16:9 widescreen, PowerPoint preferred, embed your fonts
  and videos, up to 10 GB
- A box to drag the file into, or a **Choose file** button

When the upload finishes they immediately see a confirmation:

> **v2 received.** Checksum verified — `123e81e0…672e`. Automated checks have run; we'll email you
> if anything needs attention.
>
> · 5 slides.
> · 1 embedded media file(s).

That confirmation is doing real work. It tells the speaker the file arrived **complete and
undamaged**, not merely that an upload finished — which is the reassurance that stops the anxious
"did you get my deck?" email to your team.

**If they need to change something**, they upload again. The button now says **Replace file**. The
earlier version is never destroyed — it is kept and marked as superseded, so a mistaken replacement
can always be undone.

**If their connection drops mid-upload**, it resumes where it left off rather than starting over.
This matters more than it sounds: presentations with embedded video run to hundreds of megabytes, and
hotel wifi is what it is.

---

## Part 2 — The DXG staff experience

Staff sign in at the control centre with a work email, a password, and a six-digit code from an
authenticator app. The second step is required for everyone, every time — staff can see and change
every speaker's material for an entire event, so a leaked password alone must not be enough.

Accounts are created by a DXG administrator. There is no public signup.

### Setting up an event

1. **Create event** — name, dates, venue, timezone.
2. **Schedule import** — upload the schedule spreadsheet. The platform matches sessions to rooms and
   speakers, shows you what it understood before committing anything, and can be re-run when the
   agenda changes without creating duplicates.
3. **Speakers** — review the speaker list, correct anything the import misread, add late additions.

### Chasing the presentations

**Communications** is where you send speakers their upload links and reminders. You choose a message
template and who it goes to — for example, only speakers who have not uploaded yet. The platform
records what was sent and to whom, so nobody is chased twice and nobody is missed.

### Checking what arrives

**Portfolio** is the overview: every event, with a progress bar and a count of anything unresolved.

**Presentation detail** and **Inspection** show a single talk in depth. Every file is checked
automatically on arrival — slide count, aspect ratio, embedded video, file size — and anything
concerning is flagged before it becomes a problem in the room.

**Review & approval** is where a member of staff signs off a presentation as ready. Approval is a
deliberate act by a named person, not something that happens quietly in the background.

### On the day

- **Speaker Ready Room** — where presenters come to check their slides on equipment matching the room
- **Check-in** — confirming a speaker has arrived and their material is ready
- **USB intake** — for the speaker who arrives with a memory stick and no prior upload
- **Room sync** — getting the approved file onto the machine in the correct room

The system will not send an unapproved presentation to a room. That refusal is the point: it is the
last thing standing between a rushed change and the wrong slides going up on screen.

### Afterwards

**Archive builder** packages a finished event — the presentations, their versions and the record of
what happened — into a single archive.

**Client portal** is what your client sees: a read-only view of their own event, and nobody else's.

---

## The things worth knowing

**Nothing is ever quietly overwritten.** Every version of every file is kept. Replacing a
presentation supersedes the old one rather than destroying it.

**Every action is recorded permanently** — who did what, and when. The record cannot be edited
afterwards, by anyone, including administrators. If a question arises about which version was shown
in a room, the answer is available and trustworthy.

**People only see their own material.** A speaker sees their talk. A client sees their event. This is
enforced by the system itself, not by remembering to be careful.

---

## If something goes wrong

| What you see | What it means |
|---|---|
| Speaker says the access code doesn't work | Codes expire. Issue a new one from **Speakers** |
| Speaker never received the email | Check **Communications** — it records delivery, including failures |
| Upload seems stuck | It resumes automatically. If the speaker closed the tab, re-opening and re-selecting the same file continues rather than restarts |
| A presentation won't go to a room | It has not been approved yet. Check **Review & approval** |
