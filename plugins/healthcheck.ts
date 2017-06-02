import Response from "../response";
import Robot from "../robot";

export default function(robot: Robot) {
  robot.router.get("/healthcheck", (req, res) => {
    return res.status(200).send("ok");
  });
}