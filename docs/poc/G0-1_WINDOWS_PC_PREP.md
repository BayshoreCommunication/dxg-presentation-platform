# Preparing the Windows PC for the room PC test

These steps get the Windows test PC ready so the test can be run remotely from the Mac. Do them in order. Every
command goes in **PowerShell opened as administrator**: Start menu → type `PowerShell` → right-click → **Run as
administrator**. Paste one command at a time and wait for it to finish.

When you're done, send back the items in **"What to send back"** at the end.

---

## Step 1 — Make room on the C: drive (at least 15 GB free)

The test needs about 15 GB free in total:

| What | Roughly |
|---|---|
| OpenSSH Server (remote access) | 50 MB |
| Node.js, the project and its packages | 2 GB |
| Visual Studio Build Tools (builds the part that controls PowerPoint) | 6–8 GB |
| Screen recordings of the test decks | 1–3 GB |
| Headroom for Windows and PowerPoint | a few GB |

**1.1 See how much is free:**

```powershell
Get-PSDrive C | Select-Object @{n="Free GB";e={[math]::Round($_.Free/1GB,1)}}, @{n="Used GB";e={[math]::Round($_.Used/1GB,1)}}
```

If **Free GB** is 15 or more, go to Step 2. If not, free space with the steps below, safest first, checking the
number again after each.

**1.2 Disk Cleanup, including system files.** The first command opens a list: tick everything **except Downloads**,
press OK. The second runs the cleanup.

```powershell
cleanmgr /sageset:1
```

```powershell
cleanmgr /sagerun:1
```

**1.3 Remove old Windows component versions.** Safe; can take 10–20 minutes.

```powershell
Dism /Online /Cleanup-Image /StartComponentCleanup
```

**1.4 Look for large files yourself:** **Settings → System → Storage** shows what is using space. Usual culprits:
Downloads, the Recycle Bin, videos, apps nobody uses. On a PC someone else relies on, ask before deleting anything.

> Can't reach 15 GB? Send the Free GB number anyway — some parts can be skipped.

---

## Step 2 — Install OpenSSH Server (lets the Mac run commands on this PC)

**2.1 Install it** (downloads from Microsoft, 1–2 minutes). It should end with `RestartNeeded : False`.

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
```

> If this fails on a company-managed PC, use this instead, then carry on with 2.2:
>
> ```powershell
> winget install Microsoft.OpenSSH.Beta
> ```

**2.2 Start it, and start it automatically from now on:**

```powershell
Start-Service sshd; Set-Service sshd -StartupType Automatic
```

**2.3 Allow it through the firewall** (usually already done; harmless to run):

```powershell
if (-not (Get-NetFirewallRule -Name OpenSSH-Server-In-TCP -ErrorAction SilentlyContinue)) { New-NetFirewallRule -Name OpenSSH-Server-In-TCP -DisplayName "OpenSSH Server (sshd)" -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 }
```

**2.4 Check it is running and note the PC's address:**

```powershell
Get-Service sshd; ipconfig | findstr IPv4
```

You should see **Running** and a line like `IPv4 Address . . . : 192.168.1.23`. Take a screenshot.

---

## Step 3 — Create the test account (no administrator rights)

The room software must work without admin rights, so the test runs under an ordinary account. Choose a password
and keep it to yourself — it is never needed by the person running the test remotely.

```powershell
$pw = Read-Host -AsSecureString "Password for dxgtest"
New-LocalUser -Name "dxgtest" -Password $pw -FullName "DXG test" -PasswordNeverExpires
Add-LocalGroupMember -Group "Users" -Member "dxgtest"
```

Then **sign out and sign in once as `dxgtest`**, so Windows creates its folders. While signed in as `dxgtest`:

- Open **PowerPoint**, sign in to Microsoft 365 if asked, accept the first-run screens, then close it.
- In PowerPoint: **File → Options → General → untick "Show the Start screen when this application starts"**.

Sign back in to your administrator account for Step 4.

---

## Step 4 — Allow the Mac in without a password

The Mac logs in with a key instead of a password. You will be sent **one line** that starts with `ssh-ed25519` —
paste it into the command below in place of `PASTE-THE-LINE-HERE` (keep the quotes), then run all four commands.

```powershell
$line = "PASTE-THE-LINE-HERE"
New-Item -ItemType Directory -Force "C:\Users\dxgtest\.ssh" | Out-Null
Set-Content -Path "C:\Users\dxgtest\.ssh\authorized_keys" -Value $line -Encoding ascii
icacls "C:\Users\dxgtest\.ssh\authorized_keys" /inheritance:r /grant "dxgtest:F" /grant "SYSTEM:F" | Out-Null
```

This allows only that one key, only for the `dxgtest` account.

---

## Step 5 — Make sure the Mac can reach the PC

Easiest: the Mac and the Windows PC on the **same Wi-Fi or office network**.

If they are on different networks (for example the PC is at the office and the Mac at home), install
**Tailscale** (free) on both and sign in to the same Tailscale account: <https://tailscale.com/download>. Then send
the PC's Tailscale address (starts with `100.`) instead of the IPv4 address.

---

## Step 6 — Screens

For the screen tests, connect **2 monitors** to the PC, and a **third** if you have one (the projector and the lectern
screen in a real room). Set **Display settings → Multiple displays → Extend these displays**.

---

## What to send back

1. The **Free GB** number from Step 1.1 (after cleanup).
2. The **screenshot from Step 2.4** (shows `Running` and the IPv4 address).
3. Whether the Mac is on the **same network**, or the PC's **Tailscale address**.
4. Confirmation that **`dxgtest`** exists and PowerPoint opened once under it.
5. How many **monitors** are connected.

Then you'll receive the key line for Step 4, and the rest of the setup and the tests are run remotely. You'll be
asked to watch the screen for a few checks (animations, video, fonts, the holding screen).
