import type { Metadata } from "next";
import { APP_BRANDING } from "@/lib/branding";
import Link from "next/link";
import { PublicPage, Prose, COMPANY, CONTACT_EMAIL } from "@/features/public/PublicPage";
import { MailLink } from "@/features/ui/MailLink";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "Terms for using ARS CMS, the internal approval, task and information platform of ARS.",
  robots: { index: true, follow: true },
  alternates: { canonical: "/terms" },
  openGraph: { type: "website", siteName: "ARS CMS", url: "/terms", title: "Terms of use · ARS CMS", description: "Terms for using ARS CMS, the internal platform of ARS.", images: [{ url: APP_BRANDING.ogImage, width: 1200, height: 630, alt: APP_BRANDING.logoAlt }] },
};

// v1.12.2 (D-161): terms of use, linked from the home page and the Google
// OAuth consent screen. An internal tool's terms: who may use it and how.
export default function TermsPage() {
  return (
    <PublicPage>
      <Prose>
        <h1>Terms of use</h1>
        <p className="text-label text-ink-muted">Effective 25 November 2026 · approved by the head of IT, 2 November 2026</p>
        <p>
          ARS CMS (approval.arssteels.net) is provided by {COMPANY} (&ldquo;ARS&rdquo;) for its employees to carry out company work. By signing in you agree to these terms and to ARS&apos;s
          policies that apply to company systems.
        </p>
        <h2>Who may use it</h2>
        <p>Only people with an account created by ARS&apos;s IT team. Accounts are personal: don&apos;t share your sign-in or let others act under your name.</p>
        <h2>Using it properly</h2>
        <ul>
          <li>Use it for genuine company work, and enter accurate information.</li>
          <li>Approve, decide or acknowledge only what you have actually reviewed. Your decisions are recorded under your name.</li>
          <li>
            Approving several requests at once on Waiting for me is your own decision for each of them: tick only requests you have reviewed. Each is recorded under your name as if you had approved
            it on its own.
          </li>
          <li>
            As the approver a request is waiting on, change its details or the levels after yours only when the change is right for the company, and say why. The change, its reason and your name are
            recorded, and the requester and earlier approvers are told.
          </li>
          <li>
            Nobody approves, passes on, holds or otherwise moves an approval of a request they raised, including as someone&apos;s out-of-office delegate or as a member of the IT team: another person
            does it. Only the Super Admin removes the IT Admin role from another IT Admin.
          </li>
          <li>Don&apos;t try to access records you aren&apos;t given, get around security, or disrupt the service.</li>
          <li>
            Backups and moving the system (the Super Admin only): a full backup holds every record, file and server key, so treat the file and its passphrase like the keys to the whole system.
            Choose a strong passphrase, keep it apart from the file (ARS can&apos;t recover a lost one), keep downloaded copies only on ARS-controlled storage, and delete copies you no longer need.
            Restore only after checking the package, and only when the restore is genuinely needed: it puts back the records as they were at the backup&apos;s time for everyone and signs everyone
            out. Move the system only to servers ARS controls: give a pairing code only to the person setting up the other ARS server, withdraw codes you no longer need, and copy a database
            into another only after checking its name, because everything in it is replaced. Never load data with the hosting provider&apos;s database import tool, which deletes every table first.
          </li>
          <li>Tasks, projects, comments, mentions and notices are work records: keep them to work, and mention or add people only where they need to know.</li>
          <li>Deleting a task or project is undone with Undo or restored from Deleted within 30 days. After 30 days it is removed for good and can&apos;t be brought back, so restore anything you still need in time.</li>
          <li>Reactions on comments are seen by everyone who can see the comment: use them as you would any work message. Your stars and sidebar order are yours alone.</li>
          <li>A project&apos;s tabs and saved views are shared with everyone in the project. Only its owners and editors add, rename, reorder, remove or save them; change them with care.</li>
          <li>Custom fields: a field added to the ARS field library is seen by every project that uses it, and changes to it show everywhere; deleting a field removes its values for good after 30 days. Choose people in a People field, or start a timer, only for real work on the task.</li>
          <li>Dependencies: when a project moves dependent tasks with their task (Project settings → Dependencies), changing a date can move other people&apos;s tasks in that project too; they are told, and you can Undo for 15 minutes. Change dates with care. Status updates go to the project&apos;s members and anyone you add: add only people who should see them.</li>
          <li>
            Project forms: only a project&apos;s owners and editors (or only its owners, if the project says so) build its forms, and they choose who may submit. Build forms for genuine work
            requests, ask only for what you need, and don&apos;t ask for passwords or other people&apos;s personal details. When you fill in a form, your name and email go with your answers, and the
            task made from it is seen by the project&apos;s people: answer as you would in any work message.
          </li>
          <li>
            Project dashboards and Workload: only a project&apos;s owners and editors change its widgets and its people&apos;s capacity, and everyone in the project sees them (text widgets too, so
            write them as you would any work message). Charts and Workload count only the tasks the viewer may see. Capacity and Workload are planning aids for sharing work fairly, not a
            measure of anyone&apos;s performance.
          </li>
          <li>
            Project automations: only a project&apos;s owners and editors (or only its owners, if the project says so) build its automations. An automation acts on other people&apos;s tasks
            on its owner&apos;s behalf, with the owner&apos;s rights (never more): its changes, comments and messages are recorded as &ldquo;ARS-CMS Automation&rdquo; for the rule, and its owner is
            responsible for what it does. Build rules for genuine work, check them before publishing, and switch off or fix a rule that misbehaves. If its owner can no longer edit the project
            the rule stops until someone becomes its owner. Saving or publishing someone else&apos;s rule makes you its owner (they are told), so you answer for it from then on. A rule&apos;s webhook secret is a password for that rule: give it only to the system that needs it, never put it in a link or message, and
            make a new one if it may have been seen. Web requests must carry only the work data the rule needs.
          </li>
          <li>
            Portfolios: a portfolio&apos;s owners decide who can see it and who may change it; its owners and editors add and remove work and post its status updates. Being in a portfolio never
            gives access to its projects: ask a project&apos;s owner for access instead of working around it. Add only work that belongs together, and keep status updates factual, as for projects.
          </li>
          <li>
            Templates, copies, import and export: a template or copy can give tasks to other people, who are told; give work only to people who should do it. An organisation template is chosen by IT. Import only files you are allowed to put in the app, and keep exported files as carefully as the app keeps the data.
            Calendar addresses are personal: anyone who has yours can read the task names and dates in it, so don&apos;t share or post it; stop it (or make a new one) if it may have been seen by someone else.
          </li>
          <li>
            Sharing your Task Summary: share it only with people who need to follow your work, and remove them when they no longer do. They see it read-only and only the tasks they may already
            see; your managers in the reporting line can always open it. Opening someone else&apos;s Task Summary is for following their work, not for copying or passing on what you see there.
          </li>
          <li>
            Asking for someone&apos;s Task Summary: ask only when you have a work reason, and accept a refusal. Your Task Summary notes are private to you: don&apos;t keep passwords, card
            numbers or other people&apos;s personal data in them.
          </li>
          <li>
            Project messages and pages are read by everyone on the project: write them as you would a work email, attach only files you may share with all of them, and @mention only people who should be told. Edits and deletions keep every earlier version, and a page keeps its last 50 versions.
            Log time honestly against the task it was spent on; the project&apos;s owners and editors (and IT) can correct anyone&apos;s entries, and every change is recorded.
          </li>
          <li>The private notepad on Home is for your work notes. Only you see it in the app, but it is stored with your other records: don&apos;t keep passwords or other people&apos;s personal details in it.</li>
          <li>You can edit or delete your own comments, and IT can edit or delete any comment. Every earlier version is kept and shown to the people who can see the comment, so edit to correct, not to rewrite what was agreed.</li>
          <li>
            Meetings: the Coordinator records the points, attendance and minutes accurately, and the Meeting Owner approves them only after reading them. Approved minutes are shared with the
            participants and their action items become tasks for the people named.
          </li>
          <li>Your profile photo and About me are seen by colleagues: keep them suitable for work.</li>
          <li>
            On a phone, a tablet or the installed app you stay signed in until midnight: keep the device locked, sign out on a shared device, and remove a device you no longer use from Profile &rarr;
            App &amp; devices.
          </li>
          <li>IT&apos;s notifications to staff (Admin &rarr; Notifications) are for work notices only, sent to the people who need them; important alerts only for what is urgent.</li>
        </ul>
        <h2>AI Assistant</h2>
        <p>
          If IT gives you the AI Assistant (Pico Bot), use it for work questions. It reads the data you may see and sends your question to an external AI provider, as described in the{" "}
          <Link href="/privacy" className="link">privacy policy</Link>. Its answers can be wrong: check figures before you rely on them or pass them on. Don&apos;t paste passwords, keys or
          other people&apos;s personal details into it. It never approves, sends or changes anything; you remain responsible for your decisions.
        </p>
        <h2>Google Calendar</h2>
        <p>
          Connecting your Google Calendar is optional. You can disconnect it at any time from Profile → Calendar. A calendar event never approves, completes or acknowledges anything in ARS CMS:
          those actions are taken only in the app. How Google data is handled is described in the <Link href="/privacy" className="link">privacy policy</Link>.
        </p>
        <h2>Records and monitoring</h2>
        <p>Work records and an audit log of actions are kept as company records and may be reviewed by authorised ARS staff, as described in the privacy policy.</p>
        <p>
          The emergency (break-glass) account may sign in with its password alone, without the WhatsApp code, only while IT has opened its emergency window from the server. Every such sign-in is
          recorded and the Super Admins are told at once.
        </p>
        <h2>Availability and changes</h2>
        <p>ARS may change, suspend or end the service, or these terms, at any time. The current terms are always on this page.</p>
        <h2>Contact</h2>
        <p>
          Questions: the IT team at <MailLink address={CONTACT_EMAIL} />.
        </p>
      </Prose>
    </PublicPage>
  );
}
