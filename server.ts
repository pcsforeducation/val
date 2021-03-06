import * as fs from "fs";
import Robot from "./robot";

if (fs.existsSync("./envfile")) {
  require("dotenv").config({path: "./envfile"});
}

// Add source map support in dev
try {
  require("source-map-support").install({
    environment: "node",
    hookRequire: true,
  });
} catch (e) {}

// create a bot
let robot = new Robot();
robot.init();

process.on("uncaughtException", (err) => {
  console.log(`uncaught exception: ${err.stack}`); // tslint:disable-line
});

process.on("unhandledRejection", (err) => {
  console.log(`unhandled rejection: ${err.stack}`); // tslint:disable-line
});
