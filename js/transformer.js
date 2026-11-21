import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/transformers.min.js';

env.allowRemoteModels = true;
env.useBrowserCache = true;

const isLowMemoryDevice = navigator.deviceMemory !== undefined
    ? navigator.deviceMemory <= 4
    : /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const MODELS = ['onnx-community/whisper-large-v3-ONNX', 'onnx-community/whisper-medium-ONNX',
    'onnx-community/whisper-small', 'onnx-community/whisper-tiny']
const MODEL_LOADING_STATE_KEY = "MODEL_BEING_LOADED"
const MODEL_ID = isLowMemoryDevice ? 'onnx-community/whisper-medium-ONNX' : 'onnx-community/whisper-large-v3-ONNX';

let transcriber = null;

function updateProgressBar(progress) {
    const wrapper = document.getElementById('model-download');
    const bar = document.getElementById('download-progress-bar');
    if (!wrapper || !bar) return;

    if (progress.status === 'downloading') {
        wrapper.classList.remove('d-none');
        const pct = Math.round(progress.progress);
        bar.style.width = `${pct}%`;
        bar.textContent = `${pct}%`;
        bar.setAttribute('aria-valuenow', pct);
    }

    if (progress.status === 'done') {
        bar.style.width = '100%';
        bar.textContent = '100%';
        bar.classList.remove('progress-bar-animated');
    }
}

async function loadModel(onProgress, modelName) {
    if (transcriber) return transcriber;
    localStorage.setItem(MODEL_LOADING_STATE_KEY, modelName)
    const device = (await navigator.gpu?.requestAdapter()) ? 'webgpu' : 'wasm';
    console.log("using device " + device);
    transcriber = await pipeline(
        'automatic-speech-recognition',
        modelName,
        {
            device,
            dtype: 'q4',
            progress_callback: (progress) => {
                updateProgressBar(progress);
                if (typeof onProgress === 'function') {
                    onProgress(progress);
                }
            }
        }
    );

    transcriber.device = device;
    return transcriber;
}

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

async function transcribe(audioData, onProgress, modelName) {

    let model = await loadModel(onProgress, modelName);
    const result = await model(audioData, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: true,
    });
    return toSRT(result.chunks);
}

async function isModelCached(modelId) {
    const cacheNames = await caches.keys();
    for (const name of cacheNames) {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        if (keys.some(req => req.url.includes(modelId))) {
            return true;
        }
    }
    return false;
}

async function getModelToLoad(){
    let lastAttemptedLoadModel = localStorage.getItem(MODEL_LOADING_STATE_KEY)
    if(lastAttemptedLoadModel === null){
        return isLowMemoryDevice ? MODELS[1] : MODELS[0]
    } else {
        let indexOf = MODELS.indexOf(lastAttemptedLoadModel)
        if(indexOf + 1 === MODELS.length){
            return null
        }
        return MODELS[indexOf + 1]
    }

}



export { loadModel, transcribe, isModelCached, getModelToLoad, MODEL_ID, MODEL_LOADING_STATE_KEY };