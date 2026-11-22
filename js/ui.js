import { loadModel, unloadWhisper, isModelCached, transcribe, getModelToLoad, MODEL_ID, MODEL_LOADING_STATE_KEY, MODEL_LAST_SUCCESS_KEY } from './transformer.js';
import { srtToPlainText } from './srt-utils.js';
import { downloadICS } from './ics-utils.js';
import { loadLLMModelWithFallback, getLLMModelToLoad, isLLMModelCached, query, LLM_MODEL_LOADING_STATE_KEY } from './llm.js';
import { fileTypeFromBlob } from 'https://esm.sh/file-type@19';
import { t, changeLanguage, currentLanguage } from './i18n.js';

function isDeviceLostError(err) {
    return err?.message?.includes('Device') && err?.message?.includes('lost');
}

function deviceLostRace() {
    let rejectFn;
    const promise = new Promise((_, reject) => { rejectFn = reject; });
    const handler = (event) => {
        if (isDeviceLostError(event.reason)) {
            event.preventDefault();
            rejectFn(event.reason);
        }
    };
    window.addEventListener('unhandledrejection', handler);
    return { promise, cleanup: () => window.removeEventListener('unhandledrejection', handler) };
}

function applyTranslations() {
    document.title = t('app_title');
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        if (key.startsWith('app_bullet_')) {
            el.innerHTML = t(key);
        } else {
            el.textContent = t(key);
        }
    });
    document.getElementById('language-select').value = currentLanguage();
}

