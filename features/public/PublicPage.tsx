import { indiaYear as yearInIndia } from "@/lib/format/date";
import { BrandLockup } from "@/features/ui/Brand";
import Link from "next/link";
import { MailLink } from "@/features/ui/MailLink";

// v1.12.2 (D-161): the public pages (home, privacy policy, terms) that
// Google's OAuth verification needs: reachable without signing in, on the
// app's own domain, each linking to the others.
export const CONTACT_EMAIL = "itadmin@arssteels.co.in";
export const COMPANY = "ARS Steels & Alloy International Pvt. Ltd.";

export const indiaYear = () => yearInIndia(new Date());

export function PublicPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-page">
      {/* v1.89.0 (D-421, UIQA-LAY-02): the shell's header height and page padding; the reading width for the text. */}
      <header className="h-topbar border-b border-line bg-surface">
        <div className="mx-auto flex h-full max-w-reading items-center justify-between gap-4 px-page">
          {/* D-198: the app's name next to the company logo, so Google's review
              matches it to the consent screen's app name (Nov 2026: "ARS CMS";
              the Google Cloud consent screen must use the same name). */}
          <Link href="/" className="flex min-w-0 items-center gap-3 rounded-md">
            <span className="sr-only">ARS Steels</span>
            <BrandLockup size="md" />
          </Link>
          <Link href="/login" className="btn-primary btn-compact">
            Sign in
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-reading flex-1 px-page pb-10 pt-page">
        {children}
      </main>
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-reading flex-wrap items-center justify-between gap-3 px-page py-4 text-caption text-ink-muted">
          <p>
            © {indiaYear()} {COMPANY}
          </p>
          <nav aria-label="Legal" className="flex flex-wrap gap-4">
            <Link href="/" className="link">
              Home
            </Link>
            <Link href="/privacy" className="link">
              Privacy policy
            </Link>
            <Link href="/terms" className="link">
              Terms of use
            </Link>
            <MailLink address={CONTACT_EMAIL} />
          </nav>
        </div>
      </footer>
    </div>
  );
}

// Headings and paragraphs for the policy pages.
export function Prose({ children }: { children: React.ReactNode }) {
  return <article className="space-y-4 text-body leading-relaxed [&_h1]:text-page-title [&_h2]:pt-4 [&_h2]:text-section [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1 [&_code]:break-all [&_a]:break-words">{children}</article>;
}
