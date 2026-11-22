async function supportsWebGPU() {
    return !!(await navigator.gpu?.requestAdapter());
}

export { supportsWebGPU };
