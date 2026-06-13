/**
 * js/i18n.js
 * Creative Commons Attribution 4.0 International (CC BY 4.0)
 * Matthieu GRALL (DATA VISIONS)
 *
 * Module d'internationalisation autonome.
 * - Charge les traductions depuis i18n/{lang}.json
 * - Applique les traductions à tous les éléments [data-i18n]
 * - Mémorise la langue choisie dans localStorage
 * - S'initialise automatiquement au chargement du DOM
 * - Expose window.I18n pour usage depuis d'autres scripts
 */

const I18n = (() => {

    // ----------------------------------------------------------------
    // Configuration
    // ----------------------------------------------------------------

    const CONFIG = {
        defaultLanguage: 'en',
        availableLanguages: ['fr', 'en'],
        translationPath: 'i18n/',   // relatif à l'index.html
        storageKey: 'lang'
    };

    // ----------------------------------------------------------------
    // État interne
    // ----------------------------------------------------------------

    let currentLanguage = null;
    let translations = {};

    // ----------------------------------------------------------------
    // Fonctions privées
    // ----------------------------------------------------------------

    /**
     * Résout une clé pointée ("header.title") dans l'objet de traductions.
     * Retourne la clé elle-même si introuvable (graceful degradation).
     */
    function resolve(key) {
        const parts = key.split('.');
        let node = translations;
        for (const part of parts) {
            if (node == null || typeof node !== 'object') return key;
            node = node[part];
        }
        return (node != null && typeof node === 'string') ? node : key;
    }

    /**
     * Applique les traductions au DOM.
     * Traite : textContent via [data-i18n], placeholder via [data-i18n-placeholder].
     */
    function applyToDom() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const text = resolve(el.getAttribute('data-i18n'));
            if (text) el.textContent = text;
        });

        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const text = resolve(el.getAttribute('data-i18n-placeholder'));
            if (text) el.placeholder = text;
        });

        // Met à jour l'attribut lang du document
        document.documentElement.lang = currentLanguage;

        // Met à jour l'indicateur visuel sur les drapeaux
        document.querySelectorAll('.language-toggle').forEach(el => {
            el.classList.toggle('active', el.dataset.lang === currentLanguage);
        });
    }

    /**
     * Charge le fichier JSON de traductions pour la langue demandée.
     * @returns {Promise<boolean>} true si succès, false sinon
     */
    async function loadTranslations(lang) {
        if (!CONFIG.availableLanguages.includes(lang)) {
            console.warn(`[i18n] Langue inconnue : "${lang}". Repli sur "${CONFIG.defaultLanguage}".`);
            lang = CONFIG.defaultLanguage;
        }

        try {
            const url = `${CONFIG.translationPath}${lang}.json`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            translations = await response.json();
            currentLanguage = lang;
            localStorage.setItem(CONFIG.storageKey, lang);
            return true;
        } catch (err) {
            console.error(`[i18n] Erreur lors du chargement de "${lang}.json" :`, err);
            return false;
        }
    }

    /**
     * Attache les écouteurs de clic sur les boutons de changement de langue.
     */
    function bindToggles() {
        document.querySelectorAll('.language-toggle').forEach(el => {
            el.addEventListener('click', async (e) => {
                e.preventDefault();
                const lang = el.dataset.lang;
                if (lang && lang !== currentLanguage) {
                    await loadTranslations(lang);
                    applyToDom();
                    // Déclenche un événement personnalisé pour que les autres
                    // scripts puissent réagir au changement de langue.
                    document.dispatchEvent(new CustomEvent('languageChanged', {
                        detail: { language: currentLanguage }
                    }));
                }
            });
        });
    }

    // ----------------------------------------------------------------
    // Initialisation automatique au chargement du DOM
    // ----------------------------------------------------------------

    document.addEventListener('DOMContentLoaded', async () => {
        const savedLang = localStorage.getItem(CONFIG.storageKey) || CONFIG.defaultLanguage;
        const ok = await loadTranslations(savedLang);

        if (!ok && savedLang !== CONFIG.defaultLanguage) {
            await loadTranslations(CONFIG.defaultLanguage);
        }

        applyToDom();
        bindToggles();
    });

    // ----------------------------------------------------------------
    // API publique
    // ----------------------------------------------------------------

    return {
        /** Langue courante */
        getLanguage() { return currentLanguage; },

        /** Résoudre une clé de traduction depuis un autre script */
        t(key) { return resolve(key); },

        /** Forcer le rechargement et l'application des traductions */
        async switchTo(lang) {
            await loadTranslations(lang);
            applyToDom();
        }
    };

})();