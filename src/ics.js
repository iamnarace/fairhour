// iCalendar (RFC 5545) export. Each meeting is its own event because a fair
// rotation doesn't fit a single repeating rule.

function pad(n) {
  return String(n).padStart(2, "0");
}

/** 20261027T220000Z */
export function icsDate(ms) {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Escape TEXT values: backslash, semicolon, comma and newlines. */
export function escapeText(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold a content line at 75 octets without splitting a UTF-8 character. */
export function foldLine(line) {
  const encoder = new TextEncoder();
  const out = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const bytes = encoder.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (size + bytes > limit) {
      out.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += bytes;
  }
  out.push(current);
  return out.join("\r\n ");
}

/**
 * @param {{ title: string, description?: (i: number) => string, events: { startMs: number, endMs: number }[],
 *           uidPrefix: string, now?: number }} options
 */
export function buildCalendar({ title, description, events, uidPrefix, now = Date.now() }) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//fairhour//fair meeting rotation//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  events.forEach((event, i) => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uidPrefix}-${i + 1}@fairhour`,
      `DTSTAMP:${icsDate(now)}`,
      `DTSTART:${icsDate(event.startMs)}`,
      `DTEND:${icsDate(event.endMs)}`,
      `SUMMARY:${escapeText(`${title} (${i + 1} of ${events.length})`)}`,
    );
    if (description) lines.push(`DESCRIPTION:${escapeText(description(i))}`);
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
