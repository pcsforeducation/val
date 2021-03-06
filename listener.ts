"use strict";

import * as XRegExp from "xregexp";
import {TextMessage} from "./message";
import Response from "./response";
import Robot from "./robot";

export class Listener {
  robot: Robot;
  matcher: any;
  options: any;
  callback: any;
  regex: any;

  constructor(robot, matcher, options, callback) {
    if (!matcher) {
      throw new Error("Missing a matcher for Listener");
    }

    if (!callback) {
      callback = options;
      options = {};
    }

    if (!options.id) {
      options.id = null;
    }

    if (!callback || typeof callback !== "function") {
      throw new Error("missing a callback for Listener");
    }

    this.robot = robot;
    this.matcher = matcher;
    this.options = options;
    this.callback = callback;
  }

  // Response middleware is called after a response is created but before the callback is called
  call(message, adapter, responseMiddleware) {
    let match = this.matcher(message);
    if (match) {
      this.robot.logger.debug("[listener] found match:", match);

      let response: Response;
      try {
        response = new Response(this.robot, message, match, adapter);
      } catch (e) {
        this.robot.logger.error(`[listener] Creating response from listener error: ${e}`);
      }
      if (responseMiddleware && typeof responseMiddleware === "function") {
        this.robot.logger.debug("[listener] executing response middleware");
        responseMiddleware(response);
      }

      if (!response) {
        this.robot.logger.warn("[listener] response is undefined, not calling callback");
        return false;
      }
      this.robot.logger.debug(`[listener] Executing listener callback for Message ${message}`);
      try {
        this.callback(response);
      } catch (err) {
        this.robot.logger.error(`[listener] callback error: ${err} ${err.stack}`);
        this.robot.emit("error", err);
      }
      return true;
    } else {
      return false;
    }
  }
}

class SlotMatcher {
  // TODO compile all the regexes into one
  private regex: XRegExp;
  private robot: Robot;
  private regexString: string;

  DEFAULT_SLOTS = {
    WORD: "($SLOTNAME\\w+)",
    MULTIWORD: "($SLOTNAME[\\w\\s]+)",
    ANY: "s?($SLOTNAME.+)s?",
    MULTIANY: "($SLOTNAME.+)",
    NUMBER: "($SLOTNAME[\\d\\.\\,]+)",
    BOT_NAME: () => `${this.robot.config.get("BOT_NAME")}:?`,
    // URL: (text: string) => {return false;},
  };

  constructor(robot: Robot, text: string) {
    this.robot = robot;
    this.buildRegexes(text);
  }

  private stringPaddedRegex(text: string) {
    return `\\b${text}\\b`;
  }

  private getSlotRegex(slot: string, name?: string): string {
    let regex = this.DEFAULT_SLOTS[slot];
    if (typeof regex !== "string") {
      return regex;
    }
    if (name) {
      regex = regex.replace("$SLOTNAME", `?<${name}>`);
    } else {
      regex = regex.replace("$SLOTNAME", "");
    }
    return regex;
  }

  // Match strings of the type "{opt1|opt2|opt3...}" and replace the slot with each option
  private orMatches(text: string): string {
    let orRegex = new XRegExp(`{(['\\w\\d\\s\\|]+)}`, "g");

    let matches = [];
    let orMatch = orRegex.exec(text);
    while (orMatch !== null) {
      matches.push(orMatch);
      orMatch = orRegex.exec(text);
    }

    for (let match of matches) {
      let split = match[1].split("|");
      // Check for empty matches
      if (split[split.length - 1] === "") {
        // Match empty string, and filter out the excess spaces around the slot
        let restOfMatch = match[1].slice(0, -1);
        let sub = `{${match[1]}}`;
        if (match.index > 0) {
          sub = " " + sub;
        }
        if (match.index + match[0].length < text.length) {
          sub = sub + " ";
        }

        text = text.replace(sub, `\\s*(${restOfMatch})\?\\s*`);
      } else {
        text = text.replace(`{${match[1]}}`, `(${match[1]})`);
      }
    }
    return text;
  }

  private typeMatches(text: string): string {
    let orRegex = new XRegExp("{([\\w\\d\\s\\:]+)}", "g");

    let matches = [];
    let orMatch = orRegex.exec(text);
    while (orMatch !== null) {
      matches.push(orMatch);
      orMatch = orRegex.exec(text);
    }

    for (let match of matches) {
      let parts = match[1].split(":");
      if (parts.length === 0 || parts.length > 2) {
        throw new Error(`[listener] Cannot parse invalid slot syntax: ${match}`);
      }

      let slotRegex = this.getSlotRegex(parts[1], parts[0]);
      if (!slotRegex) {
        throw new Error(`[listener] Cannot find slot ${parts[1]} for match: ${match}`);
      }

      text = text.replace(`{${match[1]}}`, slotRegex);
    }

    return text;
  }

  private buildRegexes(text: string) {
    let regexString = "";
    regexString = this.orMatches(text);
    regexString = this.typeMatches(regexString);
    // this.regexString = regexString;
    this.regex = new XRegExp(regexString, "gi");
  }

  public match(text: string) {
    return XRegExp.exec(text, this.regex);
  }
}

export class TextListener extends Listener {
  constructor(robot: Robot, regex, options, callback) {
    let matcher;
    if (typeof regex === "string") {
      let slotMatcher = new SlotMatcher(robot, regex);
      matcher = (message) => {
        if (message instanceof TextMessage) {
          return slotMatcher.match(message.text);
        } else {
          return undefined;
        }
      };
    } else {
      matcher = function(message) {
        if (message instanceof TextMessage) {
          return message.match(regex);
        } else {
          return undefined;
        }
      };
    }

    super(robot, matcher, options, callback);
  }
}
