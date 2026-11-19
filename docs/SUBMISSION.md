# doctor7-onprem: submission text

## Project

**Name:** doctor7-onprem

**Category:** Frankenstein

**One line:** A psychological care platform that a clinic runs on its own Debian server,
with Apache and MariaDB and without containers.

## Summary

doctor7-onprem rebuilds the hosted Doctor7 service for on-premise use. A clinic runs it
on its own server. The server uses Debian, Apache as the web server, and MariaDB as the
database. No container runtime is used.

- Professionals schedule appointments, start the video meeting of an appointment, write
  consultation notes, and chat with their client.
- Clients see their own appointments and consultation records, join the video meeting that
  their professional started, and chat with their professional.
- Administrators see every appointment of their center and schedule new ones.
- Auditors read the audit log of their center. The log records who did what and holds no
  clinical text.

Video consultations use Google Meet or Jitsi. The clinic picks the provider in the
configuration. When a Meet meeting fails, the API creates the meeting in Jitsi and reports
which provider was used.

The project is a Frankenstein of parts that were stitched together: a hosted service
rebuilt for a server it did not run on, two video providers behind one interface, and a
self-hosted Jitsi server that the clinic runs itself.

## Built with

Node.js 22 for the API, React with Vite for the web client, Apache 2.4, MariaDB, Debian
packages with systemd units, OpenID Connect for sign-in, Jitsi, the Google Meet API through
a service account, and Kiro.

## How we used Kiro

Kiro CLI agents built the project. 34 tasks were given to Kiro agents: K-01 to K-34 except K-15 (an internal document kept outside this repository), plus K-19b, a follow-up to K-19. Each task
had a written contract and its own branch. From K-06 on, every task began with a specification in `.kiro/specs/<task>/`, except K-11, K-19b, K-25, and K-27, which have none. The specifications in `.kiro/specs/` are for k-06, k-07, k-08, k-09, k-10, k-12, k-13, k-14, k-16, k-17, k-18, k-19, k-20, k-21, k-22, k-23, k-24, k-26, k-28, k-29, k-30, k-31, k-32, k-33, and k-34. There is no folder for K-11, K-15, K-25, and K-27. The repository has steering files in `.kiro/steering/` and
two hook files in `.kiro/hooks/`. The hooks have not been tested in the Kiro IDE.

A director agent, supervised by a person, reviewed each task. Before each pull request it ran
the tests on a Debian 13 virtual machine with MariaDB 11.8, ran the real processes, and built
the packages. It also carried out the deployments.

`docs/HOW-WE-USED-KIRO.md` lists the agents, the models, the specifications, what failed
and how it was corrected, and what was not verified.

## How to try it

1. Open `https://3-139-52-25.sslip.io`. The demo is an instance with synthetic data and demonstration
   accounts.
2. On the sign-in page, pick the account for the role you want to see. There are four roles:
   - **Professional.** Sees the appointments where the professional takes part, creates
     appointments, starts video meetings, writes consultation notes, and chats with the
     client.
   - **Client.** Sees their own appointments and consultation records, joins the video meeting
     that the professional started, and chats with the professional. Until the professional
     starts the meeting, the video panel says so and asks again every 15 seconds.
   - **Administrator.** Sees every appointment of the center and creates new ones. This role
     has no chat and does not start video meetings.
   - **Auditor.** Reads the audit log of the center. This role has no access to appointments
     or consultations.

   Two more accounts, marked "No access", show a refused sign-in.
3. Create or open an appointment.
   - As the Professional, select **New appointment** in the navigation, then **Create appointment**.
     The professional ID is filled in. For the client ID, copy the client ID shown in the details
     of an existing appointment. Enter a date and the start and end times. Times are in Bogota
     time (America/Bogota). Or open an existing appointment whose status is Scheduled.
   - As the Administrator, use the same form. Copy both IDs from an existing appointment.
4. Start the video call. As the Professional, open a scheduled appointment and select
   **Start video meeting**. The demo places the self-hosted Jitsi room in the page. The video frame has not been checked on the deployed demo with the K-29 room names. A meeting
   on Google Meet would open in a new browser tab. The server stores the meeting with the
   appointment, so the Client can enter the same room: open a second window or a private
   window, sign in as the Client with the demonstration account, and open the same
   appointment. The video panel shows the room that the Professional started. If the
   Professional has not started it yet, the panel says so and asks again every 15 seconds. A
   real audio and video call between two participants has not been verified.
5. Send a chat message. As the Professional or the Client, open a scheduled appointment, type
   in the chat, and select **Send message**. The chat is closed for appointments that are not
   scheduled.
6. Read the audit log. Sign in as the Auditor and open **Audit log**. Each entry shows the
   time, the actor, the action, the target, the outcome, and a reason code when one applies.

**Sign-in limit.** The sign-in routes allow 20 requests per client IP address every 15 minutes.
A complete sign-in uses two of them, the login request and the callback, so one window fits
10 complete sign-ins. A request over the limit gets `429` with the code `rate_limited`. Sign-in
works again after the 15 minutes pass. People who try the demo from one network share this
limit. The demo identity provider also has its own per-minute limits (`docs/DEMO.md`).

## What is verified and what is not

- Verified on a Debian 13 virtual machine: the entry page of the Jitsi meeting room, with its
  «Join meeting» button, loads over HTTPS. Four services are active, and the API creates a
  meeting (HTTP 201) and places its address in an iframe. The content of that iframe was not
  checked on the VM (`docs/DEMO.md`, Node 3).
- Not verified: a real audio and video call between two participants.
- Not verified: Google Meet. The demo uses a simulator, not the real service.

## Declared out of scope

This section lists what the project does not do, and what the demo replaces with a simulation.

- **Identity provider.** The demo uses a mock provider with demonstration accounts. It does not
  check passwords. A clinic uses its own OpenID Connect provider.
- **Google Meet.** The demo uses a Google simulator, not the real service.
- **Email and file attachments.** Neither is built. The demo has no email and no file
  attachments.
- **WhatsApp.** Not built.
- **Real federation.** Not built.
- **Mass provisioning** of accounts and centers. Not built.
- **Hardening of external access** beyond the defaults in `docs/SECURITY.md`.
- **Load.** No capacity figures are claimed. The repository holds one light load script.
- **Replication.** Not built.
- **Three separate nodes.** The site, the API, and the video server on three separate
  machines are not tested as one layout.
- **Real migration from a cloud installation.** The loader reads a JSON export. The real
  exporter is not in the repository (`docs/MIGRATION.md`).
- **Real audio and video call** between two participants. Not verified.

## License

Apache License 2.0.
