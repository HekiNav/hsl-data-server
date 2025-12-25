export default class LanguageHandler {
    constructor({ defaultLanguage, availableLanguages = ["en"] }) {
        if (defaultLanguage && !availableLanguages.some(lang => lang == defaultLanguage)) throw Error(`Default language ${defaultLanguage} does not exist in available languages ${availableLanguages}`)
        this.defaultLanguage = defaultLanguage,
            this.availableLanguages = availableLanguages
    }

    // codes: https://en.wikipedia.org/wiki/List_of_ISO_639_language_codes (Set 1)

    //  data is {
    //      [lang_code]: any
    //  }
    // language is [lang_code]
    getLanguage(language, data) {
        if (!this.availableLanguages.some(lang => lang == language) && language) return {
            data: data.data, errors: [...data.errors,
            this.getSingleLanguage(language, {
                en: `Unsupported language (${language}). Supported languages: ${this.availableLanguages}`,
                fi: `Tukematon kieli (${language}). Tuetut kielet: ${this.availableLanguages}`
            })

            ]
        }
        else return Object.entries(data).reduce((prev, [key, value]) =>
        ({
            ...prev, [key]: value.length ?
                value.map(v => this.getSingleLanguage(language, v)) :
                Object.entries(value).reduce((prev, [k, v]) =>
                ({
                    ...prev, [k]: this.getSingleLanguage(language, v)
                }), {})
        }), {})

    }
    getSingleLanguage(language, data) {
        console.log(language, data)
        // If language is specified and is in data
        if (language && data[language] && this.availableLanguages.some(lang => lang == language)) return { [language]: data[language] }
        // if no language specified, use default
        else if (this.defaultLanguage && data[this.defaultLanguage]) return { [this.defaultLanguage]: data[this.defaultLanguage] }
        // Otherwise return all
        else return data
    }
    handle(req, res, data) {
        res.json(this.getLanguage(req.query.lang, data))
    }
}