import { pipeline, env } from '/js/lib/huggingface_transformers/transformers.min.js';
import { supportsWebGPU } from './device-utils.js';
import { toSRT } from './srt-utils.js';

env.allowRemoteModels = true;
env.useBrowserCache = true;

const isLowMemoryDevice = navigator.deviceMemory !== undefined
    ? navigator.deviceMemory <= 4
    : /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const MODELS = ['onnx-community/whisper-large-v3-ONNX', 'onnx-community/whisper-medium-ONNX',
    'onnx-community/whisper-small', 'onnx-community/whisper-tiny']
const MODEL_LOADING_STATE_KEY = "MODEL_BEING_LOADED";
const MODEL_LAST_SUCCESS_KEY = "MODEL_LAST_SUCCESS";
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
    localStorage.setItem(MODEL_LOADING_STATE_KEY, modelName);
    const device = (await supportsWebGPU()) ? 'webgpu' : 'wasm';
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
    localStorage.setItem(MODEL_LAST_SUCCESS_KEY, modelName);
    return transcriber;
}

async function transcribe(audioData, onProgress, modelName, onChunk) {
    let model = await loadModel(onProgress, modelName);
    const result = await model(audioData, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: true,
        chunk_callback: onChunk,
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

async function getModelToLoad() {
    const lastAttempted = localStorage.getItem(MODEL_LOADING_STATE_KEY);
    if (lastAttempted === null) {
        const lastSuccess = localStorage.getItem(MODEL_LAST_SUCCESS_KEY);
        if (lastSuccess && MODELS.includes(lastSuccess)) return lastSuccess;
        return isLowMemoryDevice ? MODELS[1] : MODELS[0];
    }
    const indexOf = MODELS.indexOf(lastAttempted);
    if (indexOf + 1 === MODELS.length) return null;
    return MODELS[indexOf + 1];
}

async function unloadWhisper() {
    if (!transcriber) return;
    try { await transcriber.model?.dispose?.(); } catch (_) { /* device may already be lost */ }
    transcriber = null;
}

export { loadModel, unloadWhisper, transcribe, isModelCached, getModelToLoad, MODEL_ID, MODEL_LOADING_STATE_KEY, MODEL_LAST_SUCCESS_KEY };
