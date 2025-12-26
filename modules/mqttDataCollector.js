import express from "express";
import { languageHandler } from "../index.js";
import sqlite3 from "sqlite3"

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


export const mqttDataCollector = router