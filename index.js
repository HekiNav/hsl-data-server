import express, { json } from "express"
import cors from "cors"
import { rateLimit } from "express-rate-limit"
import LanguageHandler from "./modules/languageHandler.js"

const PORT = 3002
const RATE_LIMIT_PERIOD_MINUTES = 5
const RATE_LIMIT_AMOUNT = 10

const languageHandler = new LanguageHandler({
    availableLanguages: ["en", "fi"]
})

const app = express()
app.use(cors())

const limiter = rateLimit({
    windowMs: RATE_LIMIT_PERIOD_MINUTES * 60 * 1000,
    limit: RATE_LIMIT_AMOUNT, 
    standardHeaders: 'draft-8', // draft-6: `RateLimit-*` headers; draft-7 & draft-8: combined `RateLimit` header
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers.
    ipv6Subnet: 56, // Set to 60 or 64 to be less aggressive, or 52 or 48 to be more aggressive
    message: {
        error: {
            code: 429,
        }
    },
    handler: (req, res) => {
        res.status(429)
        languageHandler.handle(req, res, {
            errors: [{
                en: `Too many requests. Max (${RATE_LIMIT_AMOUNT} requests per ${RATE_LIMIT_PERIOD_MINUTES} minutes)`,
                fi: `Pyyntöraja ylitetty. Max (${RATE_LIMIT_AMOUNT} pyyntöä / ${RATE_LIMIT_PERIOD_MINUTES} min)`
            }]
        })
    }
})
app.use(limiter)

app.listen(PORT, () => {
    console.log(`Listening on http://localhost:${PORT}`)
})

app.get("/", (req, res) => {
    languageHandler.handle(req, res, {
        data: {
            description: {
                en: "HSL Data API",
                fi: "HSL data API"
            }
        }
    })
})

