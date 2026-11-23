import { greetingFor, greetingName, homeDate } from "@/server/home/widgets";

// v1.63.0 (D-369, PM-A12, spec HOME_MODULE §3.1.1, BR-HOME-002): today's date
// and "Good morning / afternoon / evening, <name>" by the hour in India.
export function HomeGreeting({ name, detail, now = new Date() }: { name: string; detail?: string | null; now?: Date }) {
  return (
    <div data-testid="home-greeting">
      <p className="text-label text-ink-muted">
        <span className="sr-only">Today is </span>
        {homeDate(now)}
      </p>
      <p className="text-page-title leading-tight tracking-tight">
        {greetingFor(now)}, {greetingName(name)}
      </p>
      {detail && <p className="text-label text-ink-muted">{detail}</p>}
    </div>
  );
}
