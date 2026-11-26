import { describe, expect, it } from "vitest";
import nodemailer from "nodemailer";
import nodemailerPackage from "nodemailer/package.json";
import { EmailSendError } from "@/server/integrations/resend/client";
import { sendSmtpEmail, sendmailTransport, smtpTransport, type SmtpSender } from "@/server/integrations/email/smtp";

// v1.92.1 (TD-016, D-442): nodemailer 6.9.16 → 10.6.1 (HIGH advisories: SMTP
// command injection, addressparser DoS, …). These checks run the app's mail code
// on the new major with nodemailer's own stream transport (no network, nothing is
// sent) and pin the GoDaddy relay settings, so the upgrade can't change them.

const from = { name: "ARS CMS", address: "no_reply@cms.arssteels.net", replyTo: "itadmin@arssteels.co.in" };
const streamSender = () => nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" }) as unknown as SmtpSender;
const optionsOf = (sender: SmtpSender) => (sender as unknown as { options: Record<string, unknown> }).options;

describe("nodemailer version (v1.92.1)", () => {
  it("is a release with the fixes (10.1.4 or later)", () => {
    const [major, minor, patch] = String((nodemailerPackage as { version?: string }).version).split(".").map(Number);
    expect(major! > 10 || (major === 10 && (minor! > 1 || (minor === 1 && patch! >= 4)))).toBe(true);
  });
});

describe("transport settings on nodemailer 10", () => {
  it("RELAY (GoDaddy relay-hosting.secureserver.net:25): plain, no STARTTLS, no sign-in", () => {
    const options = optionsOf(smtpTransport({ host: "relay-hosting.secureserver.net", port: 25, security: "RELAY", user: "no_reply@cms.arssteels.net", password: "unused" }, 9_000));
    expect(options).toMatchObject({ host: "relay-hosting.secureserver.net", port: 25, secure: false, ignoreTLS: true, connectionTimeout: 9_000, greetingTimeout: 9_000, socketTimeout: 9_000 });
    expect(options.auth).toBeUndefined();
    expect(options.requireTLS).toBeUndefined();
  });

  it("RELAY connects through connectHost when one is set", () => {
    expect(optionsOf(smtpTransport({ host: "relay-hosting.secureserver.net", port: 25, security: "RELAY", user: "", password: "", connectHost: " 127.0.0.1 " })).host).toBe("127.0.0.1");
  });

  it("SSL and STARTTLS sign in and check the certificate against the real host name", () => {
    const ssl = optionsOf(smtpTransport({ host: "mail.example.test", port: 465, security: "SSL", user: "box@example.test", password: "test-only", connectHost: "127.0.0.1" }));
    expect(ssl).toMatchObject({ host: "127.0.0.1", port: 465, secure: true, requireTLS: false, tls: { servername: "mail.example.test", minVersion: "TLSv1.2" } });
    expect(ssl.auth).toEqual({ user: "box@example.test", pass: "test-only" });
    const starttls = optionsOf(smtpTransport({ host: "mail.example.test", port: 587, security: "STARTTLS", user: "box@example.test", password: "test-only" }));
    expect(starttls).toMatchObject({ secure: false, requireTLS: true });
  });

  it("the sendmail transport keeps the path and Unix line endings", () => {
    const transport = sendmailTransport("/usr/sbin/sendmail") as unknown as { transporter: { path: string; winbreak: boolean } };
    expect(transport.transporter.path).toBe("/usr/sbin/sendmail");
    expect(transport.transporter.winbreak).toBe(false);
  });
});

describe("the message the app builds (stream transport, nothing sent)", () => {
  it("goes through nodemailer 10 and returns its message id", async () => {
    const result = await sendSmtpEmail(from, { to: "someone@example.test", subject: "Approval\r\nBcc: evil@example.test", text: "Hello", html: "<p>Hello</p>", idempotencyKey: "ref-1\r\nX-Evil: 1" }, streamSender());
    expect(result.id).toMatch(/^<.+>$/);
  });

  it("puts no injected header in the source", async () => {
    let source = "";
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
    const sender: SmtpSender = {
      async sendMail(message) {
        const info = await transport.sendMail(message as Parameters<typeof transport.sendMail>[0]);
        source = String((info as unknown as { message: Buffer }).message);
        expect((info as unknown as { envelope: { from: string; to: string[] } }).envelope).toEqual({ from: "no_reply@cms.arssteels.net", to: ["someone@example.test"] });
        return info as { messageId?: string };
      },
    };
    await sendSmtpEmail({ ...from, name: "ARS\r\nBcc: evil@example.test" }, { to: "someone@example.test", subject: "Approval\r\nBcc: evil@example.test", text: "Hello", idempotencyKey: "ref-1\r\nX-Evil: 1", attachments: [{ filename: "../a b.pdf", content: new Uint8Array([1, 2, 3]) }] }, sender);
    const headers = source.split("\n\n")[0]!;
    expect(headers).toMatch(/^From: "ARS Bcc: evil@example.test" <no_reply@cms.arssteels.net>$/m);
    expect(headers).toMatch(/^Reply-To: itadmin@arssteels.co.in$/m);
    expect(headers).toMatch(/^To: someone@example.test$/m);
    expect(headers).toMatch(/^Subject: Approval Bcc: evil@example.test$/m);
    expect(headers).toMatch(/^X-ARS-Reference: ref-1 X-Evil: 1$/im);
    expect(headers).not.toMatch(/^Bcc:/m);
    expect(headers).not.toMatch(/^X-Evil:/im);
    expect(source).toContain('filename=.._a_b.pdf');
  });
});

describe("error mapping is unchanged on nodemailer 10", () => {
  const failing = (error: unknown): SmtpSender => ({ sendMail: async () => { throw error; } });
  const attempt = async (error: unknown): Promise<EmailSendError> => {
    try {
      await sendSmtpEmail(from, { to: "someone@example.test", subject: "S", text: "T" }, failing(error));
    } catch (caught) {
      return caught as EmailSendError;
    }
    throw new Error("expected the send to fail");
  };

  it("wrong sign-in (EAUTH / 535) → EMAIL_NOT_CONFIGURED, without the password", async () => {
    const caught = await attempt(Object.assign(new Error("Invalid login: 535 auth failed pass=secret"), { code: "EAUTH", responseCode: 535 }));
    expect(caught).toBeInstanceOf(EmailSendError);
    expect(caught.code).toBe("EMAIL_NOT_CONFIGURED");
    expect(caught.message).not.toContain("secret");
  });

  it("4xx → EMAIL_RATE_LIMITED; 5xx → EMAIL_REJECTED", async () => {
    expect((await attempt(Object.assign(new Error("try later"), { code: "EENVELOPE", responseCode: 451 }))).code).toBe("EMAIL_RATE_LIMITED");
    expect((await attempt(Object.assign(new Error("550 relay not permitted"), { code: "EENVELOPE", responseCode: 550 }))).code).toBe("EMAIL_REJECTED");
  });

  it("a connection error keeps nodemailer's code and the network reason", async () => {
    const caught = await attempt(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:25"), { code: "ESOCKET" }));
    expect(caught.code).toBe("EMAIL_REQUEST_FAILED");
    expect(caught.message).toContain("(ESOCKET)");
    expect(caught.message).toContain("connect ECONNREFUSED 127.0.0.1:25");
  });
});
