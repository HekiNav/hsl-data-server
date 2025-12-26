import express from "express";
import { languageHandler } from "../index.js";
import sqlite3 from "sqlite3"
import mqtt from "mqtt";

const router = express.Router()

const db = new sqlite3.Database("./data/main.db", sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) console.error(err)
})
db.run(`CREATE TABLE IF NOT EXISTS trips(
    id int PRIMARY KEY AUTOINCREMENT,
    gtfsId string,
    routeId string,
    vehicleId string,
    operatorId string,
    operatorName string,
    startTime string
)`)
db.run(`
    CREATE TABLE IF NOT EXISTS trip_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL,
    event_time TEXT,
    event_type TEXT,
    data TEXT,
    FOREIGN KEY (trip_id) REFERENCES trips(id)
);`)

router.get("/test", (req, res) => {

})

const client = mqtt.connect("wss://mqtt.hsl.fi:443")

client.on("connect", () => {
    console.log("Connected to HSL MQTT")
    client.subscribe("/hfp/v2/journey/ongoing/#")
})
client.on("disconnect", () => {
    console.log("Connection lost. Reconnecting")
    client.reconnect()
}
)
client.on("message", handleMessage)

function handleMessage(topic, message) {
    const [_, prefix, version,
        journey_type, journey, deadrun,
        signoff, temporal_type, event_type,
        transport_mode, operator_id, vehicle_number,
        route_id, direction_id, headsign,
        start_time, next_stop, geohash_level,
        geohash, sid] = topic.split("/")
    const {
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
    occu
    } = Object.values(JSON.parse(message.toString()))[0]
    switch (event_type) {
        case "vp":      // Vehicle position
        case "due":     // Vehicle will soon arrive to a stop
        case "arr":     // Vehicle arrives inside of a stop radius
            break
        case "dep":     // Vehicle departs from a stop and leaves the stop radius
            break
        case "ars":     // Vehicle has arrived to a stop
            break
        case "pde":     // Vehicle is ready to depart from a stop
            break
        case "pas":     // Vehicle passes through a stop without stopping
            break
        case "wait":    // Vehicle is waiting at a stop
            break
        case "doo":     // Doors of the vehicle are opened
            break
        case "doc":     // Doors of the vehicle are closed
            break
        case "tlr":     // Vehicle is requesting traffic light priority
            break
        case "tla":     // Vehicle receives a response to traffic light priority request
            break
        case "da":      // Driver signs in to the vehicle
            break
        case "dout":    // Driver signs out of the vehicle
            break
        case "ba":      // Driver selects the block that the vehicle will run
            break
        case "bout":    // Driver signs out from the selected block (usually from a depot)
            break
        case "vja":     // Vehicle signs in to a service journey (i.e. a single public transport journey from location A to location B, also known as trip)
            break
        case "vjout":   // Vehicle signs off from a service journey, after reaching the final stop
            break
    }
}

export const mqttDataCollector = router