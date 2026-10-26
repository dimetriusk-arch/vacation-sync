import { addDaysISO } from './overlaps.js';

function escapeICS(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function toICSDate(iso) {
  return iso.replace(/-/g, '');
}

function icsNow() {
  return new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function describePeriod(p, personName) {
  const lines = [];
  if (personName) lines.push(`Кто: ${personName}`);
  if (p.notes) lines.push(p.notes);
  if (p.plans?.length) {
    lines.push('Планы:');
    for (const pl of p.plans) lines.push(`- ${pl.date ? pl.date + ': ' : ''}${pl.title}${pl.note ? ' (' + pl.note + ')' : ''}`);
  }
  return lines.join('\n');
}

export function buildICS(periods, people) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//VacSync//RU', 'CALSCALE:GREGORIAN'];
  for (const p of periods) {
    const person = people[p.personId];
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + p.id + '@vacsync');
    lines.push('DTSTAMP:' + icsNow());
    lines.push('DTSTART;VALUE=DATE:' + toICSDate(p.start));
    lines.push('DTEND;VALUE=DATE:' + toICSDate(addDaysISO(p.end, 1)));
    lines.push('SUMMARY:' + escapeICS(`${p.title}${person ? ' — ' + person.name : ''}`));
    const desc = describePeriod(p, person?.name);
    if (desc) lines.push('DESCRIPTION:' + escapeICS(desc));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function downloadICS(filename, content) {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export { describePeriod };
