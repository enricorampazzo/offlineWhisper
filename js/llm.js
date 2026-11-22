import { CreateMLCEngine } from "@mlc-ai/web-llm";
import { supportsWebGPU } from "./device-utils.js";

const LLM_MODEL_LOADING_STATE_KEY = "LLM_MODEL_BEING_LOADED";
const LLM_MODEL_LAST_SUCCESS_KEY = "LLM_MODEL_LAST_SUCCESS";
const LOAD_TIMEOUT_MS = 120_000;

let engine = null;

async function getLLMModels() {
    const webgpu = await supportsWebGPU();
    return webgpu
        ? ['Hermes-3-Llama-3.2-3B-q4f16_1-MLC', 'SmolLM2-1.7B-Instruct-q4f16_1-MLC', 'Llama-3.2-1B-Instruct-q4f16_1-MLC']
        : [];
}

async function isLLMModelCached(modelId) {
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

async function getLLMModelToLoad() {
    const models = await getLLMModels();
    if (models.length === 0) return null;
    const lastAttempted = localStorage.getItem(LLM_MODEL_LOADING_STATE_KEY);
    if (lastAttempted === null) {
        const lastSuccess = localStorage.getItem(LLM_MODEL_LAST_SUCCESS_KEY);
        if (lastSuccess && models.includes(lastSuccess)) return lastSuccess;
        return models[0];
    }
    const indexOf = models.indexOf(lastAttempted);
    if (indexOf + 1 === models.length) return null;
    return models[indexOf + 1];
}

async function loadLLMModel(onProgress, modelName) {
    if (engine) return engine;
    localStorage.setItem(LLM_MODEL_LOADING_STATE_KEY, modelName);
    engine = await CreateMLCEngine(modelName, {
        initProgressCallback: (progress) => {
            if (typeof onProgress === 'function') {
                onProgress(progress);
            }
        },
    });
    localStorage.setItem(LLM_MODEL_LAST_SUCCESS_KEY, modelName);
    return engine;
}

async function loadLLMModelWithFallback(modelName, onProgress) {
    const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), LOAD_TIMEOUT_MS)
    );
    try {
        const result = await Promise.race([loadLLMModel(onProgress, modelName), timeout]);
        localStorage.removeItem(LLM_MODEL_LOADING_STATE_KEY);
        return result;
    } catch (err) {
        const isRecoverable = err.message === 'timeout' || err.message?.includes('Device was lost');
        if (!isRecoverable) throw err;
        engine = null;
        const nextModel = await getLLMModelToLoad();
        if (!nextModel) throw new Error('All LLM models failed to load.');
        return loadLLMModelWithFallback(nextModel, onProgress);
    }
}

async function query(systemPrompt, userText) {
    if (!engine) throw new Error('LLM not loaded.');
    const response = await engine.chat.completions.create({
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userText },
        ],
    });
    return response.choices[0].message.content.trim();
}

export { loadLLMModelWithFallback, getLLMModelToLoad, isLLMModelCached, query, LLM_MODEL_LOADING_STATE_KEY, LLM_MODEL_LAST_SUCCESS_KEY };
