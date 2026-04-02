const TIMEZONE = 'Australia/Sydney';

function getCurrentTimestamp() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-AU', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'long',
  });

  const parts = formatter.formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value;

  return `${get('year')}-${get('month')}-${get('day')} ${get('weekday')} ${get('hour')}:${get('minute')} AEST (Sydney)`;
}

function getTimeInjection() {
  return `[Current time: ${getCurrentTimestamp()}]`;
}

module.exports = { getCurrentTimestamp, getTimeInjection };
