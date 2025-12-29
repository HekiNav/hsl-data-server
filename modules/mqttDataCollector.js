import express from "express";
import { DIGITRANSIT_SUBSCRIPTION_KEY, languageHandler, MEASURE_PERFORMANCE } from "../index.js";
import sqlite3 from "sqlite3"
import mqtt from "mqtt"
import fs from "node:fs"

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router()

const db = new sqlite3.Database(":memory:", sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) console.error(err)
})
loadFromDisk(db).then(start)
function start() {
    db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA temp_store = MEMORY;
`);
    db.run(`CREATE TABLE IF NOT EXISTS trips(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gtfsId STRING,
    routeId STRING,
    vehicleId STRING,
    operatorId STRING,
    operatorName STRING,
    startTime STRING,
    day STRING,
    direction INTEGER
);`)
    db.run(`
    CREATE TABLE IF NOT EXISTS trip_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id TEXT NOT NULL,
    time TEXT,
    type TEXT,
    speed REAL,
    lat REAL,
    long REAL,
    delay INTEGER,
    stop TEXT,
    occupancy INTEGER,
    FOREIGN KEY (trip_id) REFERENCES trips(id)
);`)
    db.run(`
    CREATE TABLE IF NOT EXISTS traffic_light_priorities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id TEXT NOT NULL,
    time TEXT,
    request BOOLEAN,
    junctionId TEXT,
    responseAcknowledged BOOLEAN,
    FOREIGN KEY (trip_id) REFERENCES trips(id)
);`)
    db.run(`
    CREATE TABLE IF NOT EXISTS stats (
    type TEXT NOT NULL,
    id TEXT,
    count INTEGER NOT NULL,
    UNIQUE (type, id)
);`)
    db.run(`
    CREATE TABLE IF NOT EXISTS door_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doorOpened BOOLEAN NOT NULL,
    trip_id TEXT NOT NULL,
    stop TEXT,
    time TEXT,
    FOREIGN KEY (trip_id) REFERENCES trips(id)
);`)

    router.get("/stats/", async (req, res) => {
        console.time("all stop events")
        const events = await getAllStopTripEvents()
        console.timeEnd("all stop events")
        res.json(events)
    })
    router.get("/tl_events/", async (req, res) => {
        console.time("all tl events")
        const events = await getAllFromTable("traffic_light_priorities")
        console.timeEnd("all tl events")
        res.json(events)
    })

    const client = mqtt.connect("wss://mqtt.hsl.fi:443")

    client.on("connect", () => {
        console.log("Connected to HSL MQTT")
        client.subscribe("/hfp/v2/journey/+/#")
    })
    client.on("disconnect", () => {
        console.log("Connection lost. Reconnecting")
        client.reconnect()
    }
    )
    client.on("message", handleMessage)

    // back up when feeling like it
    setInterval(() => {
        backupToDisk(db).catch(console.error);
    }, 30_000)

    // also backup on exit
    process.on('SIGINT', async () => {
        await backupToDisk(memDb)
        process.exit(0)
    })
}
async function handleMessage(topic, message) {
    const [_, prefix, version,
        journey_type, temporal_type, event_type,
        transport_mode, operator_id, vehicle_number,
        route_id, direction_id, headsign,
        start_time, next_stop, geohash_level,
        geohash] = topic.split("/")
    const messageData = Object.values(JSON.parse(message.toString()))[0], {
        desi,
        dir,
        oper,
        veh,
        tst,
        tsi,
        spd,
        hdg,
        lat,
        long,
        acc,
        dl,
        odo,
        drst,
        oday,
        jrn,
        line,
        start,
        loc,
        stop,
        route,
        occu,
        sid

    } = messageData
    incrementStats("event", event_type)
    switch (event_type) {
        case "ars":     // Vehicle has arrived to a stop
        case "pas":     // Vehicle passes through a stop without stopping
            if (stop) incrementStats("stop", `${stop}/${event_type == "ars" ? "stop" : "pass"}`)
        case "pde":     // Vehicle is ready to depart from a stop
        case "da":      // Driver signs in to the vehicle
        case "dout":    // Driver signs out of the vehicle
        case "ba":      // Driver selects the block that the vehicle will run
        case "bout":    // Driver signs out from the selected block (usually from a depot)
        case "vja":     // Vehicle signs in to a service journey (i.e. a single public transport journey from location A to location B, also known as trip)
        case "vjout":   // Vehicle signs off from a service journey, after reaching the final stop
        case "doo":     // Doors of the vehicle are opened
        case "doc":     // Doors of the vehicle are closed
        case "tlr":     // Vehicle is requesting traffic light priority
        case "tla":     // Vehicle receives a response to traffic light priority request
        case "due":     // Vehicle will soon arrive to a stop
        case "wait":    // Vehicle is waiting at a stop
        case "arr":     // Vehicle arrives inside of a stop radius
        case "dep":     // Vehicle departs from a stop and leaves the stop radius
            const routeGtfsId = `HSL:${route}`
            const directionId = Number(dir) - 1
            const depTime = start && start.split(":").reduce((prev, curr) => +curr + (prev * 60)) * 60
            const operatorName = operatorTable[oper] || "N/A"

            if (MEASURE_PERFORMANCE) console.time(`Process ${event_type} ${operator_id}/${vehicle_number}`)

            db.get("SELECT gtfsId FROM trips WHERE direction = ? AND routeId = ? AND startTime = ? AND day = ?", [directionId, routeGtfsId, start, oday], async (err, row) => {
                if (err) {
                    console.error(err)
                    if (MEASURE_PERFORMANCE) console.timeEnd(`Process ${event_type}-${operator_id}/${vehicle_number}`)
                    return
                }
                const tripId = row && row.gtfsId ? row.gtfsId : await fuzzyTripId(routeGtfsId, directionId, oday, depTime)
                if (!tripId) {
                    console.error(`No tripId found for trip: (routeId: ${routeGtfsId}, directionId. ${directionId}, operatingDay: ${oday}, depTime: ${depTime})`)
                    if (MEASURE_PERFORMANCE) console.timeEnd(`Process ${event_type} ${operator_id}/${vehicle_number}`)
                    return
                }
                if (MEASURE_PERFORMANCE) console.timeEnd(`Process ${event_type} ${operator_id}/${vehicle_number}`)
                // Only run if new trip
                if (!row ? true : !row.gtfsId) db.run(`
                    INSERT INTO trips (gtfsId, routeId, vehicleId, operatorId, operatorName, startTime, day, direction) VALUES (?, ?, ?, ?, ?, ?, ?, ?) 
                    `, [tripId, routeGtfsId, vehicle_number, operator_id, operatorName, start, oday, directionId])

                switch (event_type) {
                    case "tlr":
                    case "tla":
                        db.run(`
                    INSERT INTO traffic_light_priorities (trip_id, time, request, junctionId, responseAcknowledged) VALUES (?, ?, ?, ?, ?)
                `, [tripId, tsi, event_type == "tlr", sid, messageData["tlp-decision"] == "ACK"])
                    case "doo":
                    case "doc":
                        db.run(`
                    INSERT INTO door_events (doorOpened, trip_id, stop, time) VALUES (?, ?, ?, ?)
                `, [event_type == "doo", tripId, stop, tsi])
                    default:
                        db.run(`
                    INSERT INTO trip_events (trip_id, time, type, speed, lat, long, delay, stop, occupancy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [tripId, tsi, event_type, spd, lat, long, dl, stop, occu])
                        break
                }

            })




            break
        case "vp":      // Vehicle position
        default:
            break
    }
}
function incrementStats(type, id) {
    db.run(`
INSERT INTO stats (type, id, count)
VALUES (?, ?, 1)
ON CONFLICT(type, id)
DO UPDATE SET count = count + 1;
;`, [type, id])
}
export async function fuzzyTripId(routeId, direction, date, time) {
    const query = `
{
  fuzzyTrip(route: "${routeId}", direction: ${direction}, date: "${date}", time: ${time}) {
    gtfsId
  }
}
    `
    const response = await fetch(`https://api.digitransit.fi/routing/v2/hsl/gtfs/v1?digitransit-subscription-key=${DIGITRANSIT_SUBSCRIPTION_KEY}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/graphql"
        },
        body: query
    })
    const json = JSON.parse(await response.text())
    if (!json.data || !json.data.fuzzyTrip || !json.data.fuzzyTrip.gtfsId) return null
    return json.data.fuzzyTrip.gtfsId
}

function loadFromDisk(memDb) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(path.join(__dirname, 'data', 'main.db'))) {
            console.warn("No db, creating one at "+ path.join(__dirname, 'data', 'main.db'))
            return resolve() // first run, nothing to restore
        }

        const diskDb = new sqlite3.Database(path.join(__dirname, 'data', 'main.db'), sqlite3.OPEN_READONLY)

        diskDb.backup(memDb, {
            progress: (p) => {
                console.log(`restoring ${p.remaining}/${p.total}`)
            }
        }, (err) => {
            diskDb.close()
            if (err) reject(err)
            else resolve()
        })
    })
}
function backupToDisk(memDb) {
    return new Promise((resolve, reject) => {
        const diskDb = new sqlite3.Database(BACKUP_PATH)

        memDb.backup(diskDb, {
            progress: (p) => {
                console.log(`backing up ${p.remaining}/${p.total}`)
            }
        }, (err) => {
            diskDb.close()
            if (err) reject(err)
            else resolve()
        })
    })
}


export const operatorTable = {
    6: "Oy Pohjolan Liikenne Ab",
    12: "Koiviston Auto Oy",
    17: "Tammelundin Liikenne Oy",
    18: "Oy Pohjolan Liikenne Ab",
    20: "Bus Travel Åbergin Linja Oy",
    21: "Bus Travel Oy Reissu Ruoti",
    22: "Nobina Finland Oy",
    30: "Savonlinja Oy",
    36: "Nurmijärven Linja Oy",
    40: "HKL-Raitioliikenne",
    47: "Taksikuljetus Oy",
    50: "HKL-Metroliikenne",
    51: "Korsisaari Oy",
    54: "V-S Bussipalvelut Oy",
    58: "Koillisen Liikennepalvelut Oy",
    59: "Tilausliikenne Nikkanen Oy",
    60: "Suomenlinnan Liikenne Oy",
    64: "Taksikuljetus Harri Vuolle Oy",
    89: "Metropolia",
    90: "VR Oy",
    130: "Matkahuolto",
    195: "Siuntio",
}

function getAllStopTripEvents() {
    return new Promise((res) => db.all(`
        SELECT * FROM trip_events WHERE STOP NOT NULL
        `, (err, rows) => res(rows)))
}
function getAllFromTable(table_name) {
    return new Promise((res) => db.all(`
        SELECT * FROM ${table_name}
        `, (err, rows) => res(rows)))
}

export const mqttDataCollector = router