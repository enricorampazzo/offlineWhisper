import i18next from 'https://esm.sh/i18next@23';
import LanguageDetector from 'https://esm.sh/i18next-browser-languagedetector@8';

const [en, it, el] = await Promise.all([
    fetch(new URL('./locales/en.json', import.meta.url)).then(r => r.json()),
    fetch(new URL('./locales/it.json', import.meta.url)).then(r => r.json()),
    fetch(new URL('./locales/el.json', import.meta.url)).then(r => r.json()),
]);

await i18next
    .use(LanguageDetector)
    .init({
        fallbackLng: 'en',
        supportedLngs: ['en', 'it', 'el'],
        load: 'languageOnly',
        resources: {
            en: { translation: en },
            it: { translation: it },
            el: { translation: el },
        }
    });

export const t = i18next.t.bind(i18next);
export const changeLanguage = (lng) => i18next.changeLanguage(lng);
export const currentLanguage = () => i18next.resolvedLanguage ?? i18next.language.split('-')[0];