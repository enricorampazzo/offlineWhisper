function formatSRTTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function toSRT(chunks) {
    return chunks
        .filter(chunk => chunk.timestamp[0] !== null)
        .map((chunk, i) => {
            const start = formatSRTTime(chunk.timestamp[0]);
            const end = formatSRTTime(chunk.timestamp[1] ?? chunk.timestamp[0] + 2);
            return `${i + 1}\n${start} --> ${end}\n${chunk.text.trim()}\n`;
        })
        .join('\n');
}

function srtToPlainText(srt) {
    return srt
        .split('\n')
        .filter(line => !line.match(/^\d+$/) && !line.match(/\d{2}:\d{2}:\d{2},\d{3}/))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export { toSRT, srtToPlainText };
