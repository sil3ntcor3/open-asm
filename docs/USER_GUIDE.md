# Open-ASM User Guide

Finding, understanding, and acting on your external attack surface.

This guide is for security analysts and engineers using the Open-ASM console.
If you are deploying or operating the platform itself, read the
[Administrator Guide](ADMINISTRATOR_GUIDE.md).

---

## Contents

1. [Concepts](#1-concepts)
2. [Getting oriented](#2-getting-oriented)
3. [Adding targets](#3-adding-targets)
4. [What discovery does](#4-what-discovery-does)
5. [Watching a scan](#5-watching-a-scan)
6. [Working with assets](#6-working-with-assets)
7. [Groups](#7-groups)
8. [Scheduling and scan windows](#8-scheduling-and-scan-windows)
9. [Vulnerabilities](#9-vulnerabilities)
10. [Issues](#10-issues)
11. [Reports](#11-reports)
12. [Search](#12-search)
13. [The AI assistant](#13-the-ai-assistant)
14. [Notifications and account settings](#14-notifications-and-account-settings)
15. [Reading results critically](#15-reading-results-critically)
16. [FAQ](#16-faq)

---

## 1. Concepts

Six ideas carry the whole product. Getting them straight makes everything else
obvious.

**Workspace** — the container for everything you see. Targets, assets,
findings, reports, and groups all belong to exactly one workspace. Switching
workspaces (top-left selector) swaps your entire view. You only see workspaces
you have been granted access to.

**Target** — something you tell Open-ASM to go look at: a domain, an IP
address, or a /24 CIDR range. Targets are inputs. You create them.

**Asset** — something Open-ASM *found*. For a domain target, every discovered
subdomain becomes an asset. The target's own value is also an asset, flagged as
the **primary** asset. Assets are outputs. You do not create them.

**Asset service** — one network service on one asset: a port, its protocol, and
what is listening. `api.example.com:443/https` is an asset service.
A single asset commonly has many. **This is the level most findings anchor
to** — a vulnerability is usually a property of a service, not of a host.

**Vulnerability** — a finding produced by a scanner against an asset or one of
its services, carrying a severity, evidence, and first/last-seen timestamps.

**Issue** — a unit of *work* you open to get something fixed. Issues are opened
by people, can reference a vulnerability, carry comments, and are either open or
closed. Vulnerabilities are what the scanner saw; issues are what you decided
to do about it.

The relationship in one line:

```
Workspace → Target → Asset → Asset service → Vulnerability → Issue
```

---

## 2. Getting oriented

### Signing in

Navigate to your console URL and sign in with the email and password your
administrator provisioned. Accounts are created by administrators; there is no
self-service registration.

### The workspace selector

Top-left, above the navigation. If it reads `default` and that is the only
entry, your deployment has a single workspace. Everything you do applies to the
selected workspace only.

### Navigation

| Group | Page | What it is for |
|---|---|---|
| **Overview** | Dashboard | Risk score, vulnerability counts by severity, TLS statistics |
| | New Chat | AI assistant over your asset data |
| **Attack surface** | Targets | What you have asked Open-ASM to scan |
| | Groups | Named collections of assets, with their own schedules |
| | Assets | Everything discovered, sliceable seven ways |
| **Security** | Vulnerabilities | Every finding, filterable |
| | Issues | Remediation work you have opened |
| | Reports | Generated PDFs |
| **Management** | Tools | Scanner engines and their versions |
| | Workers | Scanning capacity and health |
| | Jobs Registry | Every scan run and its jobs |

An **Admin → Users** group appears only for platform administrators.

### The dashboard

Your at-a-glance view: an overall **Score**, vulnerability counts broken out
by Critical / High / Medium / Low / Info, and TLS statistics including
already-expired certificates. On a fresh workspace the score reads 10 with
zero findings — that means "nothing scanned yet", not "nothing wrong".

---

## 3. Adding targets

**Targets → Add Target.**

### Choosing a type

| Type | Format | Example |
|---|---|---|
| **Domain** | A valid domain name | `example.com` |
| **IP** | A dotted-quad IPv4 address | `203.0.113.10` |
| **CIDR** | A **/24 range only** | `203.0.113.0/24` |

> **CIDR is restricted to /24.** `10.0.0.0/16` is rejected. Break larger ranges
> into individual /24s — 256 hosts is the maximum span of a single CIDR target.

### Adding many at once

The input accepts multiple values separated by **newlines or commas**:

```
example.com
staging.example.com
partner-portal.example.com
```

All values in one submission must be the same type. Duplicates are detected
case-insensitively and rejected before anything is created, so a paste
containing `Example.com` and `example.com` fails as a duplicate rather than
creating two targets.

Each value is validated individually and the error names the offending entry,
so a bad line in a long paste is easy to find.

### Then start discovery

Creating a target registers it. Depending on your role, discovery may start
automatically or wait for you to press **Start Discovery** from the Targets
list.

> **Permissions note.** The **Analyst** role can create targets but *cannot*
> run scans. If **Start Discovery** is unavailable to you, you hold Analyst;
> ask an Operator, Security Administrator, or Owner to start the run.

### Before you scan

Open-ASM performs genuinely active reconnaissance: port scanning, service
fingerprinting, and vulnerability probing. Only add targets you own or have
written authorization to test.

---

## 4. What discovery does

Discovery is a fixed pipeline. Each stage feeds the next, and **the stages
differ by target type.**

### Domain targets

```
subfinder  →  naabu  →  nmap  →  httpx  →  screenshot  →  nuclei
```

| Stage | Tool | What it does | Produces |
|---|---|---|---|
| Scan Subdomain | `subfinder` | Passive subdomain enumeration across many sources | Assets |
| Port Scan | `naabu` | Fast TCP port discovery on every asset | Open ports |
| Service Discovery | `nmap` | Fingerprints what is actually listening | Asset services |
| HTTP Probe | `httpx` | Probes web services for status, title, headers | HTTP metadata |
| Take Screenshot | `screenshot` | Headless Chromium capture of web services | Screenshots |
| Vuls Scan | `nuclei` | Template-driven vulnerability and misconfiguration scanning | Vulnerabilities |

### IP and CIDR targets

```
naabu  →  nmap  →  httpx  →  screenshot  →  nuclei
```

Identical, minus subdomain enumeration — there are no subdomains to find for a
bare IP or a network range.

### Things worth knowing

**Subdomain enumeration is passive.** `subfinder` queries public sources rather
than brute-forcing DNS. Coverage improves substantially when your administrator
configures credentialed sources.

**Subdomain results are DNS-filtered before they become assets.** A `dnsx` pass
runs inside the subdomain stage to strip wildcard-DNS noise from parked domains.
It is not a separate stage and will not appear in the Jobs Registry.

**Each stage fans out across the whole target.** When the port scan drains,
service discovery is created for *every* asset in the target, not just the one
that finished last.

**An empty stage does not stop the pipeline.** If the screenshot stage finds no
web services to capture, the run continues to vulnerability scanning rather
than stopping. A stage producing nothing is normal.

**Vulnerability scanning runs last and at lower priority.** Nuclei is
deliberately deprioritized so a large vulnerability sweep cannot starve the
port and service scans that feed it. On a big target, expect findings to arrive
well after inventory has settled.

**Nuclei may be withheld.** If no validated template set exists on the workers,
vulnerability jobs are held back while every other stage runs normally. Ask
your administrator if findings never appear but inventory populates fine.

### Fast scan

On a target's **Vulnerabilities** tab, **Fast scan** runs the vulnerability
stage alone against the existing inventory — no re-enumeration, no re-scanning
of ports. Use it to re-check for new findings after a template update. It is
only available once the target's initial discovery has completed.

---

## 5. Watching a scan

### On the target

Open the target from the Targets list. While discovery is running you get a
live progress view, and the inventory refreshes about once a second (dropping
to every 30 seconds once the run finishes).

A target detail page has two tabs:

- **Inventory** — assets and services discovered so far
- **Vulnerabilities** — findings for this target, with severity statistics

### Jobs Registry

**Management → Jobs Registry** lists every run: the job, total jobs, start and
end times, and run type. Open a run to see its individual jobs.

| State | Meaning |
|---|---|
| `pending` | Queued, waiting for a worker |
| `in_progress` | Running now |
| `completed` | Finished successfully |
| `failed` | Finished with an error |
| `cancelled` | Cancelled by an operator |
| `paused` | Held; will not be dispatched until resumed |

### Why a scan might look stalled

Jobs sitting at `pending` for a long time usually mean one of four things:

1. **Outside the scan window.** Jobs wait rather than fail. Check the target's
   schedule settings.
2. **No available workers.** Check **Management → Workers** for online,
   scanner-healthy workers.
3. **Workers paused.** An administrator may be draining them for maintenance.
4. **A large target.** A /24 with many live hosts generates hundreds of jobs.
   Port and service scans are dispatched ahead of vulnerability scans by
   design.

---

## 6. Working with assets

**Assets** shows everything discovered in the workspace, with seven tabs that
slice the same inventory different ways:

| Tab | Answers |
|---|---|
| **Services** | What is listening, where — with screenshot, technologies, and certificate |
| **Technologies** | What software is running across the estate |
| **IP Addresses** | Which addresses you are exposed on |
| **Ports** | Which ports are open across everything |
| **Hosts** | The hostname view |
| **Status Code** | HTTP responses — useful for spotting 401/403 gates and 5xx |
| **TLS** | Certificate inventory |

Filter with the value box plus the chips: **IP**, **Port**, **Technology**,
**Status Code**, **Host**, **TLS Host**, and **Date**.

### Useful queries

- **Unexpected admin surface** — Ports tab, filter to 22, 3389, 5432, 3306.
  Anything internet-facing there deserves an immediate look.
- **Certificate expiry** — TLS tab, cross-referenced with the dashboard's
  already-expired count.
- **Technology sprawl** — Technologies tab. End-of-life versions concentrated
  on a few hosts are usually the fastest real risk reduction available.
- **Shadow IT** — Services tab sorted by first-seen. New services nobody
  announced are exactly what an ASM platform exists to surface.

### Asset detail

Opening an asset shows its services, detected technologies, TLS details,
screenshots, and associated findings.

Screenshots are **best-effort**. A missing screenshot means the capture did not
succeed; it does not mean the service is down or that the scan failed.

---

## 7. Groups

**Groups** are named, colour-coded collections of assets that cut across
targets.

Create one with **Groups → Create**, then add assets to it. The list shows each
group's name, total assets, and creation date.

Groups exist for two reasons:

1. **Filtering** — "everything in the payment platform" regardless of which
   target discovered it.
2. **Scheduling** — a group can carry its own workflow on its own recurring
   schedule, so a high-value subset gets scanned more often than the rest of
   the estate.

Group your crown jewels and scan them daily; leave the long tail on weekly or
monthly.

---

## 8. Scheduling and scan windows

Open a target and use the **settings** (gear) control.

### Recurring scans

| Option | When it runs |
|---|---|
| Disabled | Never — manual only |
| Daily | 00:00 every day |
| Every 3 days | 00:00 every third day |
| Weekly | 00:00 Sunday |
| Bi-weekly | 00:00 every 14 days |
| Monthly | 00:00 on the 1st |

All recurring scans run at midnight.

### Scan windows

A scan window confines active scanning to hours you have agreed with the
business. Set a **start time**, an **end time**, a **timezone**, and optionally
specific **days of the week**.

- Jobs are only dispatched while the window is open, evaluated in the
  **target's** timezone rather than yours.
- Windows crossing midnight (22:00–06:00) work correctly.
- Outside the window, jobs stay `pending` rather than failing — they resume
  when it reopens.
- A target with no window is always scannable.

The default suggestion is 22:00–06:00, which suits most change-freeze windows.

### Re-scanning now

The same settings panel has a **re-scan** control that re-runs the full
discovery pipeline immediately, ignoring the schedule.

---

## 9. Vulnerabilities

**Vulnerabilities** is the workspace-wide findings view, with counters for
Critical, High, Medium, Low, and Info across the top.

### Columns

`SEVERITY` · `DETAILS` · `ASSET` · `TAGS` · `FIRST SEEN` · `LAST SEEN` ·
`SCANNED BY` · `STATUS` · `ANALYZE`

**First seen** and **last seen** are the two most useful and most overlooked
columns. Together they tell you whether a finding is new, persistent, or
possibly resolved:

- First seen recent → genuinely new exposure. Prioritize.
- First seen old, last seen recent → persistent. Still there, still yours.
- Last seen not recent → may already be fixed. Re-scan to confirm before
  spending time on it.

### Filters

Status (defaulting to **Open**), Severity, Date, Tags, and Target. Search
covers finding names and details.

### Triage

Open a finding for its full detail: the template that fired, matched evidence,
affected asset and service, and remediation guidance.

A practical order of attack:

1. **Critical and High on internet-facing services** — filter by severity, then
   confirm the asset is genuinely exposed.
2. **Anything new since the last review** — sort by first seen.
3. **Everything else** — batch it into scheduled remediation.

Severity is the scanner's opinion, not your risk assessment. A Critical on a
decommissioned staging box matters less than a Medium on your payment gateway.
Weight by asset, not just by badge.

### Analyze

The **ANALYZE** column runs AI-assisted analysis of a finding. It requires a
connected AI provider (see [§13](#13-the-ai-assistant)). You are notified when
the analysis completes.

---

## 10. Issues

Issues are how remediation gets tracked. A vulnerability is what a scanner saw;
an issue is a commitment to do something about it.

**Issues → Create Issue.** An issue has a title, description, optional
reference to a source vulnerability, comment thread, and a status of **Open**
or **Closed**.

The list filters by status and defaults to **Open**.

### Using them well

- **One issue per remediation action, not per finding.** Forty instances of the
  same missing header across one platform is one issue, not forty.
- **Reference the vulnerability.** It keeps the evidence attached to the work.
- **Comment the decision, not just the outcome.** "Accepted — host is
  decommissioned 2026-09-30" is worth far more in six months than a silent
  close.
- **Close when verified, not when deployed.** Re-scan first.

Closing an issue does not change the underlying vulnerability's status; they
are tracked independently.

---

## 11. Reports

**Reports** generates workspace PDFs, lists saved files, and removes ones you
no longer need. Tabs: **All**, **Summary**, **Vulnerability**, and
**Templates**.

- **Summary** — posture overview. Suits management and periodic reviews.
- **Vulnerability** — detailed findings with evidence. Suits the engineers
  doing the fixing.
- **Templates** — the report templates available to you.

Generated reports persist and are searchable by filename and creation date, so
a report is a point-in-time record you can return to. Generate one before and
after a remediation push to evidence the delta.

Report generation requires the **Manage reports** permission (Analyst and
above).

---

## 12. Search

The search bar at the top of every page runs full-text search across your
workspace's asset data. Use it when you know *what* you are looking for but not
*where* it lives — a hostname, an IP, a technology name.

For structured filtering, the Assets page chips are more precise.

---

## 13. The AI assistant

**Overview → New Chat** opens a conversational assistant over your collected
asset data — useful for questions that are awkward to express as filters:
"which hosts run an end-of-life web server?", "what changed in the last week?"

### Setup

The assistant needs a connected LLM provider. If you see **Connect an AI
Provider**, none is configured yet. Supported: OpenAI, Anthropic, Google
Gemini, OpenRouter, Kilo Gateway, and any OpenAI-compatible endpoint.

Connecting requires the **Manage AI agent** permission (Security Administrator
or Owner). Using it requires **Use AI agent** (Analyst and above). If you can
chat but not configure, that is the intended split.

### Using it sensibly

Your asset data is sent to the configured provider. Two consequences:

- Treat provider choice as a data-handling decision. Inventory of your external
  attack surface is sensitive.
- Verify anything you would act on. Check the assistant's claims against the
  Assets and Vulnerabilities pages before opening an issue on its say-so.

Conversations are saved and revisitable from the chat history.

---

## 14. Notifications and account settings

### Notifications

The bell icon shows in-app notifications:

- A new workspace was created
- Vulnerability analysis completed
- **A new asset was detected**

The third is the one to watch. A new asset appearing on a mature target is
either an expected deployment or something nobody told you about.

Notifications are in-app only — there is no email, Slack, or webhook delivery.
Check the console.

### Your account

**Settings → Preferences** sets the console theme: **Light**, **Dark**, or
**System**. The header also carries a quick theme toggle.

**Settings → Security** changes your password. You need your current password
to set a new one; if you have lost it, an administrator must re-provision the
account on the host.

**Settings → Roles & permissions** shows exactly what your role can do — worth
reading once so you know which controls should be available to you.

---

## 15. Reading results critically

Every ASM platform produces artifacts of its own methodology. Knowing
Open-ASM's makes you much faster at separating signal from noise.

**A missing screenshot is not a missing service.** Screenshots are best-effort
and are not gated on the HTTP probe succeeding. The HTTP probe itself sometimes
marks genuine web services on 80/443 as failed mid-pipeline. Trust the service
entry over the absence of a screenshot.

**Check port attribution when evidence looks wrong.** An upstream quirk in the
HTTP probe can cause a request to `host:443` to silently fall back to
`http://host:80`, filing port 80's response under the `:443` service. If a
finding's evidence does not match its port, verify manually before acting.

**Wildcard DNS produces nonsense subdomains.** Parked domains resolve
everything, generating junk like `mx.mx.mx.example.com`. Open-ASM filters these
out, but a flood of obviously synthetic subdomains on a new target means the
filter did not engage — tell your administrator rather than triaging the noise.

**CDN and WAF ranges can look enormous.** Edge providers may answer on every
port in a scanned range, producing thousands of phantom services. A /24 that
suddenly shows uniform services on every address is almost certainly an edge
provider, not your infrastructure.

**"No findings" on a fresh workspace means "not scanned yet."** The dashboard's
default score of 10 with zero vulnerabilities is an empty state.

---

## 16. FAQ

**Why can I create a target but not scan it?**
You hold the Analyst role, which grants target creation but not scan execution.
Ask an Operator, Security Administrator, or Owner to start the run.

**Why is CIDR limited to /24?**
It is the maximum span accepted per target. Split larger ranges into individual
/24s.

**My scan has been pending for hours.**
Check, in order: the target's scan window; worker availability and health under
**Management → Workers**; whether workers are paused; and the size of the
target. Large ranges generate hundreds of jobs and vulnerability scanning is
intentionally last.

**Inventory populated but no vulnerabilities appeared.**
Vulnerability scanning runs last and at the lowest priority — give it time. If
findings never appear, Nuclei jobs may be withheld because no validated
template set exists on the workers. Ask your administrator.

**A finding I fixed still shows as open.**
Re-scan to confirm. Check **last seen**: if it has not updated since your fix,
the finding is stale rather than current. Findings are not auto-closed on your
say-so.

**What is the difference between a vulnerability and an issue?**
A vulnerability is what a scanner observed. An issue is work you opened to
address it. Closing an issue does not change the vulnerability, and vice versa.

**Can I export my data?**
Generate a report from the **Reports** page. Programmatic access is available
through the workspace API key under **Settings → API keys**, with interactive
API documentation at `/api/docs` on the Core API.

**Where did the MCP integration go?**
It is not enabled in this build. The MCP server code is present but inactive,
and the MCP Connect settings tab is disabled. Use the AI assistant instead.

**Someone else's changes are not showing.**
Try a hard reload. The console is a cached single-page app and can serve stale
assets after a platform upgrade.

---

## Related documentation

- [Administrator Guide](ADMINISTRATOR_GUIDE.md)
- [Reports](reports.md)
- [Screenshot worker](worker/screenshot.md)
