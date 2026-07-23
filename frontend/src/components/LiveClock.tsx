import { useEffect, useState } from "react";

/** Matches the backend's default TIMEZONE (Asia/Kolkata) — the schedule this clock exists to explain runs in that zone regardless of the viewer's own. */
const ZONE = "Asia/Kolkata";

const timeFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: ZONE,
  weekday: "short",
  day: "2-digit",
  month: "short",
});

/**
 * Ticks every second so it's obvious, at a glance, how close "now" is to the
 * 12:00 PM daily send, scheduled in IST. (The sheet refresh itself now runs
 * every minute, so there's no longer a meaningful gap to watch for that one.)
 */
export default function LiveClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="live-clock" title="Asia/Kolkata (IST) — the timezone the daily schedule runs in">
      <span className="live-clock__time">{timeFormatter.format(now)}</span>
      <span className="live-clock__date">
        {dateFormatter.format(now)} &middot; IST
      </span>
    </div>
  );
}
