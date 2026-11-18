import { loadModel, isModelCached, transcribe, MODEL_ID } from './transformer.js';
import { fileTypeFromBlob } from 'https://esm.sh/file-type@19';

function showFilePicker() {
    document.getElementById('file-picker').classList.remove('d-none');

    document.getElementById('audio-file').addEventListener('change', (e) => {
        const hasFile = e.target.files.length > 0;
        document.getElementById('transcribe-btn').classList.toggle('d-none', !hasFile);
        document.getElementById('download-btn').classList.add('d-none');
    });

    document.getElementById('transcribe-btn').addEventListener('click', inspect);
}

async function inspect() {
    const file = document.getElementById('audio-file').files[0];
    if (!file) return;

    const type = await fileTypeFromBlob(file);

    if (type?.mime.startsWith('video/')) {
        return extractAudioTrack(file);
    }

    // audio/*, or unknown (let transcribe handle it)
    return onTranscribe(file);
}

async function extractAudioTrack(file) {
    const transcribeBtn = document.getElementById('transcribe-btn');
    transcribeBtn.disabled = true;
    transcribeBtn.textContent = 'Extracting audio...';

    const { FFmpeg } = await import('./lib/ffmpeg/index.js');
    const { fetchFile } = await import('https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js');

    const ffmpeg = new FFmpeg();
    await ffmpeg.load({
        coreURL: new URL('./lib/ffmpeg/ffmpeg-core.js', import.meta.url).href,
        wasmURL: new URL('./lib/ffmpeg/ffmpeg-core.wasm', import.meta.url).href,
    });

    const ext = file.name.substring(file.name.lastIndexOf('.'));
    const inputName = 'input' + ext;
    await ffmpeg.writeFile(inputName, await fetchFile(file));
    await ffmpeg.exec(['-i', inputName, '-vn', '-acodec', 'libmp3lame', '-q:a', '2', 'output.mp3']);

    const data = await ffmpeg.readFile('output.mp3');
    const mp3File = new File([data], file.name.replace(/\.[^.]+$/, '.mp3'), { type: 'audio/mpeg' });

    await onTranscribe(mp3File);
}

async function onTranscribe(file) {
    if (!file) {
        file = document.getElementById('audio-file').files[0];
    }
    if (!file) return;

    const transcribeBtn = document.getElementById('transcribe-btn');
    const downloadBtn = document.getElementById('download-btn');

    transcribeBtn.disabled = true;
    transcribeBtn.textContent = 'Transcribing...';

    const blobUrl = URL.createObjectURL(file);
    const srt = await transcribe(blobUrl);
    URL.revokeObjectURL(blobUrl);

    const blob = new Blob([srt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const filename = file.name.replace(/\.[^.]+$/, '-transcription.txt');

    downloadBtn.href = url;
    downloadBtn.download = filename;
    downloadBtn.classList.remove('d-none');

    transcribeBtn.disabled = false;
    transcribeBtn.textContent = 'Transcribe';
}

async function setup() {
    const cached = await isModelCached();

    if (!cached) {
        document.getElementById('model-download').classList.remove('d-none');
    }

    document.getElementById('model-loading-text').textContent = `Loading ${MODEL_ID}, please wait...`;
    document.getElementById('model-loading').classList.remove('d-none');
    const model = await loadModel();
    document.getElementById('model-loading').classList.add('d-none');
    document.getElementById('model-download').classList.add('d-none');
    document.getElementById('offline-ready').classList.remove('d-none');

    const minimize = (el) => {
        el.classList.add('d-none');
        const checkmark = document.createElement('span');
        checkmark.textContent = '✅';
        checkmark.title = 'Click to expand';
        checkmark.style.cursor = 'pointer';
        checkmark.style.fontSize = '1.25rem';
        el.parentNode.insertBefore(checkmark, el);
        checkmark.addEventListener('click', () => {
            checkmark.remove();
            el.classList.remove('d-none');
        }, { once: true });
    };

    ['offline-ready', 'device-notice'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('click', (e) => {
            if (e.target.closest('.btn-close')) {
                return;
            }
            if (!el.classList.contains('d-none')) {
                minimize(el);
            }
        });
    });

    setTimeout(() => {
        ['offline-ready', 'device-notice'].forEach(id => {
            const el = document.getElementById(id);
            if (!el || el.classList.contains('d-none')) {
                return;
            }
            minimize(el);
        });
    }, 5000);

    const notice = document.getElementById('device-notice');
    const noticeText = document.getElementById('device-notice-text');
    if (model.device === 'webgpu') {
        notice.classList.add('alert-success');
        noticeText.textContent = 'Good news — transcription will use your GPU for better performance.';
    } else {
        notice.classList.add('alert-warning');
        noticeText.textContent = 'Transcription might take a while on this device.';
    }
    notice.classList.remove('d-none');

    showFilePicker();
}

document.addEventListener('DOMContentLoaded', setup);
