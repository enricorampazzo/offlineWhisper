function toICSDate(date, time) {
    // date: dd/mm/yyyy, time: HH:MM — both may be empty
    if (!date) return null;
    const [day, month, year] = date.split('/');
    if (!day || !month || !year) return null;
    const datePart = `${year}${month.padStart(2, '0')}${day.padStart(2, '0')}`;
    if (!time) return datePart; // all-day event
    const [hours, minutes] = time.split(':');
    return `${datePart}T${hours.padStart(2, '0')}${minutes.padStart(2, '0')}00`;
}

function todayAsICSDate() {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

function downloadICS(description, date, time, people, location) {
    const effectiveDate = date || todayAsICSDate();
    const dtstart = toICSDate(effectiveDate, time);
    if (!dtstart) return;

    const isAllDay = !time;
    const dtend = isAllDay
        ? dtstart  // all-day: same day
        : toICSDate(date, incrementHour(time)); // default 1h duration

    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        `SUMMARY:${description}`,
        isAllDay ? `DTSTART;VALUE=DATE:${dtstart}` : `DTSTART:${dtstart}`,
        isAllDay ? `DTEND;VALUE=DATE:${dtend}` : `DTEND:${dtend}`,
    ];
    if (location) lines.push(`LOCATION:${location}`);
    if (people)   lines.push(`DESCRIPTION:${people}`);
    lines.push('END:VEVENT', 'END:VCALENDAR');

    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${description.replace(/[^a-z0-9]/gi, '_')}.ics`;
    a.click();
    URL.revokeObjectURL(url);
}

function incrementHour(time) {
    const [h, m] = time.split(':').map(Number);
    const next = (h + 1) % 24;
    return `${String(next).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export { downloadICS };
