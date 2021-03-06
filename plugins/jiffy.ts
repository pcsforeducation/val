import SlackAdapter from "../adapters/slack";
import Robot from "../robot";

const BRAIN_KEY = "JIFFY";

function randomFrom(array) {
  return array[Math.floor(Math.random() * array.length)];
}

export default function(robot: Robot) {
  function add(text, reply) {
    let data = robot.brain.get(BRAIN_KEY) || {};
    if (!data.gifs) data.gifs = {};
    let tokens = text.split(" ");
    if (tokens.length < 2) {
      // 'add $url ...$tags
      return reply("usage: '/jiffyadd tag1 tag2 ...'", false);
    }

    let url = tokens[0];
    let tags = text.split(" ").splice(1);
    let updated = false;
    for (let tag of tags) {
      let urls = data.gifs[tag];
      if (urls === undefined) {
        data.gifs[tag] = [url];
        updated = true;
      } else if (urls.indexOf(url) === -1) {
        data.gifs[tag].push(url);
        updated = true;
      } else {
        robot.logger.debug(`Not adding ${url} to ${tag}, already exists`);
      }
    }

    if (updated) {
      robot.brain.set(BRAIN_KEY, data);
      return reply(`Added/updated url: ${url}, tags: ${tags}`, false);
    } else {
      return reply(`Already exists with tags: ${tags}`, false);
    }
  }

  function search(text, reply) {
    let data = robot.brain.get(BRAIN_KEY);
    let tags = text.split(" ");

    if (!data.gifs) {
      return reply("no gifs yet, please submit one!", false);
    }

    let urls = {};
    for (let tag of tags) {
      let matches = data.gifs[tag] || [];
      for (let match of matches) {
        if (urls[match]) {
          urls[match]++;
        } else {
          urls[match] = 1;
        }
      }
    }

    let winners: string[] = [];
    let winnersScore = 0;
    for (let url of Object.keys(urls)) {
      let matches = urls[url];
      if (matches === winnersScore) {
        winners.push(url);
      } else if (matches > winnersScore) {
        winnersScore = matches;
        winners = [url];
      } else {
        return reply(`no gifs match ${tags.join(" ")}, please add one!`, false);
      }
    }
    return reply(randomFrom(winners), true);
  }

  const slack = robot.adapters["Slack"] as SlackAdapter;
  slack.addSlashCommand("jiffy", (body: any, reply: any) => {
    return search(body.text, reply);
  });

  slack.addSlashCommand("jiffyadd", (body: any, reply: any) => {
    return add(body.text, reply);
  });
}
