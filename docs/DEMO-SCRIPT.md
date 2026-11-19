# Demo video script

Target length: under 3 minutes. The segments below add up to 175 seconds. Each segment
lists its clock time, its length, what is on screen, and the voice-over.

## Before recording

- Open `<DEMO_URL>` in a clean browser window. The demo accounts are chosen on the
  sign-in page.
- Plan three sign-ins: Professional, Client, and Auditor. Each sign-in uses two of the 20
  requests that the sign-in route allows per 15 minutes from one IP address. A recording
  that signs in more often can hit the limit and show `429`. Wait 15 minutes, or record
  from another network, before you start again.
- Pick an appointment with status Scheduled, where the Professional account is the
  professional and the Client account is the client. The chat opens only for scheduled
  appointments.
- Do not say that a real audio and video call was made. Say only what the screen shows.

## Script

### 00:00 to 00:10 (10 s): Title

On screen: the project name, doctor7-onprem, and the Frankenstein category.

Voice-over: "doctor7-onprem is a clinical care platform that a clinic runs on its own
Debian server."

### 00:10 to 00:25 (15 s): The idea

On screen: the list in `docs/ARCHITECTURE.md` of the parts: Apache, the Node.js API,
MariaDB, and the video providers.

Voice-over: "It rebuilds a hosted service for on-premise use. There are no containers.
Video runs on Google Meet or on Jitsi, and the clinic chooses which one in the
configuration."

### 00:25 to 00:45 (20 s): Sign in

On screen: the sign-in page at `<DEMO_URL>`, then the provider's page. Pick the account
labelled Professional.

Voice-over: "On the sign-in page, I pick the Professional account. The demo provider does
not check passwords. It is a demo only."

### 00:45 to 01:10 (25 s): Professional home and appointment

On screen: the home page with the role badge and the "What you can do" text. Open the
Appointments list, then open the Scheduled appointment.

Voice-over: "The professional sees the appointments where the professional takes part. The
appointment page shows the video panel and the chat."

### 01:10 to 01:35 (25 s): Start the video meeting

On screen: press "Start video meeting". The Jitsi room loads inside the page.

Voice-over: "The server creates the meeting and the page embeds the room. The demo uses a
self-hosted Jitsi server. A real audio and video call between two people has not been
verified."

### 01:35 to 01:55 (20 s): Chat

On screen: type a short synthetic message and send it. It appears in the chat log with
the status "Connected."

Voice-over: "Each appointment has one chat between its professional and its client. The
chat is open only while the appointment is scheduled."

### 01:55 to 02:15 (20 s): Client account

On screen: sign out. Sign in with the account labelled Client. Open the same appointment.

Voice-over: "The client sees their own appointments and records, and can chat. The video
panel says that the professional starts the meeting. Access is denied by default, and
each request is checked for its role and for the record."

### 02:15 to 02:35 (20 s): Auditor account

On screen: sign out. Sign in with the account labelled Auditor. Open the Audit log. Set
Outcome to Denied and apply the filter.

Voice-over: "The auditor reads the audit log of the center. Each entry records who did what,
and its outcome. An entry that was refused shows a reason code. The log holds no clinical
text."

### 02:35 to 02:50 (15 s): How Kiro was used

On screen: the `.kiro/specs/` folder, then `docs/HOW-WE-USED-KIRO.md`, at the section
"Not verified".

Voice-over: "Kiro agents did the implementation work. From K-06 on, each task began with a
written specification. A director agent checked each task, under a person's supervision,
on a Debian virtual machine. The document lists what failed and what is not verified."

### 02:50 to 02:55 (5 s): Close

On screen: the "Declared out of scope" list in `docs/SUBMISSION.md`.

Voice-over: "Google Meet is simulated in this demo, and the real two-person call has not
been verified."

## Total

| Segment | Length |
| --- | --- |
| Title | 10 s |
| The idea | 15 s |
| Sign in | 20 s |
| Professional home and appointment | 25 s |
| Start the video meeting | 25 s |
| Chat | 20 s |
| Client account | 20 s |
| Auditor account | 20 s |
| How Kiro was used | 15 s |
| Close | 5 s |
| **Total** | **175 s** |