async function extractTasks() {
    const btn = document.getElementById('extract-tasks-btn');
    const llmLoading = document.getElementById('llm-loading');
    const tasksResult = document.getElementById('tasks-result');

    btn.disabled = true;
    llmLoading.classList.remove('d-none');
    tasksResult.classList.add('d-none');

    try {
        const modelName = await getLLMModelToLoad();
        if (!modelName) {
            tasksResult.textContent = 'No compatible AI model available on this device.';
            tasksResult.classList.remove('d-none');
            return;
        }

        await unloadWhisper();

        const progressWrapper = document.getElementById('model-download');
        const progressBar = document.getElementById('download-progress-bar');
        document.getElementById('download-label').textContent = t('downloading_llm');
        progressWrapper.classList.remove('d-none');
        progressBar.classList.add('progress-bar-animated');

        await loadLLMModelWithFallback(modelName, (progress) => {
            const pct = Math.round((progress.progress ?? 0) * 100);
            progressBar.style.width = `${pct}%`;
            progressBar.textContent = `${pct}%`;
            progressBar.setAttribute('aria-valuenow', pct);
        });

        progressBar.style.width = '100%';
        progressBar.textContent = '100%';
        progressBar.classList.remove('progress-bar-animated');
        progressWrapper.classList.add('d-none');
        llmLoading.classList.add('d-none');

        const now = new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short', hour12: false });
        const deviceLost = deviceLostRace();
        let csv;
        try {
            csv = await Promise.race([
                query(
                    `Extract tasks and events from transcriptions. For each one output a single CSV line: description, date, time, people, location.
- Format dates as dd/mm/yyyy and times as HH:MM (24h).
- Resolve relative expressions (e.g. "tomorrow", "next week", "in 2 hours") using today's date and time: ${now}.
- If a field is unknown leave it empty.
- Output only CSV lines, nothing else.`,
                    srtToPlainText(lastTranscriptionText)
                ),
                deviceLost.promise,
            ]);
        } finally {
            deviceLost.cleanup();
        }
        const rows = csv.split('\n').filter(r => r.trim() && !r.toLowerCase().startsWith('description'));

        if (rows.length === 0) {
            tasksResult.textContent = t('tasks_none_found');
        } else {
            const table = document.createElement('table');
            table.className = 'table table-sm table-bordered';
            table.innerHTML = `<thead><tr>
                <th>${t('tasks_col_description')}</th><th>${t('tasks_col_date')}</th><th>${t('tasks_col_time')}</th><th>${t('tasks_col_people')}</th><th>${t('tasks_col_location')}</th><th></th>
            </tr></thead>`;
            const tbody = document.createElement('tbody');
            rows.forEach(row => {
                const [description, date, time, people, location] = row.split(',').map(c => c.trim());
                const tr = document.createElement('tr');
                tr.innerHTML = `<td>${description ?? ''}</td><td>${date ?? ''}</td><td>${time ?? ''}</td><td>${people ?? ''}</td><td>${location ?? ''}</td><td></td>`;
                const btn = document.createElement('button');
                const hasDate = !!date;
                btn.className = `btn btn-sm ${hasDate ? 'btn-outline-primary' : 'btn-outline-warning'}`;
                btn.textContent = hasDate ? t('add_to_calendar') : t('add_to_calendar_warning');
                btn.addEventListener('click', () => downloadICS(description, date, time, people, location));
                tr.lastElementChild.appendChild(btn);
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            tasksResult.innerHTML = '';
            tasksResult.appendChild(table);
        }
        tasksResult.classList.remove('d-none');
    } catch (err) {
        llmLoading.classList.add('d-none');
        document.getElementById('model-download').classList.add('d-none');
        tasksResult.textContent = `Error: ${err.message}`;
        tasksResult.classList.remove('d-none');
    } finally {
        btn.disabled = false;
    }
}

function showFilePicker(webgpuAvailable) {
    document.getElementById('file-picker').classList.remove('d-none');

    document.getElementById('audio-file').addEventListener('change', (e) => {
        const hasFile = e.target.files.length > 0;
        document.getElementById('transcribe-btn').classList.toggle('d-none', !hasFile);
        document.getElementById('download-btn').classList.add('d-none');
        document.getElementById('extract-tasks-section').classList.add('d-none');
    });

    document.getElementById('transcribe-btn').addEventListener('click', inspect);

    if (webgpuAvailable) {
        document.getElementById('extract-tasks-btn').addEventListener('click', extractTasks);
    }
}

async function inspect() {
    const file = document.getElementById('audio-file').files[0];
    if (!file) return;

    const type = await fileTypeFromBlob(file);

    if (type?.mime.startsWith('video/')) {
        return extractAudioTrack(file);
    }

    return onTranscribe(file);
}

async function extractAudioTrack(file) {
    const transcribeBtn = document.getElementById('transcribe-btn');
    transcribeBtn.disabled = true;
    transcribeBtn.textContent = t('extracting_audio');

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
    transcribeBtn.textContent = t('transcribing');

    const progressWrapper = document.getElementById('model-download');
    const progressBar = document.getElementById('download-progress-bar');

    function getAudioDuration(url) {
        return new Promise(resolve => {
            const audio = new Audio(url);
            audio.addEventListener('loadedmetadata', () => resolve(audio.duration));
            audio.addEventListener('error', () => resolve(null));
        });
    }

    function showTranscriptionProgress(url) {
        document.getElementById('download-label').textContent = t('transcribing_progress');
        progressBar.style.width = '0%';
        progressBar.textContent = '0%';
        progressBar.setAttribute('aria-valuenow', 0);
        progressBar.classList.add('progress-bar-animated');
        progressWrapper.classList.remove('d-none');

        return getAudioDuration(url);
    }

    function onChunk(totalDuration) {
        return ({ chunks }) => {
            if (!totalDuration || !chunks?.length) return;
            const processed = chunks[chunks.length - 1]?.timestamp?.[1] ?? 0;
            const pct = Math.min(100, Math.round((processed / totalDuration) * 100));
            progressBar.style.width = `${pct}%`;
            progressBar.textContent = `${pct}%`;
            progressBar.setAttribute('aria-valuenow', pct);
        };
    }

    function hideTranscriptionProgress() {
        progressBar.classList.remove('progress-bar-animated');
        progressWrapper.classList.add('d-none');
    }

    async function runTranscription(url) {
        const duration = await showTranscriptionProgress(url);
        const deviceLost = deviceLostRace();
        try {
            return await Promise.race([
                transcribe(url, null, undefined, onChunk(duration)),
                deviceLost.promise,
            ]);
        } finally {
            deviceLost.cleanup();
        }
    }

    let srt;
    const blobUrl = URL.createObjectURL(file);
    try {
        srt = await runTranscription(blobUrl);
    } catch (err) {
        if (!isDeviceLostError(err)) throw err;

        await unloadWhisper();
        const failedModel = localStorage.getItem(MODEL_LAST_SUCCESS_KEY);
        if (failedModel) localStorage.setItem(MODEL_LOADING_STATE_KEY, failedModel);

        const nextModel = await getModelToLoad();
        if (!nextModel) throw new Error(t('no_model_error'));

        document.getElementById('model-loading-text').textContent = t('switching_model', { model: nextModel });
        document.getElementById('model-loading').classList.remove('d-none');
        await loadModelWithFallback(nextModel);
        document.getElementById('model-loading').classList.add('d-none');

        srt = await runTranscription(blobUrl);
    } finally {
        hideTranscriptionProgress();
        URL.revokeObjectURL(blobUrl);
    }

    const blob = new Blob([srt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const filename = file.name.replace(/\.[^.]+$/, '-transcription.txt');

    lastTranscriptionText = srt;

    downloadBtn.href = url;
    downloadBtn.download = filename;
    downloadBtn.classList.remove('d-none');

    transcribeBtn.disabled = false;
    transcribeBtn.textContent = t('transcribe_btn');

    if (webgpuAvailable) {
        const modelToCheck = await getLLMModelToLoad();
        const cached = modelToCheck ? await isLLMModelCached(modelToCheck) : false;
        document.getElementById('extract-tasks-hint').classList.toggle('d-none', cached);
        document.getElementById('extract-tasks-section').classList.remove('d-none');
        document.getElementById('tasks-result').classList.add('d-none');
        document.getElementById('tasks-result').innerHTML = '';
    }
}

let lastTranscriptionText = null;
let webgpuAvailable = false;

const LOAD_TIMEOUT_MS = 60_000;

async function loadModelWithFallback(modelName) {
    const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), LOAD_TIMEOUT_MS)
    );

    try {
        let v =  await Promise.race([loadModel(null, modelName), timeout]);
        localStorage.removeItem(MODEL_LOADING_STATE_KEY);
        return v;
    } catch (err) {
        const isRecoverable = err.message === 'timeout' || err.message?.includes('Device') && err.message?.includes('lost');
        if (!isRecoverable) throw err;

        const nextModel = await getModelToLoad();
        if (!nextModel) throw new Error(t('no_model_error'));

        document.getElementById('model-loading-text').textContent =
            t('switching_model', { model: nextModel });
        return loadModelWithFallback(nextModel);
    }
}

async function setup() {
    let modelToLoad = await getModelToLoad();
    if (modelToLoad === null) {
        alert(t('no_model_error'));
        return;
    }
    const cached = await isModelCached(modelToLoad);

    if (!cached) {
        if (navigator.connection?.type === 'cellular') {
            await new Promise(resolve => {
                const modal = new bootstrap.Modal(document.getElementById('wifi-warning'), { keyboard: false, backdrop: 'static' });
                document.getElementById('wifi-warning-dismiss').addEventListener('click', () => {
                    modal.hide();
                    resolve();
                }, { once: true });
                modal.show();
            });
        }
        document.getElementById('model-download').classList.remove('d-none');
    }

    document.getElementById('model-loading-text').textContent = t('loading_model', { model: modelToLoad });
    document.getElementById('model-loading').classList.remove('d-none');
    const model = await loadModelWithFallback(modelToLoad);
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
            if (e.target.closest('.btn-close')) return;
            if (!el.classList.contains('d-none')) minimize(el);
        });
    });

    setTimeout(() => {
        ['offline-ready', 'device-notice'].forEach(id => {
            const el = document.getElementById(id);
            if (!el || el.classList.contains('d-none')) return;
            minimize(el);
        });
    }, 5000);

    const notice = document.getElementById('device-notice');
    const noticeText = document.getElementById('device-notice-text');
    if (model.device === 'webgpu') {
        notice.classList.add('alert-success');
        noticeText.textContent = t('webgpu_notice');
    } else {
        notice.classList.add('alert-warning');
        noticeText.textContent = t('wasm_notice');
    }
    notice.classList.remove('d-none');

    webgpuAvailable = model.device === 'webgpu';
    showFilePicker(webgpuAvailable);
}

function init() {
    applyTranslations();
    setup();

    document.getElementById('reset-model-btn').addEventListener('click', () => {
        localStorage.removeItem(MODEL_LOADING_STATE_KEY);
        localStorage.removeItem(LLM_MODEL_LOADING_STATE_KEY)
    });

    document.getElementById('language-select').addEventListener('change', async (e) => {
        await changeLanguage(e.target.value);
        applyTranslations();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}